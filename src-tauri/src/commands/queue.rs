use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

use crate::acp::state::AcpState;
use crate::commands::prompts;
use crate::queue::{
    self, BranchingStrategy, QueueModeUpdate, QueueItem, QueueRun,
    QueueState, QueueStatus, QueueItemStatus,
};
use std::collections::HashSet;
use crate::db;
use crate::db::models::SessionTransport;
use crate::db::DbState;
use crate::error::AppError;
use crate::mcp::McpState;
use crate::pty::PtyState;
use crate::session;

/// Validate the dependency graph for a set of tasks and return a topologically
/// sorted order with strategy suggestions. Called by the frontend on each
/// selection change in the launch dialog.
#[tauri::command]
pub fn validate_queue_deps(
    db: State<'_, DbState>,
    project_id: String,
    task_ids: Vec<String>,
) -> Result<queue::ValidatedOrder, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queue::validate_dependency_graph(&conn, &project_id, &task_ids)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_queue_mode(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    cont: State<'_, QueueState>,
    app: AppHandle,
    project_id: String,
    task_ids: Vec<String>,
    strategy: String,
    base_branch: Option<String>,
    agent_name: Option<String>,
    model: Option<String>,
    transport: Option<String>,
    worktree_strategy: Option<String>,
) -> Result<QueueRun, AppError> {
    let transport = match transport.as_deref() {
        Some("acp") => SessionTransport::Acp,
        _ => SessionTransport::Pty,
    };
    if task_ids.len() < 2 {
        return Err(AppError::Validation(
            "Queue mode requires at least 2 tasks".into(),
        ));
    }

    let strategy = match strategy.as_str() {
        "chained" => BranchingStrategy::Chained,
        "dag" => BranchingStrategy::Dag,
        _ => BranchingStrategy::Independent,
    };

    let wt_strategy = match worktree_strategy.as_deref() {
        Some("integration") => Some(queue::WorktreeStrategy::Integration),
        Some("sequential") => Some(queue::WorktreeStrategy::Sequential),
        Some("independent") => Some(queue::WorktreeStrategy::Independent),
        _ => None, // Will be derived from branching strategy later
    };

    // Check if there's already an active run for this project
    {
        let guard = cont.blocking_lock();
        if guard.contains_key(&project_id) {
            return Err(AppError::Validation(
                "Queue mode is already active for this project. Dismiss or stop it first.".into(),
            ));
        }
    }

    // Get MCP port BEFORE acquiring DB lock to avoid nested mutex contention
    let mcp_port = session::get_mcp_port(&mcp);

    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Validate dependency graph and get topologically sorted order
    let validated = queue::validate_dependency_graph(&conn, &project_id, &task_ids)?;
    let task_ids = validated.sorted_ids; // reorder to dependency-safe execution order

    // Validate all tasks exist and are in "ready" status, resolve per-task agent.
    // For DAG strategy, also collect in-queue dependencies per task.
    let queued_set: HashSet<&str> = task_ids.iter().map(|s| s.as_str()).collect();
    let mut queue: Vec<QueueItem> = Vec::with_capacity(task_ids.len());
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
        // For DAG: keep only in-queue deps (external deps already validated as done)
        let in_queue_deps = if strategy == BranchingStrategy::Dag {
            task.depends_on.iter()
                .filter(|d| queued_set.contains(d.as_str()))
                .cloned()
                .collect()
        } else {
            vec![]
        };
        queue.push(QueueItem {
            task_id: tid.clone(),
            status: QueueItemStatus::Pending,
            session_id: None,
            error: None,
            agent_name: resolved_agent,
            depends_on: in_queue_deps,
        });
    }

    let mut last_branch: Option<String> = None;

    // Generate run ID for branch naming
    let run_id = db::generate_id("qr");

    // Determine effective worktree strategy
    let effective_wt_strategy = wt_strategy.unwrap_or_else(|| {
        match strategy {
            BranchingStrategy::Chained => queue::WorktreeStrategy::Integration,
            BranchingStrategy::Independent | BranchingStrategy::Dag => queue::WorktreeStrategy::Independent,
        }
    });

    // Create integration branch if using Integration strategy
    let mut integration_branch_id: Option<String> = None;
    if effective_wt_strategy == queue::WorktreeStrategy::Integration {
        if let Some(base) = base_branch.as_deref().or(Some("main")) {
            let project = db::projects::get(&conn, &project_id)?
                .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
            let repo_path = std::path::Path::new(&project.path);
            let ib_name = format!("queue/{}", run_id);

            match crate::git::create_integration_branch(repo_path, &ib_name, base) {
                Ok(_) => {
                    let pending: Vec<String> = task_ids.clone();
                    match db::integration_branches::create(
                        &conn, "queue", &run_id, &project_id, &ib_name, base,
                        effective_wt_strategy.as_str(), &pending,
                    ) {
                        Ok(ib) => {
                            integration_branch_id = Some(ib.id);
                            tracing::info!(branch = %ib_name, "Created integration branch for queue run");
                        }
                        Err(e) => {
                            tracing::error!(%e, "Failed to create integration branch record");
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(%e, "Failed to create integration branch — falling back to independent");
                    // Don't fail the whole run — fall back
                }
            }
        }
    }

    // For integration strategy, the first task branches from the integration branch
    let effective_base_for_first_task = if effective_wt_strategy == queue::WorktreeStrategy::Integration && integration_branch_id.is_some() {
        Some(format!("queue/{}", run_id))
    } else {
        base_branch.clone()
    };

    // Load queue mode template once for all tasks
    let cont_template = prompts::get_session_prompt(&conn, "queue");

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

            let launch_base = effective_base_for_first_task.as_deref().or(base_branch.as_deref());

            let first_session = match transport {
                SessionTransport::Acp => {
                    let opts = session::AcpTaskSessionOpts {
                        task_id: first_task_id,
                        agent_name: first_agent,
                        model: model.as_deref(),
                        create_worktree: true,
                        base_branch: launch_base,
                        user_prompt: first_user_prompt.as_deref(),
                        is_trust_mode: true,
                    };
                    session::start_acp_task_session(&conn, &app, &mcp, &acp, mcp_port, &project_id, &opts)?
                }
                SessionTransport::Pty => {
                    session::start_task_session(
                        &conn, &pty, &app, &mcp, mcp_port, &project_id,
                        first_task_id, first_agent, model.as_deref(),
                        true, launch_base, first_user_prompt.as_deref(),
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
        BranchingStrategy::Dag => {
            // Launch only root tasks (those with zero in-queue deps) in parallel.
            // Downstream tasks launch automatically as deps complete via try_advance.
            let root_indices: Vec<usize> = queue.iter().enumerate()
                .filter(|(_, item)| item.depends_on.is_empty())
                .map(|(i, _)| i)
                .collect();

            tracing::info!(
                root_count = root_indices.len(),
                total = queue.len(),
                "DAG: launching root tasks"
            );

            let launch_base = effective_base_for_first_task.as_deref().or(base_branch.as_deref());

            for &i in &root_indices {
                queue[i].status = QueueItemStatus::Running;
                let task_agent = queue[i].agent_name.as_deref();
                let tid = &queue[i].task_id;

                let mut vars = HashMap::new();
                vars.insert("task_id", tid.as_str());
                vars.insert("mode", "dag");
                let user_prompt = Some(session::interpolate_vars(&cont_template.prompt, &vars));

                let port = session::get_mcp_port(&mcp);
                let result = match transport {
                    SessionTransport::Acp => {
                        let opts = session::AcpTaskSessionOpts {
                            task_id: tid,
                            agent_name: task_agent,
                            model: model.as_deref(),
                            create_worktree: true,
                            base_branch: launch_base,
                            user_prompt: user_prompt.as_deref(),
                            is_trust_mode: true,
                        };
                        session::start_acp_task_session(&conn, &app, &mcp, &acp, port, &project_id, &opts)
                    }
                    SessionTransport::Pty => {
                        session::start_task_session(
                            &conn, &pty, &app, &mcp, port, &project_id,
                            tid, task_agent, model.as_deref(),
                            true, launch_base, user_prompt.as_deref(),
                        )
                    }
                };
                match result {
                    Ok(session) => {
                        queue[i].session_id = Some(session.id.clone());
                    }
                    Err(e) => {
                        tracing::error!(task_id = %tid, %e, "DAG: failed to launch root task");
                        queue[i].status = QueueItemStatus::Error;
                        queue[i].error = Some(format!("Launch failed: {e}"));
                    }
                }
            }

            // Block dependents of any root tasks that failed to launch
            let failed_roots: Vec<String> = root_indices.iter()
                .filter(|&&i| queue[i].status == QueueItemStatus::Error)
                .map(|&i| queue[i].task_id.clone())
                .collect();
            for tid in &failed_roots {
                queue::block_dependents_in_queue(&mut queue, tid);
            }
        }
    }

    let run = QueueRun {
        project_id: project_id.clone(),
        status: QueueStatus::Running,
        queue,
        current_index: 0,
        strategy,
        base_branch,
        agent_name,
        model,
        last_branch,
        transport,
        worktree_strategy: Some(effective_wt_strategy),
        integration_branch_id: integration_branch_id.clone(),
        run_id: Some(run_id),
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
        "Queue mode started"
    );

    let _ = app.emit(
        "queue-mode-update",
        QueueModeUpdate {
            project_id,
            run: run.clone(),
        },
    );

    Ok(run)
}

#[tauri::command]
pub fn pause_queue_mode(
    cont: State<'_, QueueState>,
    app: AppHandle,
    project_id: String,
) -> Result<QueueRun, AppError> {
    let mut guard = cont.blocking_lock();
    let run = guard
        .get_mut(&project_id)
        .ok_or_else(|| AppError::NotFound("No active queue run".into()))?;

    if run.status != QueueStatus::Running {
        return Err(AppError::Validation(
            "Queue mode is not running".into(),
        ));
    }

    run.status = QueueStatus::Paused;
    tracing::info!(project_id = %project_id, "Queue mode paused");
    let result = run.clone();

    let _ = app.emit(
        "queue-mode-update",
        QueueModeUpdate {
            project_id,
            run: result.clone(),
        },
    );

    Ok(result)
}

#[tauri::command]
pub fn resume_queue_mode(
    cont: State<'_, QueueState>,
    app: AppHandle,
    project_id: String,
) -> Result<QueueRun, AppError> {
    // First, set status to Running
    {
        let mut guard = cont.blocking_lock();
        let run = guard
            .get_mut(&project_id)
            .ok_or_else(|| AppError::NotFound("No active queue run".into()))?;

        if run.status != QueueStatus::Paused {
            return Err(AppError::Validation(
                "Queue mode is not paused".into(),
            ));
        }

        run.status = QueueStatus::Running;
        tracing::info!(project_id = %project_id, "Queue mode resumed");

        let _ = app.emit(
            "queue-mode-update",
            QueueModeUpdate {
                project_id: project_id.clone(),
                run: run.clone(),
            },
        );
    }

    // Check if any running task's session completed while paused (MCP reported done while paused).
    // For chained mode: only check current_index. For dag/independent: check all running items.
    let completed_indices: Vec<usize> = {
        let guard = cont.blocking_lock();
        let mcp_state: tauri::State<'_, Arc<TokioMutex<McpState>>> = app.state();
        let mcp_guard = mcp_state.blocking_lock();
        if let Some(run) = guard.get(&project_id) {
            run.queue.iter().enumerate()
                .filter(|(_, item)| {
                    item.status == QueueItemStatus::Running
                        && item.session_id.as_ref().map_or(false, |sid| {
                            mcp_guard.sessions.get(sid.as_str())
                                .map(|d| d.completed)
                                .unwrap_or(false)
                        })
                })
                .map(|(i, _)| i)
                .collect()
        } else {
            vec![]
        }
    };

    // Advance for each completed item
    for idx in completed_indices {
        {
            let mut guard = cont.blocking_lock();
            if let Some(run) = guard.get_mut(&project_id) {
                run.current_index = idx;
            }
        }
        queue::try_advance(&app, &project_id)?;
    }

    let guard = cont.blocking_lock();
    guard
        .get(&project_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound("Run completed during resume".into()))
}

#[tauri::command]
pub fn stop_queue_mode(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    cont: State<'_, QueueState>,
    app: AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    let mut guard = cont.blocking_lock();
    let run = match guard.remove(&project_id) {
        Some(r) => r,
        None => return Ok(()), // no active run
    };
    drop(guard);
    tracing::info!(project_id = %project_id, "Queue mode stopped");

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
        "queue-mode-finished",
        queue::QueueModeFinished {
            project_id,
            completed_count,
        },
    );

    Ok(())
}

/// Dismiss a completed queue run — stops and removes all related sessions.
/// Called by the user from the queue mode bar after reviewing agent output.
#[tauri::command]
pub fn dismiss_queue_mode(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    cont: State<'_, QueueState>,
    app: AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    let mut guard = cont.blocking_lock();
    let run = match guard.remove(&project_id) {
        Some(r) => r,
        None => return Ok(()), // no active run
    };
    drop(guard);
    tracing::info!(project_id = %project_id, "Queue mode dismissed");

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
        "queue-mode-finished",
        queue::QueueModeFinished {
            project_id,
            completed_count,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn get_queue_mode_status(
    cont: State<'_, QueueState>,
    project_id: String,
) -> Result<Option<QueueRun>, AppError> {
    let guard = cont.blocking_lock();
    Ok(guard.get(&project_id).cloned())
}

/// Get the integration branch state for the active queue run.
#[tauri::command]
pub fn get_integration_branch(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Option<crate::db::models::IntegrationBranch>, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::integration_branches::get_active_for_project(&conn, &project_id)
}

/// Retry a merge after the user has resolved conflicts manually.
///
/// The user resolves conflicts in the task's worktree, commits the resolution,
/// then clicks "Retry merge" in the UI. This re-attempts the merge and resumes the run.
#[tauri::command]
pub fn resolve_merge_conflict(
    db: State<'_, DbState>,
    cont: State<'_, QueueState>,
    app: AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let ib = db::integration_branches::get_active_for_project(&conn, &project_id)?
        .ok_or_else(|| AppError::NotFound("No active integration branch".into()))?;

    let task_id = ib.conflict_task.as_ref()
        .ok_or_else(|| AppError::Validation("No conflict task to resolve".into()))?
        .clone();

    let task = db::tasks::get(&conn, &task_id, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;

    let task_branch = task.branch.as_ref()
        .ok_or_else(|| AppError::Validation("Task has no branch".into()))?;

    let project = db::projects::get(&conn, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    let repo_path = std::path::Path::new(&project.path);
    let commit_msg = format!("Merge {}: {}", task_id, task.title);

    // Retry the merge
    match crate::git::merge_task_branch(repo_path, &ib.branch_name, task_branch, &commit_msg)? {
        crate::git::MergeResult::Success { commit_hash } => {
            // Clear conflict
            db::integration_branches::clear_conflict(&conn, &ib.id)?;
            db::integration_branches::record_merge(&conn, &ib.id, &task_id)?;

            // Advance task to done
            let _ = crate::commands::tasks::do_update_task_status(
                &conn, &project_id, &task_id, "done",
            );

            // Clean up worktree
            if let Some(wt_path) = &task.worktree_path {
                let wt = std::path::Path::new(wt_path);
                if let Err(e) = crate::git::delete_worktree(repo_path, wt) {
                    tracing::warn!(%e, task_id = %task_id, "Failed to cleanup worktree after conflict resolution");
                } else {
                    let _ = db::tasks::update_worktree(&conn, &task_id, &project_id, None);
                }
            }

            // Delete task branch
            let _ = crate::git::delete_task_branch(repo_path, task_branch);

            let _ = app.emit("task-merged", queue::TaskMergedEvent {
                task_id: task_id.clone(),
                integration_branch: ib.branch_name.clone(),
                merge_commit: commit_hash,
            });

            // Resume the run
            drop(conn);
            {
                let mut guard = cont.blocking_lock();
                if let Some(run) = guard.get_mut(&project_id) {
                    run.status = QueueStatus::Running;
                    let _ = app.emit("queue-mode-update", queue::QueueModeUpdate {
                        project_id: project_id.clone(),
                        run: run.clone(),
                    });
                }
            }

            // Try to advance to next task
            queue::try_advance(&app, &project_id)?;

            tracing::info!(task_id = %task_id, "Merge conflict resolved, run resumed");
            Ok(())
        }
        crate::git::MergeResult::Conflict { files } => {
            // Still has conflicts
            db::integration_branches::record_conflict(&conn, &ib.id, &task_id, &files)?;

            Err(AppError::Git(format!(
                "Merge still has conflicts in {} files. Resolve them and try again.",
                files.len()
            )))
        }
    }
}

/// Skip a conflicted task and continue the run.
#[tauri::command]
pub fn skip_conflicted_task(
    db: State<'_, DbState>,
    cont: State<'_, QueueState>,
    app: AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let ib = db::integration_branches::get_active_for_project(&conn, &project_id)?
        .ok_or_else(|| AppError::NotFound("No active integration branch".into()))?;

    let task_id = ib.conflict_task.as_ref()
        .ok_or_else(|| AppError::Validation("No conflict task to skip".into()))?
        .clone();

    // Clear conflict and remove from pending
    db::integration_branches::clear_conflict(&conn, &ib.id)?;
    db::integration_branches::remove_pending_task(&conn, &ib.id, &task_id)?;

    // Mark the queue item as error
    drop(conn);
    {
        let mut guard = cont.blocking_lock();
        if let Some(run) = guard.get_mut(&project_id) {
            for item in &mut run.queue {
                if item.task_id == task_id {
                    item.status = QueueItemStatus::Error;
                    item.error = Some("Skipped due to merge conflict".to_string());
                    break;
                }
            }
            run.status = QueueStatus::Running;
            let _ = app.emit("queue-mode-update", queue::QueueModeUpdate {
                project_id: project_id.clone(),
                run: run.clone(),
            });
        }
    }

    // Advance to next task
    queue::try_advance(&app, &project_id)?;

    tracing::info!(task_id = %task_id, "Skipped conflicted task, run resumed");
    Ok(())
}

/// Clean up an integration branch and its associated branches/worktrees.
#[tauri::command]
pub fn cleanup_integration_branch(
    db: State<'_, DbState>,
    project_id: String,
    integration_branch_id: String,
    delete_remote: bool,
) -> Result<(), AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let ib = db::integration_branches::get(&conn, &integration_branch_id)?
        .ok_or_else(|| AppError::NotFound("Integration branch".into()))?;

    let project = db::projects::get(&conn, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    let repo_path = std::path::Path::new(&project.path);

    // Delete integration branch locally
    if let Err(e) = crate::git::delete_branch(repo_path, &ib.branch_name) {
        tracing::warn!(%e, branch = %ib.branch_name, "Failed to delete local integration branch");
    }

    // Delete remote branch if requested and it was pushed
    if delete_remote && ib.pushed {
        if let Err(e) = crate::git::delete_remote_branch(repo_path, &ib.branch_name, "origin") {
            tracing::warn!(%e, branch = %ib.branch_name, "Failed to delete remote integration branch");
        }
    }

    // Mark as cleaned up
    db::integration_branches::mark_cleaned_up(&conn, &integration_branch_id)?;

    tracing::info!(branch = %ib.branch_name, "Integration branch cleaned up");
    Ok(())
}

/// Push the integration branch to remote manually.
#[tauri::command]
pub fn push_integration_branch(
    db: State<'_, DbState>,
    project_id: String,
    integration_branch_id: String,
) -> Result<(), AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let ib = db::integration_branches::get(&conn, &integration_branch_id)?
        .ok_or_else(|| AppError::NotFound("Integration branch".into()))?;

    let project = db::projects::get(&conn, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    let repo_path = std::path::Path::new(&project.path);

    crate::git::push_integration_branch(repo_path, &ib.branch_name, "origin")?;
    db::integration_branches::mark_pushed(&conn, &integration_branch_id)?;

    tracing::info!(branch = %ib.branch_name, "Pushed integration branch to remote");
    Ok(())
}
