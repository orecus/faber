use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;

use crate::acp::state::AcpState;
use crate::commands::prompts;
use crate::db;
use crate::db::models::SessionTransport;
use crate::db::DbState;
use crate::error::AppError;
use crate::mcp::McpState;
use crate::pty::PtyState;
use crate::session;

// ── Types ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContinuousStatus {
    Running,
    Paused,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QueueItemStatus {
    Pending,
    Running,
    Completed,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BranchingStrategy {
    Independent,
    Chained,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuousQueueItem {
    pub task_id: String,
    pub status: QueueItemStatus,
    pub session_id: Option<String>,
    pub error: Option<String>,
    /// Resolved agent for this task (task-level override or run-level default).
    pub agent_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuousRun {
    pub project_id: String,
    pub status: ContinuousStatus,
    pub queue: Vec<ContinuousQueueItem>,
    pub current_index: usize,
    pub strategy: BranchingStrategy,
    pub base_branch: Option<String>,
    pub agent_name: Option<String>,
    pub model: Option<String>,
    pub last_branch: Option<String>,
    /// Transport for session launch (pty or acp). Defaults to pty.
    #[serde(default)]
    pub transport: SessionTransport,
}

pub type ContinuousState = Arc<TokioMutex<HashMap<String, ContinuousRun>>>;

// ── Event payloads ──

#[derive(Clone, Serialize)]
pub struct ContinuousModeUpdate {
    pub project_id: String,
    pub run: ContinuousRun,
}

#[derive(Clone, Serialize)]
pub struct ContinuousModeFinished {
    pub project_id: String,
    pub completed_count: usize,
}

// ── State constructor ──

pub fn new_state() -> ContinuousState {
    Arc::new(TokioMutex::new(HashMap::new()))
}

// ── Lookups ──

/// Find the project_id for a continuous run that contains the given session_id.
pub async fn find_run_by_session(
    state: &ContinuousState,
    session_id: &str,
) -> Option<String> {
    let guard = state.lock().await;
    for (project_id, run) in guard.iter() {
        for item in &run.queue {
            if item.session_id.as_deref() == Some(session_id) {
                return Some(project_id.clone());
            }
        }
    }
    None
}

// ── Core advance logic ──

/// Advance the continuous run after a session completes.
/// For chained strategy: launch the next task in sequence.
/// For independent strategy: mark as complete, check if all are done.
pub fn try_advance(app: &AppHandle, project_id: &str) -> Result<(), AppError> {
    let cont_state: tauri::State<'_, ContinuousState> = app.state();
    let mut guard = cont_state.blocking_lock();

    let run = match guard.get_mut(project_id) {
        Some(r) => r,
        None => return Ok(()), // no active run
    };

    // Don't advance if paused
    if run.status == ContinuousStatus::Paused {
        return Ok(());
    }

    match run.strategy {
        BranchingStrategy::Independent => {
            // For independent mode, mark the current item as completed.
            // The session_id matching happens in mark_complete_and_advance.
            // Here we just mark current_index item (set by the caller).
            if run.current_index < run.queue.len() {
                run.queue[run.current_index].status = QueueItemStatus::Completed;
            }

            // Check if all items are finished (completed or error)
            let all_done = run.queue.iter().all(|i| {
                matches!(i.status, QueueItemStatus::Completed | QueueItemStatus::Error)
            });

            if all_done {
                let completed_count = run.queue.iter()
                    .filter(|i| i.status == QueueItemStatus::Completed)
                    .count();
                run.status = ContinuousStatus::Completed;
                tracing::info!(project_id, completed_count, "Continuous mode completed all tasks");

                // Keep run in state — user must dismiss to close sessions
                let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                    project_id: project_id.to_string(),
                    run: run.clone(),
                });
            } else {
                // Still have running items — just emit an update
                let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                    project_id: project_id.to_string(),
                    run: run.clone(),
                });
            }

            Ok(())
        }
        BranchingStrategy::Chained => {
            // Mark current item as completed
            if run.current_index < run.queue.len() {
                run.queue[run.current_index].status = QueueItemStatus::Completed;
            }

            // Move to next
            let next_index = run.current_index + 1;
            if next_index >= run.queue.len() {
                // All done
                let completed_count = run.queue.iter()
                    .filter(|i| i.status == QueueItemStatus::Completed)
                    .count();
                run.status = ContinuousStatus::Completed;
                tracing::info!(project_id, completed_count, "Continuous mode completed all tasks");

                // Keep run in state — user must dismiss to close sessions
                let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                    project_id: project_id.to_string(),
                    run: run.clone(),
                });
                return Ok(());
            }

            run.current_index = next_index;
            run.queue[next_index].status = QueueItemStatus::Running;

            let task_id = run.queue[next_index].task_id.clone();
            tracing::info!(project_id, next_task_id = %task_id, "Continuous mode advancing to next task");
            // Use per-task agent (already resolved: task.agent || run.agent_name)
            let agent = run.queue[next_index].agent_name.clone();
            let model = run.model.clone();
            let base_branch = run.base_branch.clone();
            let last_branch = run.last_branch.clone();
            let transport = run.transport;
            let pid = project_id.to_string();

            // Emit update before launching (shows "running" on next item)
            let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                project_id: pid.clone(),
                run: run.clone(),
            });

            // Drop lock before launching session (it acquires DB lock)
            drop(guard);

            // Chained: branch from the previous task's branch
            let launch_base = last_branch.as_deref().or(base_branch.as_deref());

            let session = launch_task_for_continuous(app, &pid, &task_id, agent.as_deref(), model.as_deref(), launch_base, transport)?;

            // Look up the task's branch name for chained strategy
            let task_branch = if session.worktree_path.is_some() {
                let db_state: tauri::State<'_, DbState> = app.state();
                db_state.lock().ok()
                    .and_then(|conn| db::tasks::get(&conn, &task_id, &pid).ok().flatten())
                    .and_then(|t| t.branch)
            } else {
                None
            };

            // Update the queue item with the session ID + record branch for chaining
            let cont_state: tauri::State<'_, ContinuousState> = app.state();
            let mut guard = cont_state.blocking_lock();
            if let Some(run) = guard.get_mut(&pid) {
                run.queue[next_index].session_id = Some(session.id.clone());
                if let Some(branch) = task_branch {
                    run.last_branch = Some(branch);
                }

                let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                    project_id: pid.clone(),
                    run: run.clone(),
                });
            }

            Ok(())
        }
    }
}

