use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;

use crate::db;
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

/// Launch the next task in the queue, or finish the run.
/// Called after a session completes successfully.
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
        let finished_run = run.clone();
        let pid = project_id.to_string();

        // Emit finished before removing
        let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
            project_id: pid.clone(),
            run: finished_run,
        });
        let _ = app.emit("continuous-mode-finished", ContinuousModeFinished {
            project_id: pid.clone(),
            completed_count,
        });

        guard.remove(project_id);
        return Ok(());
    }

    run.current_index = next_index;
    run.queue[next_index].status = QueueItemStatus::Running;

    let task_id = run.queue[next_index].task_id.clone();
    let agent = run.agent_name.clone();
    let model = run.model.clone();
    let strategy = run.strategy;
    let base_branch = run.base_branch.clone();
    let last_branch = run.last_branch.clone();
    let pid = project_id.to_string();

    // Emit update before launching (shows "running" on next item)
    let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
        project_id: pid.clone(),
        run: run.clone(),
    });

    // Drop lock before launching session (it acquires DB lock)
    drop(guard);

    // Launch the next task session
    let launch_base = match strategy {
        BranchingStrategy::Independent => base_branch.as_deref(),
        BranchingStrategy::Chained => last_branch.as_deref().or(base_branch.as_deref()),
    };

    let session = launch_task_for_continuous(app, &pid, &task_id, agent.as_deref(), model.as_deref(), launch_base)?;

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

/// Stop the completed session and advance the queue.
/// Called from the MCP report_complete handler after a delay.
pub fn stop_current_and_advance(app: &AppHandle, session_id: &str) {
    let cont_state: tauri::State<'_, ContinuousState> = app.state();
    let project_id = {
        let guard = cont_state.blocking_lock();
        let mut found = None;
        for (pid, run) in guard.iter() {
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

    // Stop the session
    let db_state: tauri::State<'_, DbState> = app.state();
    let pty_state: tauri::State<'_, PtyState> = app.state();
    let mcp_state: tauri::State<'_, Arc<TokioMutex<McpState>>> = app.state();

    if let Ok(conn) = db_state.lock() {
        let _ = session::stop_session(&conn, &pty_state, app, &mcp_state, session_id);
    }

    // Advance to next task
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
/// If the agent didn't call report_complete, this is a crash — pause the run.
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

    // Agent crashed without reporting complete — mark error and pause
    tracing::warn!(session_id, "PTY exited without report_complete, pausing continuous run");

    let mut guard = cont_state.blocking_lock();
    if let Some(run) = guard.get_mut(&project_id) {
        // Mark current queue item as error
        for item in &mut run.queue {
            if item.session_id.as_deref() == Some(session_id) {
                item.status = QueueItemStatus::Error;
                item.error = Some("Agent exited without completing".to_string());
                break;
            }
        }
        run.status = ContinuousStatus::Paused;

        let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
            project_id: project_id.clone(),
            run: run.clone(),
        });
    }
}

/// Handle manual session stop — pause the continuous run.
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

    let mut guard = cont_state.blocking_lock();
    if let Some(run) = guard.get_mut(&project_id) {
        run.status = ContinuousStatus::Paused;
        let _ = app.emit("continuous-mode-update", ContinuousModeUpdate {
            project_id: project_id.clone(),
            run: run.clone(),
        });
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
) -> Result<db::models::Session, AppError> {
    let db_state: tauri::State<'_, DbState> = app.state();
    let pty_state: tauri::State<'_, PtyState> = app.state();
    let mcp_state: tauri::State<'_, Arc<TokioMutex<McpState>>> = app.state();

    // Get MCP port BEFORE acquiring DB lock to avoid nested mutex contention
    let mcp_port = session::get_mcp_port(&mcp_state);
    let conn = db_state.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Look up task to get the task_file_path for the user prompt
    let task = db::tasks::get(&conn, task_id, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;
    let user_prompt = task.task_file_path.as_deref().map(|path| {
        format!(
            "Work on task {task_id} located at {path}. \
             Read the task file and begin working on it."
        )
    });

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
