use std::collections::{HashMap, HashSet};
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
pub enum QueueStatus {
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
    /// Blocked because a dependency errored — will never run.
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BranchingStrategy {
    Independent,
    Chained,
    /// Dependency-aware execution: tasks launch when all their in-queue
    /// dependencies are complete. Root tasks (no deps) launch immediately
    /// in parallel; downstream tasks launch as deps finish.
    Dag,
}

/// Worktree/merge strategy for a queue or autonomous run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorktreeStrategy {
    /// Auto-merge to a shared integration branch after each task.
    /// Worktrees are cleaned after merge. Single branch at end.
    Integration,
    /// Separate worktrees from base branch, no auto-merge.
    /// Current behavior — user manages merge ordering.
    Independent,
    /// Single worktree, concurrency=1, all tasks commit sequentially.
    /// Deprecated: not exposed in UI — kept for potential future use.
    #[deprecated(note = "Not exposed in UI — kept for potential future use")]
    Sequential,
}

impl WorktreeStrategy {
    #[allow(deprecated)]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Integration => "integration",
            Self::Independent => "independent",
            Self::Sequential => "sequential",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub task_id: String,
    pub status: QueueItemStatus,
    pub session_id: Option<String>,
    pub error: Option<String>,
    /// Resolved agent for this task (task-level override or run-level default).
    pub agent_name: Option<String>,
    /// In-queue dependency task IDs (only populated for DAG strategy).
    #[serde(default)]
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueRun {
    pub project_id: String,
    pub status: QueueStatus,
    pub queue: Vec<QueueItem>,
    pub current_index: usize,
    pub strategy: BranchingStrategy,
    pub base_branch: Option<String>,
    pub agent_name: Option<String>,
    pub model: Option<String>,
    pub last_branch: Option<String>,
    /// Transport for session launch (pty or acp). Defaults to pty.
    #[serde(default)]
    pub transport: SessionTransport,
    /// Worktree/merge strategy for this run.
    #[serde(default)]
    pub worktree_strategy: Option<WorktreeStrategy>,
    /// DB ID of the integration branch record (when using Integration strategy).
    #[serde(default)]
    pub integration_branch_id: Option<String>,
    /// Generated run ID for branch naming.
    #[serde(default)]
    pub run_id: Option<String>,
}

pub type QueueState = Arc<TokioMutex<HashMap<String, QueueRun>>>;

// ── Event payloads ──

#[derive(Clone, Serialize)]
pub struct QueueModeUpdate {
    pub project_id: String,
    pub run: QueueRun,
}

#[derive(Clone, Serialize)]
pub struct QueueModeFinished {
    pub project_id: String,
    pub completed_count: usize,
}

// ── Integration branch event payloads ──

#[derive(Clone, Serialize)]
pub struct TaskMergedEvent {
    pub task_id: String,
    pub integration_branch: String,
    pub merge_commit: String,
}

#[derive(Clone, Serialize)]
pub struct MergeConflictEvent {
    pub task_id: String,
    pub integration_branch: String,
    pub conflicting_files: Vec<String>,
}

#[derive(Clone, Serialize)]
pub struct RunCompletedEvent {
    pub run_id: String,
    pub integration_branch: String,
    pub merged_count: usize,
}

#[derive(Clone, Serialize)]
pub struct IntegrationBranchUpdatedEvent {
    pub branch_name: String,
    pub merged_count: usize,
    pub pending_count: usize,
}

// ── State constructor ──

pub fn new_state() -> QueueState {
    Arc::new(TokioMutex::new(HashMap::new()))
}

// ── Lookups ──

/// Find the project_id for a queue run that contains the given session_id.
pub async fn find_run_by_session(
    state: &QueueState,
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

/// Advance the queue run after a session completes.
/// For chained strategy: launch the next task in sequence.
/// For independent strategy: mark as complete, check if all are done.
/// For dag strategy: mark complete, find newly-unblocked tasks, launch them.
pub fn try_advance(app: &AppHandle, project_id: &str) -> Result<(), AppError> {
    let cont_state: tauri::State<'_, QueueState> = app.state();
    let mut guard = cont_state.blocking_lock();

    let run = match guard.get_mut(project_id) {
        Some(r) => r,
        None => return Ok(()), // no active run
    };

    // Don't advance if paused
    if run.status == QueueStatus::Paused {
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
                run.status = QueueStatus::Completed;
                tracing::info!(project_id, completed_count, "Queue mode completed all tasks");
            }

            let _ = app.emit("queue-mode-update", QueueModeUpdate {
                project_id: project_id.to_string(),
                run: run.clone(),
            });

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
                run.status = QueueStatus::Completed;
                tracing::info!(project_id, completed_count, "Queue mode completed all tasks");

                let _ = app.emit("queue-mode-update", QueueModeUpdate {
                    project_id: project_id.to_string(),
                    run: run.clone(),
                });
                return Ok(());
            }

            run.current_index = next_index;
            run.queue[next_index].status = QueueItemStatus::Running;

            let task_id = run.queue[next_index].task_id.clone();
            tracing::info!(project_id, next_task_id = %task_id, "Queue mode advancing to next task");
            let agent = run.queue[next_index].agent_name.clone();
            let model = run.model.clone();
            let base_branch = run.base_branch.clone();
            let last_branch = run.last_branch.clone();
            let transport = run.transport;
            let pid = project_id.to_string();
            let uses_integration = run.worktree_strategy == Some(WorktreeStrategy::Integration);
            let integration_branch_name = if uses_integration {
                run.integration_branch_id.as_ref().and_then(|ib_id| {
                    let db_state: tauri::State<'_, DbState> = app.state();
                    db_state.lock().ok()
                        .and_then(|conn| db::integration_branches::get(&conn, ib_id).ok().flatten())
                        .map(|ib| ib.branch_name)
                })
            } else {
                None
            };

            let _ = app.emit("queue-mode-update", QueueModeUpdate {
                project_id: pid.clone(),
                run: run.clone(),
            });

            // Drop lock before launching session (it acquires DB lock)
            drop(guard);

            let launch_base = if let Some(ref ib_name) = integration_branch_name {
                Some(ib_name.as_str())
            } else {
                last_branch.as_deref().or(base_branch.as_deref())
            };

            let session = launch_task_for_queue(app, &pid, &task_id, agent.as_deref(), model.as_deref(), launch_base, transport)?;

            let task_branch = if session.worktree_path.is_some() {
                let db_state: tauri::State<'_, DbState> = app.state();
                db_state.lock().ok()
                    .and_then(|conn| db::tasks::get(&conn, &task_id, &pid).ok().flatten())
                    .and_then(|t| t.branch)
            } else {
                None
            };

            let cont_state: tauri::State<'_, QueueState> = app.state();
            let mut guard = cont_state.blocking_lock();
            if let Some(run) = guard.get_mut(&pid) {
                run.queue[next_index].session_id = Some(session.id.clone());
                if let Some(branch) = task_branch {
                    run.last_branch = Some(branch);
                }

                let _ = app.emit("queue-mode-update", QueueModeUpdate {
                    project_id: pid.clone(),
                    run: run.clone(),
                });
            }

            Ok(())
        }
        BranchingStrategy::Dag => {
            // Mark the completed item
            if run.current_index < run.queue.len() {
                run.queue[run.current_index].status = QueueItemStatus::Completed;
            }
            let completed_task_id = run.queue.get(run.current_index)
                .map(|i| i.task_id.clone())
                .unwrap_or_default();

            // Find newly-unblocked tasks: pending items whose deps are all completed
            let completed_ids: HashSet<&str> = run.queue.iter()
                .filter(|i| i.status == QueueItemStatus::Completed)
                .map(|i| i.task_id.as_str())
                .collect();

            let ready_indices: Vec<usize> = run.queue.iter().enumerate()
                .filter(|(_, item)| {
                    item.status == QueueItemStatus::Pending
                        && item.depends_on.iter().all(|dep| completed_ids.contains(dep.as_str()))
                })
                .map(|(i, _)| i)
                .collect();

            tracing::info!(
                project_id,
                completed_task = %completed_task_id,
                newly_ready = ready_indices.len(),
                "DAG: task completed, checking unblocked tasks"
            );

            // Mark them as running and collect launch info
            let mut to_launch: Vec<DagLaunchInfo> = Vec::new();
            for &idx in &ready_indices {
                run.queue[idx].status = QueueItemStatus::Running;
                to_launch.push(DagLaunchInfo {
                    index: idx,
                    task_id: run.queue[idx].task_id.clone(),
                    agent: run.queue[idx].agent_name.clone(),
                });
            }

            // Check if everything is finished
            let all_done = run.queue.iter().all(|i| {
                matches!(i.status, QueueItemStatus::Completed | QueueItemStatus::Error | QueueItemStatus::Blocked)
            });

            if all_done {
                let completed_count = run.queue.iter()
                    .filter(|i| i.status == QueueItemStatus::Completed)
                    .count();
                run.status = QueueStatus::Completed;
                tracing::info!(project_id, completed_count, "DAG queue completed all tasks");
            }

            let model = run.model.clone();
            let base_branch = run.base_branch.clone();
            let transport = run.transport;
            let pid = project_id.to_string();
            let uses_integration = run.worktree_strategy == Some(WorktreeStrategy::Integration);
            let integration_branch_name = if uses_integration {
                run.integration_branch_id.as_ref().and_then(|ib_id| {
                    let db_state: tauri::State<'_, DbState> = app.state();
                    db_state.lock().ok()
                        .and_then(|conn| db::integration_branches::get(&conn, ib_id).ok().flatten())
                        .map(|ib| ib.branch_name)
                })
            } else {
                None
            };

            let _ = app.emit("queue-mode-update", QueueModeUpdate {
                project_id: pid.clone(),
                run: run.clone(),
            });

            // Drop lock before launching sessions
            drop(guard);

            // Launch all newly-ready tasks
            for info in &to_launch {
                let launch_base = if let Some(ref ib_name) = integration_branch_name {
                    Some(ib_name.as_str())
                } else {
                    base_branch.as_deref()
                };

                match launch_task_for_queue(app, &pid, &info.task_id, info.agent.as_deref(), model.as_deref(), launch_base, transport) {
                    Ok(session) => {
                        let cont_state: tauri::State<'_, QueueState> = app.state();
                        let mut guard = cont_state.blocking_lock();
                        if let Some(run) = guard.get_mut(&pid) {
                            run.queue[info.index].session_id = Some(session.id.clone());
                            let _ = app.emit("queue-mode-update", QueueModeUpdate {
                                project_id: pid.clone(),
                                run: run.clone(),
                            });
                        }
                    }
                    Err(e) => {
                        tracing::error!(task_id = %info.task_id, %e, "DAG: failed to launch task");
                        let cont_state: tauri::State<'_, QueueState> = app.state();
                        let mut guard = cont_state.blocking_lock();
                        if let Some(run) = guard.get_mut(&pid) {
                            run.queue[info.index].status = QueueItemStatus::Error;
                            run.queue[info.index].error = Some(format!("Launch failed: {e}"));
                            // Block dependents of this failed task
                            block_dependents(run, &info.task_id);
                            let _ = app.emit("queue-mode-update", QueueModeUpdate {
                                project_id: pid.clone(),
                                run: run.clone(),
                            });
                        }
                    }
                }
            }

            // Re-check completion after all launches (some may have failed → blocked more)
            {
                let cont_state: tauri::State<'_, QueueState> = app.state();
                let mut guard = cont_state.blocking_lock();
                if let Some(run) = guard.get_mut(&pid) {
                    let all_done = run.queue.iter().all(|i| {
                        matches!(i.status, QueueItemStatus::Completed | QueueItemStatus::Error | QueueItemStatus::Blocked)
                    });
                    if all_done && run.status != QueueStatus::Completed {
                        let completed_count = run.queue.iter()
                            .filter(|i| i.status == QueueItemStatus::Completed)
                            .count();
                        run.status = QueueStatus::Completed;
                        tracing::info!(project_id = %pid, completed_count, "DAG queue completed (some tasks blocked/errored)");
                        let _ = app.emit("queue-mode-update", QueueModeUpdate {
                            project_id: pid.clone(),
                            run: run.clone(),
                        });
                    }
                }
            }

            Ok(())
        }
    }
}