/// Mark the completed session's queue item and advance the queue.
/// Called from the MCP report_complete handler after a delay.
/// Sessions are NOT stopped here — they stay alive so the user can review
/// agent summaries. The user dismisses them via the continuous mode bar.
pub fn mark_complete_and_advance(app: &AppHandle, session_id: &str) {
    let cont_state: tauri::State<'_, ContinuousState> = app.state();
    let (project_id, item_index) = {
        let guard = cont_state.blocking_lock();
        let mut found = None;
        for (pid, run) in guard.iter() {
            for (i, item) in run.queue.iter().enumerate() {
                if item.session_id.as_deref() == Some(session_id) {
                    found = Some((pid.clone(), i));
                    break;
                }
            }
            if found.is_some() { break; }
        }
        match found {
            Some(f) => f,
            None => return,
        }
    };

    // Set current_index to the completed item so try_advance marks the right one
    {
        let mut guard = cont_state.blocking_lock();
        if let Some(run) = guard.get_mut(&project_id) {
            run.current_index = item_index;
        }
    }

    // Advance to next task (or check if all done for independent mode)
    if let Err(e) = try_advance(app, &project_id) {
        tracing::error!(%e, session_id, "Failed to advance continuous mode after session");
        // Pause on error
        let mut guard = cont_state.blocking_lock();
        if let Some(run) = guard.get_mut(&project_id) {
            run.status = ContinuousStatus::Paused;
            let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                project_id: project_id.clone(),
                run: run.clone(),
            });
        }
    }
}

