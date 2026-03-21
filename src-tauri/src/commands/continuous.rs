use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

use crate::acp::state::AcpState;
use crate::commands::prompts;
use crate::continuous::{
    self, BranchingStrategy, ContinuousModeUpdate, ContinuousQueueItem, ContinuousRun,
    ContinuousState, ContinuousStatus, QueueItemStatus,
};
use crate::db;
use crate::db::models::SessionTransport;
use crate::db::DbState;
use crate::error::AppError;
use crate::mcp::McpState;
use crate::pty::PtyState;
use crate::session;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_continuous_mode(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    cont: State<'_, ContinuousState>,
    app: AppHandle,
    project_id: String,
    task_ids: Vec<String>,
    strategy: String,
    base_branch: Option<String>,
    agent_name: Option<String>,
    model: Option<String>,
    transport: Option<String>,
) -> Result<ContinuousRun, AppError> {
    let transport = match transport.as_deref() {
        Some("acp") => SessionTransport::Acp,
        _ => SessionTransport::Pty,
    };
    if task_ids.len() < 2 {
        return Err(AppError::Validation(
            "Continuous mode requires at least 2 tasks".into(),
        ));
    }

    let strategy = match strategy.as_str() {
        "chained" => BranchingStrategy::Chained,
        _ => BranchingStrategy::Independent,
    };

    // Check if there's already an active run for this project
    {
        let guard = cont.blocking_lock();
        if guard.contains_key(&project_id) {
            return Err(AppError::Validation(
                "Continuous mode is already active for this project. Dismiss or stop it first.".into(),
            ));
        }
    }

    // Get MCP port BEFORE acquiring DB lock to avoid nested mutex contention
    let mcp_port = session::get_mcp_port(&mcp);

    // Validate all tasks exist and are in "ready" status, resolve per-task agent
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let mut queue: Vec<ContinuousQueueItem> = Vec::with_capacity(task_ids.len());
    for tid in &task_ids {
        let task = db::tasks::get(&conn, tid, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Task {tid}")))?;
        if task.status.as_str() != "ready" {
            return Err(AppError::Validation(format!(
                "Task {} is not in 'ready' status (current: {})",
                tid, task.status
            )));
        }
        // Per-task agent: task.agent overrides run-level agent_name
        let resolved_agent = task.agent.or_else(|| agent_name.clone());
        queue.push(ContinuousQueueItem {
            task_id: tid.clone(),
            status: QueueItemStatus::Pending,
            session_id: None,
            error: None,
            agent_name: resolved_agent,
        });
    }

    let mut last_branch: Option<String> = None;

    // Load continuous mode template once for all tasks
    let cont_template = prompts::get_session_prompt(&conn, "continuous");

    match strategy {
        BranchingStrategy::Independent => {
            // Launch ALL tasks in parallel — each gets its own session from base branch
            for (i, tid) in task_ids.iter().enumerate() {
                queue[i].status = QueueItemStatus::Running;
                let task_agent = queue[i].agent_name.as_deref();

                let mut vars = HashMap::new();
                vars.insert("task_id", tid.as_str());
                vars.insert("mode", "parallel");
                let user_prompt = Some(session::interpolate_vars(&cont_template.prompt, &vars));

                // Each MCP port lookup needs to be fresh for each session
                let port = session::get_mcp_port(&mcp);
                let result = match transport {
                    SessionTransport::Acp => {
                        let opts = session::AcpTaskSessionOpts {
                            task_id: tid,
                            agent_name: task_agent,
                            model: model.as_deref(),
                            create_worktree: true,
                            base_branch: base_branch.as_deref(),
                            user_prompt: user_prompt.as_deref(),
                            is_trust_mode: true,
                        };
                        session::start_acp_task_session(&conn, &app, &mcp, &acp, port, &project_id, &opts)
                    }
                    SessionTransport::Pty => {
                        session::start_task_session(
                            &conn, &pty, &app, &mcp, port, &project_id,
                            tid, task_agent, model.as_deref(),
                            true, base_branch.as_deref(), user_prompt.as_deref(),
                        )
                    }
                };
                match result {
                    Ok(session) => {
                        queue[i].session_id = Some(session.id.clone());
                    }
                    Err(e) => {
                        tracing::error!(task_id = %tid, %e, "Failed to launch parallel session");
                        queue[i].status = QueueItemStatus::Error;
                        queue[i].error = Some(format!("Launch failed: {e}"));
                    }
                }
            }
        }
        BranchingStrategy::Chained => {
            // Sequential — launch only the first task
            queue[0].status = QueueItemStatus::Running;
            let first_agent = queue[0].agent_name.as_deref();

            let first_task_id = &task_ids[0];
            let mut vars = HashMap::new();
            vars.insert("task_id", first_task_id.as_str());
            vars.insert("mode", "chained");
            let first_user_prompt = Some(session::interpolate_vars(&cont_template.prompt, &vars));

            let first_session = match transport {
                SessionTransport::Acp => {
                    let opts = session::AcpTaskSessionOpts {
                        task_id: first_task_id,
                        agent_name: first_agent,
                        model: model.as_deref(),
                        create_worktree: true,
                        base_branch: base_branch.as_deref(),
                        user_prompt: first_user_prompt.as_deref(),
                        is_trust_mode: true,
                    };
                    session::start_acp_task_session(&conn, &app, &mcp, &acp, mcp_port, &project_id, &opts)?
                }
                SessionTransport::Pty => {
                    session::start_task_session(
                        &conn, &pty, &app, &mcp, mcp_port, &project_id,
                        first_task_id, first_agent, model.as_deref(),
                        true, base_branch.as_deref(), first_user_prompt.as_deref(),
                    )?
                }
            };

            queue[0].session_id = Some(first_session.id.clone());

            // Record the branch for chaining
            last_branch = first_session
                .worktree_path
                .as_ref()
                .and_then(|_| {
                    db::tasks::get(&conn, first_task_id, &project_id)
                        .ok()
                        .flatten()
                        .and_then(|t| t.branch)
                });
        }
    }

    let run = ContinuousRun {
        project_id: project_id.clone(),
        status: ContinuousStatus::Running,
        queue,
        current_index: 0,
        strategy,
        base_branch,
        agent_name,
        model,
        last_branch,
        transport,
    };

    // Store the run
    {
        let mut guard = cont.blocking_lock();
        guard.insert(project_id.clone(), run.clone());
    }

    tracing::info!(
        project_id = %project_id,
        strategy = ?run.strategy,
        task_count = run.queue.len(),
        agent = ?run.agent_name,
        "Continuous mode started"
    );

    let _ = app.emit(
        "continuous-mode-update",
        ContinuousModeUpdate {
            project_id,
            run: run.clone(),
        },
    );

    Ok(run)
}

#[tauri::command]
pub fn pause_continuous_mode(
    cont: State<'_, ContinuousState>,
    app: AppHandle,
    project_id: String,
) -> Result<ContinuousRun, AppError> {
    let mut guard = cont.blocking_lock();
    let run = guard
        .get_mut(&project_id)
        .ok_or_else(|| AppError::NotFound("No active continuous run".into()))?;

    if run.status != ContinuousStatus::Running {
        return Err(AppError::Validation(
            "Continuous mode is not running".into(),
        ));
    }

    run.status = ContinuousStatus::Paused;
    tracing::info!(project_id = %project_id, "Continuous mode paused");
    let result = run.clone();

    let _ = app.emit(
        "continuous-mode-update",
        ContinuousModeUpdate {
            project_id,
            run: result.clone(),
        },
    );

    Ok(result)
}

#[tauri::command]
pub fn resume_continuous_mode(
    cont: State<'_, ContinuousState>,
    app: AppHandle,
    project_id: String,
) -> Result<ContinuousRun, AppError> {
    // First, set status to Running
    {
        let mut guard = cont.blocking_lock();
        let run = guard
            .get_mut(&project_id)
            .ok_or_else(|| AppError::NotFound("No active continuous run".into()))?;

        if run.status != ContinuousStatus::Paused {
            return Err(AppError::Validation(
                "Continuous mode is not paused".into(),
            ));
        }

        run.status = ContinuousStatus::Running;
        tracing::info!(project_id = %project_id, "Continuous mode resumed");

        let _ = app.emit(
            "continuous-mode-update",
            ContinuousModeUpdate {
                project_id: project_id.clone(),
                run: run.clone(),
            },
        );
    }

    // Check if the current task's session is already completed (MCP reported done while paused)
    let should_advance = {
        let guard = cont.blocking_lock();
        if let Some(run) = guard.get(&project_id) {
            if let Some(item) = run.queue.get(run.current_index) {
                if let Some(sid) = &item.session_id {
                    let mcp_state: tauri::State<'_, Arc<TokioMutex<McpState>>> = app.state();
                    let mcp_guard = mcp_state.blocking_lock();
                    mcp_guard
                        .sessions
                        .get(sid.as_str())
                        .map(|d| d.completed)
                        .unwrap_or(false)
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        }
    };

    if should_advance {
        continuous::try_advance(&app, &project_id)?;
    }

    let guard = cont.blocking_lock();
    guard
        .get(&project_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound("Run completed during resume".into()))
}

#[tauri::command]
pub fn stop_continuous_mode(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    cont: State<'_, ContinuousState>,
    app: AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    let mut guard = cont.blocking_lock();
    let run = match guard.remove(&project_id) {
        Some(r) => r,
        None => return Ok(()), // no active run
    };
    drop(guard);
    tracing::info!(project_id = %project_id, "Continuous mode stopped");

    // Stop ALL currently running sessions (important for independent mode)
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    for item in &run.queue {
        if item.status == QueueItemStatus::Running {
            if let Some(sid) = &item.session_id {
                let _ = session::stop_session(&conn, &pty, &app, &mcp, Some(&acp), sid);
            }
        }
    }

    let completed_count = run.queue.iter()
        .filter(|i| i.status == QueueItemStatus::Completed)
        .count();

    // Emit finished event so the frontend properly clears the state
    let _ = app.emit(
        "continuous-mode-finished",
        continuous::ContinuousModeFinished {
            project_id,
            completed_count,
        },
    );

    Ok(())
}

/// Dismiss a completed continuous run — stops and removes all related sessions.
/// Called by the user from the continuous mode bar after reviewing agent output.
#[tauri::command]
pub fn dismiss_continuous_mode(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    cont: State<'_, ContinuousState>,
    app: AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    let mut guard = cont.blocking_lock();
    let run = match guard.remove(&project_id) {
        Some(r) => r,
        None => return Ok(()), // no active run
    };
    drop(guard);
    tracing::info!(project_id = %project_id, "Continuous mode dismissed");

    // Stop and remove ALL sessions that are still alive
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    for item in &run.queue {
        if let Some(sid) = &item.session_id {
            // stop_and_remove handles already-stopped sessions gracefully
            let _ = session::stop_and_remove_session(&conn, &pty, &app, &mcp, Some(&acp), sid);
        }
    }

    let completed_count = run
        .queue
        .iter()
        .filter(|i| i.status == QueueItemStatus::Completed)
        .count();

    // Emit finished event to clear frontend state
    let _ = app.emit(
        "continuous-mode-finished",
        continuous::ContinuousModeFinished {
            project_id,
            completed_count,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn get_continuous_mode_status(
    cont: State<'_, ContinuousState>,
    project_id: String,
) -> Result<Option<ContinuousRun>, AppError> {
    let guard = cont.blocking_lock();
    Ok(guard.get(&project_id).cloned())
}