/// Info needed to launch a task in DAG mode (extracted while holding the lock).
struct DagLaunchInfo {
    index: usize,
    task_id: String,
    agent: Option<String>,
}

/// Block all pending tasks in a queue vec that transitively depend on `errored_task_id`.
/// Used during initial launch before the QueueRun is constructed.
pub fn block_dependents_in_queue(queue: &mut [QueueItem], errored_task_id: &str) {
    let mut to_block: Vec<String> = vec![errored_task_id.to_string()];
    while let Some(failed_id) = to_block.pop() {
        for item in queue.iter_mut() {
            if item.status == QueueItemStatus::Pending
                && item.depends_on.iter().any(|d| d == &failed_id)
            {
                item.status = QueueItemStatus::Blocked;
                item.error = Some(format!("Blocked: dependency {} failed", failed_id));
                to_block.push(item.task_id.clone());
            }
        }
    }
}

/// Block all pending tasks that transitively depend on `errored_task_id`.
/// Uses BFS to cascade the blocked status through the dependency graph.
fn block_dependents(run: &mut QueueRun, errored_task_id: &str) {
    let mut to_block: Vec<String> = vec![errored_task_id.to_string()];
    let mut blocked_count = 0usize;

    while let Some(failed_id) = to_block.pop() {
        for item in run.queue.iter_mut() {
            if item.status == QueueItemStatus::Pending
                && item.depends_on.iter().any(|d| d == &failed_id)
            {
                item.status = QueueItemStatus::Blocked;
                item.error = Some(format!("Blocked: dependency {} failed", failed_id));
                to_block.push(item.task_id.clone());
                blocked_count += 1;
            }
        }
    }

    if blocked_count > 0 {
        tracing::info!(errored_task = %errored_task_id, blocked_count, "DAG: blocked dependent tasks");
    }
}