/// Handle PTY exit for a session that's part of a continuous run.
/// If the agent didn't call report_complete, this is a crash.
/// For chained mode: pause the run.
/// For independent mode: mark the item as error but continue others; finish if all done.
pub fn handle_pty_exit(app: &AppHandle, session_id: &str) {
    let cont_state: tauri::State<'_, ContinuousState> = app.state();
    let mcp_state: tauri::State<'_, Arc<TokioMutex<McpState>>> = app.state();

    // Check if this session is part of a continuous run
    let project_id = {
        let guard = cont_state.blocking_lock();
        let mut found = None;
        for (pid, run) in guard.iter() {
            if run.status != ContinuousStatus::Running { continue; }
            for item in &run.queue {
                if item.session_id.as_deref() == Some(session_id)
                    && item.status == QueueItemStatus::Running
                {
                    found = Some(pid.clone());
                    break;
                }
            }
            if found.is_some() { break; }
        }
        found
    };

    let Some(project_id) = project_id else { return };

    // Check if MCP got a completion for this session
    let completed = {
        let guard = mcp_state.blocking_lock();
        guard.sessions.get(session_id)
            .map(|d| d.completed)
            .unwrap_or(false)
    };

    if completed {
        // Normal exit after report_complete — auto-advance is already scheduled
        return;
    }

    // Agent crashed without reporting complete — mark error
    tracing::warn!(session_id, "PTY exited without report_complete in continuous run");

    let mut guard = cont_state.blocking_lock();
    if let Some(run) = guard.get_mut(&project_id) {
        // Mark the specific queue item as error
        for item in &mut run.queue {
            if item.session_id.as_deref() == Some(session_id) {
                item.status = QueueItemStatus::Error;
                item.error = Some("Agent exited without completing".to_string());
                break;
            }
        }

        match run.strategy {
            BranchingStrategy::Independent => {
                // Check if all items are finished (completed or error)
                let all_done = run.queue.iter().all(|i| {
                    matches!(i.status, QueueItemStatus::Completed | QueueItemStatus::Error)
                });

                if all_done {
                    run.status = ContinuousStatus::Completed;
                }

                // Emit update (keep run in state for user to dismiss)
                let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
            BranchingStrategy::Chained => {
                // Chained mode: pause on any error
                run.status = ContinuousStatus::Paused;
                let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
        }
    }
}

/// Handle manual session stop.
/// For chained mode: pause the entire run.
/// For independent mode: mark item as error, check if all done, continue otherwise.
pub fn handle_manual_stop(app: &AppHandle, session_id: &str) {
    let cont_state: tauri::State<'_, ContinuousState> = app.state();

    let project_id = {
        let guard = cont_state.blocking_lock();
        let mut found = None;
        for (pid, run) in guard.iter() {
            if run.status != ContinuousStatus::Running { continue; }
            for item in &run.queue {
                if item.session_id.as_deref() == Some(session_id) {
                    found = Some(pid.clone());
                    break;
                }
            }
            if found.is_some() { break; }
        }
        found
    };

    let Some(project_id) = project_id else { return };

    tracing::info!(session_id, "Continuous mode: manual session stop");

    let mut guard = cont_state.blocking_lock();
    if let Some(run) = guard.get_mut(&project_id) {
        // Mark the stopped item
        for item in &mut run.queue {
            if item.session_id.as_deref() == Some(session_id) {
                item.status = QueueItemStatus::Error;
                item.error = Some("Manually stopped".to_string());
                break;
            }
        }

        match run.strategy {
            BranchingStrategy::Independent => {
                // Check if all items are finished
                let all_done = run.queue.iter().all(|i| {
                    matches!(i.status, QueueItemStatus::Completed | QueueItemStatus::Error)
                });

                if all_done {
                    run.status = ContinuousStatus::Completed;
                }

                // Emit update (keep run in state for user to dismiss)
                let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
            BranchingStrategy::Chained => {
                // Chained mode: pause entire run
                run.status = ContinuousStatus::Paused;
                let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
        }
    }
}

// ── Internal helpers ──

/// Launch a task session for continuous mode.
fn launch_task_for_continuous(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
    agent: Option<&str>,
    model: Option<&str>,
    base_branch: Option<&str>,
    transport: SessionTransport,
) -> Result<db::models::Session, AppError> {
    let db_state: tauri::State<'_, DbState> = app.state();
    let mcp_state: tauri::State<'_, Arc<TokioMutex<McpState>>> = app.state();

    // Get MCP port BEFORE acquiring DB lock to avoid nested mutex contention
    let mcp_port = session::get_mcp_port(&mcp_state);
    let conn = db_state.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let template = prompts::get_session_prompt(&conn, "continuous");
    let mut vars = HashMap::new();
    vars.insert("task_id", task_id);
    vars.insert("mode", "chained");
    let user_prompt = Some(session::interpolate_vars(&template.prompt, &vars));

    match transport {
        SessionTransport::Acp => {
            let acp_state: tauri::State<'_, AcpState> = app.state();
            let opts = session::AcpTaskSessionOpts {
                task_id,
                agent_name: agent,
                model,
                create_worktree: true,
                base_branch,
                user_prompt: user_prompt.as_deref(),
                is_trust_mode: true,
            };
            session::start_acp_task_session(&conn, app, &mcp_state, &acp_state, mcp_port, project_id, &opts)
        }
        SessionTransport::Pty => {
            let pty_state: tauri::State<'_, PtyState> = app.state();
            session::start_task_session(
                &conn,
                &pty_state,
                app,
                &mcp_state,
                mcp_port,
                project_id,
                task_id,
                agent,
                model,
                true, // always create worktree
                base_branch,
                user_prompt.as_deref(),
            )
        }
    }
}
