use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

use crate::continuous::{
    self, BranchingStrategy, ContinuousModeUpdate, ContinuousQueueItem, ContinuousRun,
    ContinuousState, ContinuousStatus, QueueItemStatus,
};
use crate::db;
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
    cont: State<'_, ContinuousState>,
    app: AppHandle,
    project_id: String,
    task_ids: Vec<String>,
    strategy: String,
    base_branch: Option<String>,
    agent_name: Option<String>,
    model: Option<String>,
) -> Result<ContinuousRun, AppError> {
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
        if let Some(existing) = guard.get(&project_id) {
            if existing.status == ContinuousStatus::Running {
                return Err(AppError::Validation(
                    "Continuous mode is already running for this project".into(),
                ));
            }
        }
    }

    // Get MCP port BEFORE acquiring DB lock to avoid nested mutex contention
    let mcp_port = session::get_mcp_port(&mcp);

    // Validate all tasks exist and are in "ready" status
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    for tid in &task_ids {
        let task = db::tasks::get(&conn, tid, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Task {tid}")))?;
        if task.status.as_str() != "ready" {
            return Err(AppError::Validation(format!(
                "Task {} is not in 'ready' status (current: {})",
                tid, task.status
            )));
        }
    }

    // Build the queue
    let mut queue: Vec<ContinuousQueueItem> = task_ids
        .iter()
        .map(|tid| ContinuousQueueItem {
            task_id: tid.clone(),
            status: QueueItemStatus::Pending,
            session_id: None,
            error: None,
        })
        .collect();

    // Mark first item as running
    queue[0].status = QueueItemStatus::Running;

    // Launch first task session
    let first_task_id = &task_ids[0];
    // Look up first task to get file path for user prompt
    let first_task = db::tasks::get(&conn, first_task_id, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {first_task_id}")))?;
    let first_user_prompt = first_task.task_file_path.as_deref().map(|path| {
        format!(
            "Work on task {first_task_id} located at {path}. \
             Read the task file and begin working on it."
        )
    });

    let first_session = session::start_task_session(
        &conn,
        &pty,
        &app,
        &mcp,
        mcp_port,
        &project_id,
        first_task_id,
        agent_name.as_deref(),
        model.as_deref(),
        true,
        base_branch.as_deref(),
        first_user_prompt.as_deref(),
    )?;

    queue[0].session_id = Some(first_session.id.clone());

    // Record the branch for chaining
    let last_branch = first_session
        .worktree_path
        .as_ref()
        .and_then(|_| {
            db::tasks::get(&conn, first_task_id, &project_id)
                .ok()
                .flatten()
                .and_then(|t| t.branch)
        });

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

    // Stop the currently running session if any
    if let Some(item) = run.queue.get(run.current_index) {
        if item.status == QueueItemStatus::Running {
            if let Some(sid) = &item.session_id {
                let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
                let _ = session::stop_session(&conn, &pty, &app, &mcp, sid);
            }
        }
    }

    let mut finished_run = run;
    finished_run.status = ContinuousStatus::Completed;

    let _ = app.emit(
        "continuous-mode-update",
        ContinuousModeUpdate {
            project_id,
            run: finished_run,
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