/// Attempt to auto-merge a completed task's branch into the integration branch.
///
/// Called when a task completes and the run uses the Integration worktree strategy.
/// Returns `true` if the merge succeeded (or there's no integration branch),
/// `false` if there was a conflict (run should be paused).
fn try_auto_merge(
    app: &AppHandle,
    project_id: &str,
    task_id: &str,
    integration_branch_id: &str,
) -> bool {
    let db_state: tauri::State<'_, DbState> = app.state();

    let conn = match db_state.lock() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(%e, "Failed to lock DB for auto-merge");
            return false;
        }
    };

    // Get the integration branch record
    let ib = match db::integration_branches::get(&conn, integration_branch_id) {
        Ok(Some(ib)) => ib,
        Ok(None) => {
            tracing::warn!(integration_branch_id, "Integration branch record not found");
            return true; // Don't block on missing record
        }
        Err(e) => {
            tracing::error!(%e, "Failed to get integration branch");
            return false;
        }
    };

    // Get the task to find its branch name
    let task = match db::tasks::get(&conn, task_id, project_id) {
        Ok(Some(t)) => t,
        _ => {
            tracing::warn!(task_id, "Task not found for auto-merge");
            return true;
        }
    };

    let task_branch = match &task.branch {
        Some(b) => b.clone(),
        None => {
            tracing::warn!(task_id, "Task has no branch — skipping merge");
            return true;
        }
    };

    // Get the project path
    let project = match db::projects::get(&conn, project_id) {
        Ok(Some(p)) => p,
        _ => {
            tracing::error!(project_id, "Project not found for auto-merge");
            return false;
        }
    };

    let repo_path = std::path::Path::new(&project.path);
    let commit_msg = format!("Merge {}: {}", task_id, task.title);

    // Attempt the merge
    match crate::git::merge_task_branch(repo_path, &ib.branch_name, &task_branch, &commit_msg) {
        Ok(crate::git::MergeResult::Success { commit_hash }) => {
            // Record the successful merge
            if let Err(e) = db::integration_branches::record_merge(&conn, &ib.id, task_id) {
                tracing::error!(%e, task_id, "Failed to record merge in DB");
            }

            // Auto-advance task to done
            let _ = crate::commands::tasks::do_update_task_status(
                &conn, project_id, task_id, "done",
            );

            // Clean up the worktree (work preserved on integration branch)
            if let Some(wt_path) = &task.worktree_path {
                let wt = std::path::Path::new(wt_path);
                if let Err(e) = crate::git::delete_worktree(repo_path, wt) {
                    tracing::warn!(%e, task_id, worktree = wt_path, "Failed to cleanup worktree after merge");
                } else {
                    // Clear worktree path from task
                    let _ = db::tasks::update_worktree(&conn, task_id, project_id, None);
                    tracing::info!(task_id, worktree = wt_path, "Cleaned up worktree after merge");
                }
            }

            // Delete the task branch (work lives on integration branch)
            if let Err(e) = crate::git::delete_task_branch(repo_path, &task_branch) {
                tracing::warn!(%e, task_id, branch = %task_branch, "Failed to delete task branch after merge");
            }

            // Emit events
            let _ = app.emit("task-merged", TaskMergedEvent {
                task_id: task_id.to_string(),
                integration_branch: ib.branch_name.clone(),
                merge_commit: commit_hash,
            });

            // Get updated counts for the update event
            if let Ok(Some(updated_ib)) = db::integration_branches::get(&conn, &ib.id) {
                let _ = app.emit("integration-branch-updated", IntegrationBranchUpdatedEvent {
                    branch_name: updated_ib.branch_name,
                    merged_count: updated_ib.merged_tasks.len(),
                    pending_count: updated_ib.pending_tasks.len(),
                });
            }

            tracing::info!(task_id, "Auto-merged task branch into integration branch");
            true
        }
        Ok(crate::git::MergeResult::Conflict { files }) => {
            // Record the conflict
            if let Err(e) = db::integration_branches::record_conflict(&conn, &ib.id, task_id, &files) {
                tracing::error!(%e, task_id, "Failed to record merge conflict in DB");
            }

            // Emit conflict event
            let _ = app.emit("merge-conflict", MergeConflictEvent {
                task_id: task_id.to_string(),
                integration_branch: ib.branch_name.clone(),
                conflicting_files: files,
            });

            tracing::warn!(task_id, "Merge conflict — run paused");
            false
        }
        Err(e) => {
            tracing::error!(%e, task_id, "Auto-merge failed unexpectedly");
            false
        }
    }
}

/// Check if a completed run should trigger upstream actions and emit completion.
fn check_run_completion(
    app: &AppHandle,
    _project_id: &str,
    run: &QueueRun,
) {
    let ib_id = match &run.integration_branch_id {
        Some(id) => id.clone(),
        None => return,
    };

    let run_id = run.run_id.clone().unwrap_or_default();

    let db_state: tauri::State<'_, DbState> = app.state();
    let conn = match db_state.lock() {
        Ok(c) => c,
        Err(_) => return,
    };

    // Mark integration branch as completed
    let _ = db::integration_branches::mark_completed(&conn, &ib_id);

    // Get updated state
    if let Ok(Some(ib)) = db::integration_branches::get(&conn, &ib_id) {
        let _ = app.emit("run-completed", RunCompletedEvent {
            run_id,
            integration_branch: ib.branch_name,
            merged_count: ib.merged_tasks.len(),
        });
    }
}

/// Mark the completed session's queue item and advance the queue.
/// Called from the MCP report_complete handler after a delay.
/// Sessions are NOT stopped here — they stay alive so the user can review
/// agent summaries. The user dismisses them via the queue mode bar.
pub fn mark_complete_and_advance(app: &AppHandle, session_id: &str) {
    let cont_state: tauri::State<'_, QueueState> = app.state();
    let (project_id, item_index, task_id, uses_integration, ib_id) = {
        let guard = cont_state.blocking_lock();
        let mut found = None;
        for (pid, run) in guard.iter() {
            for (i, item) in run.queue.iter().enumerate() {
                if item.session_id.as_deref() == Some(session_id) {
                    found = Some((
                        pid.clone(),
                        i,
                        item.task_id.clone(),
                        run.worktree_strategy == Some(WorktreeStrategy::Integration),
                        run.integration_branch_id.clone(),
                    ));
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

    // If using integration strategy, attempt auto-merge before advancing
    if uses_integration {
        if let Some(ref ib_id) = ib_id {
            let merge_ok = try_auto_merge(app, &project_id, &task_id, ib_id);
            if !merge_ok {
                // Merge conflict — pause the run
                let mut guard = cont_state.blocking_lock();
                if let Some(run) = guard.get_mut(&project_id) {
                    run.status = QueueStatus::Paused;
                    let _ = app.emit("queue-mode-update", QueueModeUpdate {
                        project_id: project_id.clone(),
                        run: run.clone(),
                    });
                }
                return;
            }
        }
    }

    // Set current_index to the completed item so try_advance marks the right one
    {
        let mut guard = cont_state.blocking_lock();
        if let Some(run) = guard.get_mut(&project_id) {
            run.current_index = item_index;
        }
    }

    // Advance to next task (or check if all done for independent mode)
    if let Err(e) = try_advance(app, &project_id) {
        tracing::error!(%e, session_id, "Failed to advance queue mode after session");
        // Pause on error
        let mut guard = cont_state.blocking_lock();
        if let Some(run) = guard.get_mut(&project_id) {
            run.status = QueueStatus::Paused;
            let _ = app.emit("queue-mode-update", QueueModeUpdate {
                project_id: project_id.clone(),
                run: run.clone(),
            });
        }
        return;
    }

    // Check if the run just completed (all tasks done)
    {
        let guard = cont_state.blocking_lock();
        if let Some(run) = guard.get(&project_id) {
            if run.status == QueueStatus::Completed && uses_integration {
                check_run_completion(app, &project_id, run);
            }
        }
    }
}

/// Handle PTY exit for a session that's part of a queue run.
/// If the agent didn't call report_complete, this is a crash.
/// For chained mode: pause the run.
/// For independent mode: mark the item as error but continue others; finish if all done.
pub fn handle_pty_exit(app: &AppHandle, session_id: &str) {
    let cont_state: tauri::State<'_, QueueState> = app.state();
    let mcp_state: tauri::State<'_, Arc<TokioMutex<McpState>>> = app.state();

    // Check if this session is part of a queue run
    let project_id = {
        let guard = cont_state.blocking_lock();
        let mut found = None;
        for (pid, run) in guard.iter() {
            if run.status != QueueStatus::Running { continue; }
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
    tracing::warn!(session_id, "PTY exited without report_complete in queue run");

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
                    run.status = QueueStatus::Completed;
                }

                let _ = app.emit("queue-mode-update", QueueModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
            BranchingStrategy::Chained => {
                // Chained mode: pause on any error
                run.status = QueueStatus::Paused;
                let _ = app.emit("queue-mode-update", QueueModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
            BranchingStrategy::Dag => {
                // Block dependents of the crashed task, then check completion
                let errored_task_id = run.queue.iter()
                    .find(|i| i.session_id.as_deref() == Some(session_id))
                    .map(|i| i.task_id.clone());

                if let Some(ref tid) = errored_task_id {
                    block_dependents(run, tid);
                }

                let all_done = run.queue.iter().all(|i| {
                    matches!(i.status, QueueItemStatus::Completed | QueueItemStatus::Error | QueueItemStatus::Blocked)
                });

                if all_done {
                    run.status = QueueStatus::Completed;
                }

                let _ = app.emit("queue-mode-update", QueueModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
        }
    }
}

/// Handle manual session stop.
/// For chained mode: pause the entire run.
/// For independent/dag mode: mark item as error, check if all done, continue otherwise.
pub fn handle_manual_stop(app: &AppHandle, session_id: &str) {
    let cont_state: tauri::State<'_, QueueState> = app.state();

    let project_id = {
        let guard = cont_state.blocking_lock();
        let mut found = None;
        for (pid, run) in guard.iter() {
            if run.status != QueueStatus::Running { continue; }
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

    tracing::info!(session_id, "Queue mode: manual session stop");

    let mut guard = cont_state.blocking_lock();
    if let Some(run) = guard.get_mut(&project_id) {
        // Mark the stopped item
        let stopped_task_id = run.queue.iter()
            .find(|i| i.session_id.as_deref() == Some(session_id))
            .map(|i| i.task_id.clone());

        for item in &mut run.queue {
            if item.session_id.as_deref() == Some(session_id) {
                item.status = QueueItemStatus::Error;
                item.error = Some("Manually stopped".to_string());
                break;
            }
        }

        match run.strategy {
            BranchingStrategy::Independent => {
                let all_done = run.queue.iter().all(|i| {
                    matches!(i.status, QueueItemStatus::Completed | QueueItemStatus::Error)
                });

                if all_done {
                    run.status = QueueStatus::Completed;
                }

                let _ = app.emit("queue-mode-update", QueueModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
            BranchingStrategy::Chained => {
                run.status = QueueStatus::Paused;
                let _ = app.emit("queue-mode-update", QueueModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
            BranchingStrategy::Dag => {
                // Block dependents of the stopped task
                if let Some(ref tid) = stopped_task_id {
                    block_dependents(run, tid);
                }

                let all_done = run.queue.iter().all(|i| {
                    matches!(i.status, QueueItemStatus::Completed | QueueItemStatus::Error | QueueItemStatus::Blocked)
                });

                if all_done {
                    run.status = QueueStatus::Completed;
                }

                let _ = app.emit("queue-mode-update", QueueModeUpdate {
                    project_id: project_id.clone(),
                    run: run.clone(),
                });
            }
        }
    }
}

// ── Dependency validation ──

/// Result of dependency graph validation — includes sorted order and strategy hints.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedOrder {
    /// Task IDs in execution order (dependencies before dependents).
    pub sorted_ids: Vec<String>,
    /// Whether any in-queue dependencies exist.
    pub has_deps: bool,
    /// Number of in-queue dependency links.
    pub dep_count: usize,
    /// Whether the dependency graph forms a simple linear chain.
    pub is_chain: bool,
    /// Suggested branching strategy (null if no deps).
    pub suggestion: Option<BranchingStrategy>,
    /// Human-readable reason for the suggestion.
    pub reason: String,
}

/// Validate the dependency graph for a set of queue tasks and return a
/// topologically sorted execution order.
///
/// Checks performed:
/// 1. All `depends_on` references point to task IDs that exist in the DB.
/// 2. External deps (references to tasks outside the queue) must already be
///    "done" — otherwise the dependent task can't run yet.
/// 3. No circular dependencies among the queued tasks.
///
/// On success returns `ValidatedOrder` with task IDs sorted so that every task
/// appears after its in-queue dependencies.
pub fn validate_dependency_graph(
    conn: &rusqlite::Connection,
    project_id: &str,
    task_ids: &[String],
) -> Result<ValidatedOrder, AppError> {
    let queued: HashSet<&str> = task_ids.iter().map(|s| s.as_str()).collect();

    // Collect each queued task's in-queue deps and validate external deps.
    // Uses owned Strings to avoid lifetime issues with task lookups.
    let mut in_queue_deps: HashMap<String, Vec<String>> = HashMap::new();
    for tid in task_ids {
        let task = db::tasks::get(conn, tid, project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Task {tid}")))?;

        let mut deps_in_queue = Vec::new();
        for dep_id in &task.depends_on {
            if queued.contains(dep_id.as_str()) {
                deps_in_queue.push(dep_id.clone());
            } else {
                // External dependency — must exist and be done
                let dep_task = db::tasks::get(conn, dep_id, project_id)?
                    .ok_or_else(|| {
                        AppError::Validation(format!(
                            "Task {tid} depends on {dep_id}, which does not exist"
                        ))
                    })?;
                if dep_task.status.as_str() != "done" {
                    return Err(AppError::Validation(format!(
                        "Task {tid} depends on {dep_id} (not in queue), which is not done (status: {})",
                        dep_task.status
                    )));
                }
            }
        }
        in_queue_deps.insert(tid.clone(), deps_in_queue);
    }

    // Topological sort with cycle detection (Kahn's algorithm)
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    // Reverse adjacency: dep → list of tasks that depend on it
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();

    for tid in task_ids {
        in_degree.entry(tid.as_str()).or_insert(0);
    }
    for (tid, deps) in &in_queue_deps {
        *in_degree.entry(tid.as_str()).or_insert(0) += deps.len();
        for dep in deps {
            dependents.entry(dep.as_str()).or_default().push(tid.as_str());
        }
    }

    let mut queue_bfs: Vec<&str> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();
    // Sort for deterministic output
    queue_bfs.sort();

    let mut sorted: Vec<String> = Vec::with_capacity(task_ids.len());
    while let Some(node) = queue_bfs.pop() {
        sorted.push(node.to_string());
        if let Some(children) = dependents.get(node) {
            for &child in children {
                if let Some(deg) = in_degree.get_mut(child) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue_bfs.push(child);
                        // Re-sort to keep deterministic
                        queue_bfs.sort();
                    }
                }
            }
        }
    }

    if sorted.len() != task_ids.len() {
        // Some nodes never reached in-degree 0 → cycle
        let mut stuck: Vec<&str> = in_degree
            .iter()
            .filter(|(_, &deg)| deg > 0)
            .map(|(&id, _)| id)
            .collect();
        stuck.sort();
        return Err(AppError::Validation(format!(
            "Circular dependency detected among tasks: {}",
            stuck.join(", ")
        )));
    }

    // Compute strategy suggestion metadata
    let dep_count: usize = in_queue_deps.values().map(|d| d.len()).sum();
    let has_deps = dep_count > 0;

    // Check if it forms a linear chain: each task has at most 1 dep,
    // and no task is depended on by more than one other task
    let is_chain = if has_deps {
        let all_single = in_queue_deps.values().all(|d| d.len() <= 1);
        let mut dep_fan_in: HashMap<&str, usize> = HashMap::new();
        for deps in in_queue_deps.values() {
            for d in deps {
                *dep_fan_in.entry(d.as_str()).or_insert(0) += 1;
            }
        }
        all_single && dep_fan_in.values().all(|&c| c <= 1)
    } else {
        false
    };

    let (suggestion, reason) = if !has_deps {
        (None, String::new())
    } else {
        let links = if dep_count == 1 { "link" } else { "links" };
        if is_chain {
            (
                Some(BranchingStrategy::Dag),
                format!("{dep_count} dependency {links} found \u{2014} tasks will run in dependency order"),
            )
        } else {
            (
                Some(BranchingStrategy::Dag),
                format!("{dep_count} dependency {links} detected \u{2014} independent tasks will run in parallel"),
            )
        }
    };

    Ok(ValidatedOrder {
        sorted_ids: sorted,
        has_deps,
        dep_count,
        is_chain,
        suggestion,
        reason,
    })
}

// ── Internal helpers ──

/// Launch a task session for queue mode.
fn launch_task_for_queue(
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

    let template = prompts::get_session_prompt(&conn, "queue");
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::models::{NewProject, NewTask, TaskStatus};
    use crate::db::projects;
    use crate::db::tasks;

    fn setup() -> (rusqlite::Connection, String) {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        projects::create(
            &conn,
            &NewProject {
                name: "test".into(),
                path: "/tmp/test".into(),
                default_agent: None,
                default_model: None,
                branch_naming_pattern: None,
                instruction_file_path: None,
            },
        )
        .unwrap();
        let pid = projects::list(&conn).unwrap()[0].id.clone();
        (conn, pid)
    }

    fn insert_task(
        conn: &rusqlite::Connection,
        id: &str,
        pid: &str,
        status: Option<TaskStatus>,
        depends_on: Vec<String>,
    ) {
        tasks::upsert(
            conn,
            &NewTask {
                id: id.into(),
                project_id: pid.into(),
                task_file_path: None,
                title: format!("Task {id}"),
                status,
                priority: None,
                task_type: None,
                epic_id: None,
                agent: None,
                model: None,
                branch: None,
                worktree_path: None,
                github_issue: None,
                github_pr: None,
                depends_on,
                labels: vec![],
                body: String::new(),
            },
        )
        .unwrap();
    }

    #[test]
    fn no_deps_returns_all_tasks() {
        let (conn, pid) = setup();
        insert_task(&conn, "T-1", &pid, Some(TaskStatus::Ready), vec![]);
        insert_task(&conn, "T-2", &pid, Some(TaskStatus::Ready), vec![]);
        insert_task(&conn, "T-3", &pid, Some(TaskStatus::Ready), vec![]);

        let ids = vec!["T-1".into(), "T-2".into(), "T-3".into()];
        let result = validate_dependency_graph(&conn, &pid, &ids).unwrap();
        assert_eq!(result.sorted_ids.len(), 3);
        assert!(!result.has_deps);
        assert_eq!(result.dep_count, 0);
        assert!(result.suggestion.is_none());
    }

    #[test]
    fn linear_chain_sorted_correctly() {
        let (conn, pid) = setup();
        insert_task(&conn, "T-1", &pid, Some(TaskStatus::Ready), vec![]);
        insert_task(&conn, "T-2", &pid, Some(TaskStatus::Ready), vec!["T-1".into()]);
        insert_task(&conn, "T-3", &pid, Some(TaskStatus::Ready), vec!["T-2".into()]);

        // Pass in reverse order — should still sort correctly
        let ids = vec!["T-3".into(), "T-1".into(), "T-2".into()];
        let result = validate_dependency_graph(&conn, &pid, &ids).unwrap();
        assert_eq!(result.sorted_ids, vec!["T-1", "T-2", "T-3"]);
        assert!(result.has_deps);
        assert_eq!(result.dep_count, 2);
        assert!(result.is_chain);
        assert_eq!(result.suggestion, Some(BranchingStrategy::Dag));
    }

    #[test]
    fn cycle_detected() {
        let (conn, pid) = setup();
        insert_task(&conn, "T-1", &pid, Some(TaskStatus::Ready), vec!["T-2".into()]);
        insert_task(&conn, "T-2", &pid, Some(TaskStatus::Ready), vec!["T-1".into()]);

        let ids = vec!["T-1".into(), "T-2".into()];
        let err = validate_dependency_graph(&conn, &pid, &ids).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Circular dependency"), "got: {msg}");
    }

    #[test]
    fn external_dep_done_is_ok() {
        let (conn, pid) = setup();
        insert_task(&conn, "T-ext", &pid, Some(TaskStatus::Done), vec![]);
        insert_task(&conn, "T-1", &pid, Some(TaskStatus::Ready), vec!["T-ext".into()]);
        insert_task(&conn, "T-2", &pid, Some(TaskStatus::Ready), vec![]);

        // T-ext is NOT in the queue but is done — should pass
        let ids = vec!["T-1".into(), "T-2".into()];
        let result = validate_dependency_graph(&conn, &pid, &ids).unwrap();
        assert_eq!(result.sorted_ids.len(), 2);
    }

    #[test]
    fn external_dep_not_done_errors() {
        let (conn, pid) = setup();
        insert_task(&conn, "T-ext", &pid, Some(TaskStatus::Ready), vec![]);
        insert_task(&conn, "T-1", &pid, Some(TaskStatus::Ready), vec!["T-ext".into()]);

        let ids = vec!["T-1".into()];
        let err = validate_dependency_graph(&conn, &pid, &ids).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("not done"), "got: {msg}");
    }

    #[test]
    fn nonexistent_dep_errors() {
        let (conn, pid) = setup();
        insert_task(&conn, "T-1", &pid, Some(TaskStatus::Ready), vec!["T-ghost".into()]);

        let ids = vec!["T-1".into()];
        let err = validate_dependency_graph(&conn, &pid, &ids).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("does not exist"), "got: {msg}");
    }

    #[test]
    fn diamond_deps_sorted_correctly() {
        let (conn, pid) = setup();
        // T-1 → T-2, T-1 → T-3, T-2 → T-4, T-3 → T-4
        insert_task(&conn, "T-1", &pid, Some(TaskStatus::Ready), vec![]);
        insert_task(&conn, "T-2", &pid, Some(TaskStatus::Ready), vec!["T-1".into()]);
        insert_task(&conn, "T-3", &pid, Some(TaskStatus::Ready), vec!["T-1".into()]);
        insert_task(&conn, "T-4", &pid, Some(TaskStatus::Ready), vec!["T-2".into(), "T-3".into()]);

        let ids = vec!["T-4".into(), "T-2".into(), "T-3".into(), "T-1".into()];
        let result = validate_dependency_graph(&conn, &pid, &ids).unwrap();
        // T-1 must come before T-2 and T-3, and T-4 must be last
        let pos = |id: &str| result.sorted_ids.iter().position(|s| s == id).unwrap();
        assert!(pos("T-1") < pos("T-2"));
        assert!(pos("T-1") < pos("T-3"));
        assert!(pos("T-2") < pos("T-4"));
        assert!(pos("T-3") < pos("T-4"));
        // Diamond is NOT a chain (T-4 depends on 2 tasks)
        assert!(!result.is_chain);
        assert_eq!(result.dep_count, 4);
        assert_eq!(result.suggestion, Some(BranchingStrategy::Dag));
    }

    // ── block_dependents_in_queue tests ──

    fn make_item(task_id: &str, deps: Vec<&str>) -> QueueItem {
        QueueItem {
            task_id: task_id.to_string(),
            status: QueueItemStatus::Pending,
            session_id: None,
            error: None,
            agent_name: None,
            depends_on: deps.into_iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn block_direct_dependents() {
        let mut queue = vec![
            { let mut i = make_item("T-1", vec![]); i.status = QueueItemStatus::Error; i },
            make_item("T-2", vec!["T-1"]),
            make_item("T-3", vec![]),
        ];

        block_dependents_in_queue(&mut queue, "T-1");
        assert_eq!(queue[1].status, QueueItemStatus::Blocked);
        assert_eq!(queue[2].status, QueueItemStatus::Pending); // unrelated
    }

    #[test]
    fn block_transitive_dependents() {
        // T-1 → T-2 → T-3
        let mut queue = vec![
            { let mut i = make_item("T-1", vec![]); i.status = QueueItemStatus::Error; i },
            make_item("T-2", vec!["T-1"]),
            make_item("T-3", vec!["T-2"]),
            make_item("T-4", vec![]),
        ];

        block_dependents_in_queue(&mut queue, "T-1");
        assert_eq!(queue[1].status, QueueItemStatus::Blocked);
        assert_eq!(queue[2].status, QueueItemStatus::Blocked); // transitive
        assert_eq!(queue[3].status, QueueItemStatus::Pending); // unrelated
    }

    #[test]
    fn block_diamond_dependents() {
        // T-1 → T-2, T-1 → T-3, T-2+T-3 → T-4
        let mut queue = vec![
            { let mut i = make_item("T-1", vec![]); i.status = QueueItemStatus::Error; i },
            make_item("T-2", vec!["T-1"]),
            make_item("T-3", vec!["T-1"]),
            make_item("T-4", vec!["T-2", "T-3"]),
        ];

        block_dependents_in_queue(&mut queue, "T-1");
        assert_eq!(queue[1].status, QueueItemStatus::Blocked);
        assert_eq!(queue[2].status, QueueItemStatus::Blocked);
        assert_eq!(queue[3].status, QueueItemStatus::Blocked);
    }
}
