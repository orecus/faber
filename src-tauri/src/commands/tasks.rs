use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::config_watcher::ConfigWatcherState;
use crate::db;
use crate::db::models::{Task, TaskStatus};
use crate::db::DbState;
use crate::error::AppError;
use crate::github;
use crate::task_watcher::TaskWatcherState;
use crate::tasks;

// ── Response types ──

#[derive(Debug, Clone, Serialize)]
pub struct TaskFileContent {
    pub task: Task,
    pub body: String,
}

// ── Helpers ──

fn tasks_dir_for_project(project_path: &str) -> PathBuf {
    Path::new(project_path).join(".agents").join("tasks")
}

/// Pre-generated TODOS.md content to be written outside the DB lock.
pub(crate) struct TodosUpdate {
    content: String,
    dest: PathBuf,
}

impl TodosUpdate {
    /// Generate content under DB lock; write to disk later.
    pub(crate) fn prepare(conn: &rusqlite::Connection, project_id: &str, project_path: &Path) -> Option<Self> {
        let content = tasks::generate_todos_md(conn, project_id).ok()?;
        Some(Self {
            content,
            dest: project_path.join("TODOS.md"),
        })
    }

    /// Write the pre-generated content to disk (no DB lock needed).
    pub(crate) fn write(self) {
        if let Err(e) = std::fs::write(&self.dest, &self.content) {
            tracing::warn!(%e, "Failed to write TODOS.md");
        }
    }
}

// ── Core logic (testable without Tauri State) ──

fn do_sync_tasks(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<usize, AppError> {
    // Skip sync if disk files are disabled
    if !tasks::task_files_enabled(conn, project_id) {
        return Ok(0);
    }
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
    let tasks_dir = tasks_dir_for_project(&project.path);
    let count = tasks::scan_and_sync(conn, project_id, &tasks_dir)?;
    Ok(count)
}

fn do_create_task(
    conn: &rusqlite::Connection,
    project_id: &str,
    title: &str,
    priority: Option<&str>,
    body: Option<&str>,
) -> Result<(Task, Option<TodosUpdate>), AppError> {
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    let disk_enabled = tasks::task_files_enabled(conn, project_id);

    let task = if disk_enabled {
        let tasks_dir = tasks_dir_for_project(&project.path);
        tasks::create_task_file(conn, project_id, &tasks_dir, title, priority, body)?
    } else {
        // DB-only mode: generate ID from DB, insert directly
        let task_id = tasks::next_task_id_from_db(conn, project_id)?;
        let priority_val = priority.unwrap_or("P2");
        let default_body =
            "## Objective\n\n\n\n## Acceptance Criteria\n\n- [ ] \n\n## Implementation Plan\n\n1. \n";
        let body_content = body.unwrap_or(default_body);
        let new_task = db::models::NewTask {
            id: task_id,
            project_id: project_id.to_string(),
            task_file_path: None,
            title: title.to_string(),
            status: None,
            priority: Some(priority_val.parse().unwrap_or(db::models::Priority::P2)),
            agent: None,
            model: None,
            branch: None,
            worktree_path: None,
            github_issue: None,
            github_pr: None,
            depends_on: vec![],
            labels: vec![],
            body: body_content.to_string(),
        };
        db::tasks::upsert(conn, &new_task)?
    };

    let todos = if disk_enabled {
        TodosUpdate::prepare(conn, project_id, Path::new(&project.path))
    } else {
        None
    };
    Ok((task, todos))
}

/// Data needed for GitHub sync, pre-read under DB lock so the lock can be
/// released before spawning `gh` CLI subprocesses.
pub(crate) struct GithubSyncContext {
    project_path: PathBuf,
    issue_ref: String,
    old_status: TaskStatus,
    new_status: TaskStatus,
    auto_close: bool,
    auto_reopen: bool,
    has_pr: bool,
    label_sync: bool,
    label_mapping: std::collections::HashMap<String, String>,
}

pub(crate) fn do_update_task_status(
    conn: &rusqlite::Connection,
    project_id: &str,
    task_id: &str,
    status: &str,
) -> Result<(Task, Option<GithubSyncContext>, Option<TodosUpdate>), AppError> {
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    let task = db::tasks::get(conn, task_id, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;

    let old_status = task.status;
    let disk_enabled = tasks::task_files_enabled(conn, project_id);

    // Update the file on disk if it exists and disk files are enabled
    if disk_enabled {
        if let Some(ref file_path) = task.task_file_path {
            let path = Path::new(file_path);
            if path.exists() {
                tasks::update_task_file_field(path, "status", status)?;
            }
        }
    }

    // Update DB
    let new_status: TaskStatus = status
        .parse()
        .map_err(|e: String| AppError::Validation(e))?;
    db::tasks::update_status(conn, task_id, project_id, new_status)?;

    // Generate TODOS.md content under lock; file write deferred
    let todos = if disk_enabled {
        TodosUpdate::prepare(conn, project_id, Path::new(&project.path))
    } else {
        None
    };

    // Pre-read all GitHub sync data while we still hold the lock,
    // so the actual CLI calls happen outside the lock scope.
    let sync_ctx = if old_status != new_status {
        build_github_sync_context(conn, &project, &task, old_status, new_status)
    } else {
        None
    };

    let updated_task = db::tasks::get(conn, task_id, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;

    Ok((updated_task, sync_ctx, todos))
}

/// Pre-read all settings needed for GitHub sync while under DB lock.
/// Returns None if sync is not applicable (disabled, no linked issue, etc.).
fn build_github_sync_context(
    conn: &rusqlite::Connection,
    project: &crate::db::models::Project,
    task: &Task,
    old_status: TaskStatus,
    new_status: TaskStatus,
) -> Option<GithubSyncContext> {
    let sync_enabled = db::settings::get_value(conn, "project", Some(&project.id), "github_sync_enabled")
        .ok()
        .flatten();
    if sync_enabled.as_deref() != Some("true") {
        return None;
    }

    let issue_ref = task.github_issue.as_ref()?.clone();

    let auto_close = db::settings::get_value(conn, "project", Some(&project.id), "github_auto_close")
        .ok()
        .flatten()
        .unwrap_or_else(|| "true".to_string()) == "true";

    let auto_reopen = db::settings::get_value(conn, "project", Some(&project.id), "github_auto_reopen")
        .ok()
        .flatten()
        .unwrap_or_else(|| "true".to_string()) == "true";

    let label_sync = db::settings::get_value(conn, "project", Some(&project.id), "github_label_sync")
        .ok()
        .flatten()
        .unwrap_or_else(|| "false".to_string()) == "true";

    let label_mapping = if label_sync {
        let mapping_json = db::settings::get_value(conn, "project", Some(&project.id), "github_label_mapping")
            .ok()
            .flatten()
            .unwrap_or_else(|| "{}".to_string());
        serde_json::from_str(&mapping_json).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    Some(GithubSyncContext {
        project_path: PathBuf::from(&project.path),
        issue_ref,
        old_status,
        new_status,
        auto_close,
        auto_reopen,
        has_pr: task.github_pr.is_some(),
        label_sync,
        label_mapping,
    })
}

/// Best-effort sync of task status changes to GitHub issues.
/// Uses pre-read context so no DB lock is needed during CLI calls.
/// All GitHub calls are logged on failure but never propagated.
pub(crate) fn execute_github_sync(ctx: GithubSyncContext) {
    let repo_path = &ctx.project_path;

    // Layer A: Open/closed sync
    let is_closing = matches!(ctx.new_status, TaskStatus::Done | TaskStatus::Archived);
    let was_closed = matches!(ctx.old_status, TaskStatus::Done | TaskStatus::Archived);

    if is_closing && !was_closed {
        if ctx.auto_close && !ctx.has_pr {
            if let Err(e) = github::close_issue(repo_path, &ctx.issue_ref, Some("Closed by Faber (task marked as done)")) {
                tracing::warn!(%e, issue_ref = ctx.issue_ref, "Failed to close GitHub issue");
            }
        }
    } else if was_closed && !is_closing && ctx.auto_reopen {
        if let Err(e) = github::reopen_issue(repo_path, &ctx.issue_ref) {
            tracing::warn!(%e, issue_ref = ctx.issue_ref, "Failed to reopen GitHub issue");
        }
    }

    // Layer B: Label sync
    if ctx.label_sync {
        // Remove old status label
        if let Some(old_label) = ctx.label_mapping.get(ctx.old_status.as_str()) {
            if !old_label.is_empty() {
                let _ = github::remove_label(repo_path, &ctx.issue_ref, old_label);
            }
        }
        // Add new status label
        if let Some(new_label) = ctx.label_mapping.get(ctx.new_status.as_str()) {
            if !new_label.is_empty() {
                if let Err(e) = github::add_label(repo_path, &ctx.issue_ref, new_label) {
                    tracing::warn!(%e, "Failed to add GitHub label");
                }
            }
        }
    }
}

fn do_get_task_file_content(
    conn: &rusqlite::Connection,
    project_id: &str,
    task_id: &str,
) -> Result<TaskFileContent, AppError> {
    let task = db::tasks::get(conn, task_id, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;

    let disk_enabled = tasks::task_files_enabled(conn, project_id);

    let body = if disk_enabled {
        match &task.task_file_path {
            Some(file_path) => {
                let path = Path::new(file_path);
                if path.exists() {
                    let content = std::fs::read_to_string(path)?;
                    let parsed = tasks::parse_task_file(&content, path)?;
                    parsed.body
                } else {
                    // Fall back to DB body
                    task.body.clone()
                }
            }
            None => task.body.clone(),
        }
    } else {
        // DB-only mode: body is stored in the database
        task.body.clone()
    };

    Ok(TaskFileContent { task, body })
}

#[allow(clippy::too_many_arguments)]
fn do_save_task_content(
    conn: &rusqlite::Connection,
    project_id: &str,
    task_id: &str,
    title: &str,
    status: &str,
    priority: &str,
    agent: Option<&str>,
    model: Option<&str>,
    branch: Option<&str>,
    github_issue: Option<&str>,
    depends_on: Vec<String>,
    labels: Vec<String>,
    body: &str,
) -> Result<(Task, Option<TodosUpdate>), AppError> {
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
    let task = db::tasks::get(conn, task_id, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;

    let disk_enabled = tasks::task_files_enabled(conn, project_id);

    let updated = if disk_enabled {
        // Read existing file to preserve created date
        let created = match &task.task_file_path {
            Some(fp) => {
                let path = Path::new(fp);
                if path.exists() {
                    let content = std::fs::read_to_string(path)?;
                    let parsed = tasks::parse_task_file(&content, path)?;
                    parsed.frontmatter.created
                } else {
                    task.created_at.clone()
                }
            }
            None => task.created_at.clone(),
        };

        let frontmatter = tasks::TaskFrontmatter {
            id: task_id.to_string(),
            title: title.to_string(),
            status: status.to_string(),
            priority: priority.to_string(),
            created,
            depends_on: depends_on.clone(),
            labels: labels.clone(),
            agent: agent.map(|s| s.to_string()),
            model: model.map(|s| s.to_string()),
            branch: branch.map(|s| s.to_string()),
            github_issue: github_issue.map(|s| s.to_string()),
            github_pr: task.github_pr.clone(),
        };

        let content = tasks::serialize_task_file(&frontmatter, body)?;

        // Write to disk if file path exists
        if let Some(ref file_path) = task.task_file_path {
            std::fs::write(file_path, &content)?;

            // Re-parse and upsert into DB
            let parsed = tasks::parse_task_file(&content, Path::new(file_path))?;
            let new_task = tasks::to_new_task(&parsed, project_id);
            db::tasks::upsert(conn, &new_task)?
        } else {
            // No file path — save as DB-only with body
            let new_task = db::models::NewTask {
                id: task_id.to_string(),
                project_id: project_id.to_string(),
                task_file_path: None,
                title: title.to_string(),
                status: Some(status.parse().unwrap_or(db::models::TaskStatus::Backlog)),
                priority: Some(priority.parse().unwrap_or(db::models::Priority::P2)),
                agent: agent.map(|s| s.to_string()),
                model: model.map(|s| s.to_string()),
                branch: branch.map(|s| s.to_string()),
                worktree_path: task.worktree_path.clone(),
                github_issue: github_issue.map(|s| s.to_string()),
                github_pr: task.github_pr.clone(),
                depends_on,
                labels,
                body: body.to_string(),
            };
            db::tasks::upsert(conn, &new_task)?
        }
    } else {
        // DB-only mode: upsert directly without file I/O
        let new_task = db::models::NewTask {
            id: task_id.to_string(),
            project_id: project_id.to_string(),
            task_file_path: None,
            title: title.to_string(),
            status: Some(status.parse().unwrap_or(db::models::TaskStatus::Backlog)),
            priority: Some(priority.parse().unwrap_or(db::models::Priority::P2)),
            agent: agent.map(|s| s.to_string()),
            model: model.map(|s| s.to_string()),
            branch: branch.map(|s| s.to_string()),
            worktree_path: task.worktree_path.clone(),
            github_issue: github_issue.map(|s| s.to_string()),
            github_pr: task.github_pr.clone(),
            depends_on,
            labels,
            body: body.to_string(),
        };
        db::tasks::upsert(conn, &new_task)?
    };

    // Generate TODOS.md content under lock; file write deferred (only if disk enabled)
    let todos = if disk_enabled {
        TodosUpdate::prepare(conn, project_id, Path::new(&project.path))
    } else {
        None
    };

    Ok((updated, todos))
}

fn do_delete_task(
    conn: &rusqlite::Connection,
    project_id: &str,
    task_id: &str,
) -> Result<Option<TodosUpdate>, AppError> {
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
    let task = db::tasks::get(conn, task_id, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;

    let disk_enabled = tasks::task_files_enabled(conn, project_id);

    // Delete file from disk if it exists and disk files are enabled
    if disk_enabled {
        if let Some(ref file_path) = task.task_file_path {
            let path = Path::new(file_path);
            if path.exists() {
                std::fs::remove_file(path)?;
            }
        }
    }

    // Delete associated activity events first
    db::task_activity::delete_by_task(conn, task_id, project_id)?;

    // Delete from DB
    db::tasks::delete(conn, task_id, project_id)?;

    // Generate TODOS.md content under lock; file write deferred (only if disk enabled)
    let todos = if disk_enabled {
        TodosUpdate::prepare(conn, project_id, Path::new(&project.path))
    } else {
        None
    };
    Ok(todos)
}

// ── IPC Commands ──

#[tauri::command]
pub fn list_tasks(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<Task>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::tasks::list_by_project(&conn, &project_id).map_err(AppError::from)
}

#[tauri::command]
pub fn get_task(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
) -> Result<Task, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::tasks::get(&conn, &task_id, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))
}

#[tauri::command]
pub fn sync_tasks(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<usize, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    do_sync_tasks(&conn, &project_id)
}

#[tauri::command]
pub fn create_task(
    state: State<'_, DbState>,
    project_id: String,
    title: String,
    priority: Option<String>,
    body: Option<String>,
) -> Result<Task, AppError> {
    let (task, todos) = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        do_create_task(
            &conn,
            &project_id,
            &title,
            priority.as_deref(),
            body.as_deref(),
        )?
    };
    tracing::info!(
        task_id = %task.id,
        title = %task.title,
        priority = %task.priority,
        source = "user",
        "Task created"
    );
    // Write TODOS.md outside DB lock
    if let Some(t) = todos { t.write(); }
    Ok(task)
}

#[tauri::command]
pub fn update_task_status(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    status: String,
) -> Result<Task, AppError> {
    // Phase 1: Hold DB lock for task update + read GitHub sync context + generate TODOS content
    let (task, sync_ctx, todos) = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        do_update_task_status(&conn, &project_id, &task_id, &status)?
    };
    tracing::info!(
        task_id = %task_id,
        new_status = %status,
        source = "user",
        "Task status updated"
    );
    // Lock is released here

    // Phase 2: Write TODOS.md + GitHub sync without holding DB lock
    if let Some(t) = todos { t.write(); }
    if let Some(ctx) = sync_ctx {
        execute_github_sync(ctx);
    }

    Ok(task)
}

#[tauri::command]
pub fn get_task_file_content(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
) -> Result<TaskFileContent, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    do_get_task_file_content(&conn, &project_id, &task_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn save_task_content(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    title: String,
    status: String,
    priority: String,
    agent: Option<String>,
    model: Option<String>,
    branch: Option<String>,
    github_issue: Option<String>,
    depends_on: Vec<String>,
    labels: Vec<String>,
    body: String,
) -> Result<Task, AppError> {
    let (task, todos) = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        do_save_task_content(
            &conn,
            &project_id,
            &task_id,
            &title,
            &status,
            &priority,
            agent.as_deref(),
            model.as_deref(),
            branch.as_deref(),
            github_issue.as_deref(),
            depends_on,
            labels,
            &body,
        )?
    };
    tracing::info!(task_id = %task_id, title = %title, source = "user", "Task content saved");
    // Write TODOS.md outside DB lock
    if let Some(t) = todos { t.write(); }
    Ok(task)
}

#[tauri::command]
pub fn delete_task(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
) -> Result<(), AppError> {
    let todos = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        do_delete_task(&conn, &project_id, &task_id)?
    };
    tracing::info!(task_id = %task_id, source = "user", "Task deleted");
    // Write TODOS.md outside DB lock
    if let Some(t) = todos { t.write(); }
    Ok(())
}

// ── Task Activity Commands ──

#[tauri::command]
pub fn get_task_activity(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    limit: Option<u32>,
) -> Result<Vec<db::models::TaskActivity>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let activities = db::task_activity::list_by_task(&conn, &task_id, &project_id, limit.unwrap_or(100))
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(activities)
}

// ── Task File Watcher Commands ──

#[tauri::command]
pub async fn start_task_watcher(
    db_state: State<'_, DbState>,
    watcher_state: State<'_, TaskWatcherState>,
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    let project_path = {
        let conn = db_state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let project = db::projects::get(&conn, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
        PathBuf::from(&project.path)
    };

    let mut registry = watcher_state.lock().await;
    registry
        .start(project_id, project_path, app_handle)
        .map_err(AppError::Validation)
}

#[tauri::command]
pub async fn stop_task_watcher(
    watcher_state: State<'_, TaskWatcherState>,
    project_id: String,
) -> Result<(), AppError> {
    let mut registry = watcher_state.lock().await;
    registry.stop(&project_id);
    Ok(())
}

// ── Config File Watcher Commands ──

#[tauri::command]
pub async fn start_config_watcher(
    db_state: State<'_, DbState>,
    watcher_state: State<'_, ConfigWatcherState>,
    app_handle: tauri::AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    let project_path = {
        let conn = db_state
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;
        let project = db::projects::get(&conn, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
        PathBuf::from(&project.path)
    };

    let mut registry = watcher_state.lock().await;
    registry
        .start(project_id, project_path, app_handle)
        .map_err(AppError::Validation)
}

#[tauri::command]
pub async fn stop_config_watcher(
    watcher_state: State<'_, ConfigWatcherState>,
    project_id: String,
) -> Result<(), AppError> {
    let mut registry = watcher_state.lock().await;
    registry.stop(&project_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::NewProject;
    use std::fs;
    use tempfile::TempDir;

    fn setup() -> (rusqlite::Connection, TempDir) {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        let tmp = TempDir::new().unwrap();

        db::projects::create(
            &conn,
            &NewProject {
                name: "test".into(),
                path: tmp.path().to_string_lossy().into_owned(),
                default_agent: None,
                default_model: None,
                branch_naming_pattern: None,
                instruction_file_path: None,
            },
        )
        .unwrap();

        (conn, tmp)
    }

    fn project_id(conn: &rusqlite::Connection) -> String {
        db::projects::list(conn).unwrap()[0].id.clone()
    }

    #[test]
    fn sync_tasks_reads_files() {
        let (conn, tmp) = setup();
        let pid = project_id(&conn);

        let tasks_dir = tmp.path().join(".agents").join("tasks");
        fs::create_dir_all(&tasks_dir).unwrap();
        fs::write(
            tasks_dir.join("T-001-test.md"),
            "---\n\
             id: T-001\n\
             title: Synced task\n\
             status: ready\n\
             priority: P0\n\
             created: 2026-01-01\n\
             ---\n\
             \n\
             Body.\n",
        )
        .unwrap();

        let count = do_sync_tasks(&conn, &pid).unwrap();
        assert_eq!(count, 1);

        let tasks = db::tasks::list_by_project(&conn, &pid).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "Synced task");
    }

    #[test]
    fn create_and_get_task() {
        let (conn, tmp) = setup();
        let pid = project_id(&conn);

        let (task, todos) = do_create_task(&conn, &pid, "New feature", Some("P1"), None).unwrap();
        if let Some(t) = todos { t.write(); }
        assert_eq!(task.id, "T-001");
        assert_eq!(task.title, "New feature");

        // File should exist
        let tasks_dir = tmp.path().join(".agents").join("tasks");
        assert!(tasks_dir.join("T-001-new-feature.md").exists());

        // TODOS.md should be generated
        let todos = fs::read_to_string(tmp.path().join("TODOS.md")).unwrap();
        assert!(todos.contains("T-001"));
    }

    #[test]
    fn update_status_updates_file_and_db() {
        let (conn, tmp) = setup();
        let pid = project_id(&conn);

        do_create_task(&conn, &pid, "Task to update", None, None).unwrap();

        let (updated, _sync_ctx, _todos) = do_update_task_status(&conn, &pid, "T-001", "in-progress").unwrap();
        assert_eq!(
            updated.status,
            crate::db::models::TaskStatus::InProgress
        );

        // Verify the file was updated
        let tasks_dir = tmp.path().join(".agents").join("tasks");
        let content =
            fs::read_to_string(tasks_dir.join("T-001-task-to-update.md")).unwrap();
        assert!(content.contains("status: in-progress"));
    }

    #[test]
    fn get_task_file_content_returns_body() {
        let (conn, _tmp) = setup();
        let pid = project_id(&conn);

        let body = "## My Plan\n\nDo the thing.\n";
        let _ = do_create_task(&conn, &pid, "With body", None, Some(body)).unwrap();

        let result = do_get_task_file_content(&conn, &pid, "T-001").unwrap();
        assert!(result.body.contains("Do the thing."));
        assert_eq!(result.task.id, "T-001");
    }

    #[test]
    fn create_multiple_tasks_increments_id() {
        let (conn, tmp) = setup();
        let pid = project_id(&conn);

        let (t1, _) = do_create_task(&conn, &pid, "First", None, None).unwrap();
        let (t2, _) = do_create_task(&conn, &pid, "Second", None, None).unwrap();
        let (t3, _) = do_create_task(&conn, &pid, "Third", None, None).unwrap();

        assert_eq!(t1.id, "T-001");
        assert_eq!(t2.id, "T-002");
        assert_eq!(t3.id, "T-003");

        let _ = tmp; // keep alive
    }

    #[test]
    fn save_task_content_updates_file_and_db() {
        let (conn, tmp) = setup();
        let pid = project_id(&conn);

        let (task, _) = do_create_task(&conn, &pid, "Original title", Some("P2"), None).unwrap();
        assert_eq!(task.title, "Original title");

        let (updated, _) = do_save_task_content(
            &conn,
            &pid,
            "T-001",
            "Updated title",
            "in-progress",
            "P0",
            Some("claude-code"),
            Some("opus"),
            None,
            None,
            vec!["T-000".into()],
            vec!["backend".into()],
            "## New body\n\nUpdated content.\n",
        )
        .unwrap();

        assert_eq!(updated.title, "Updated title");
        assert_eq!(
            updated.status,
            crate::db::models::TaskStatus::InProgress
        );
        assert_eq!(updated.priority, crate::db::models::Priority::P0);
        assert_eq!(updated.agent.as_deref(), Some("claude-code"));

        // Verify file on disk
        let tasks_dir = tmp.path().join(".agents").join("tasks");
        let content =
            fs::read_to_string(tasks_dir.join("T-001-original-title.md")).unwrap();
        assert!(content.contains("title: Updated title"));
        assert!(content.contains("status: in-progress"));
        assert!(content.contains("Updated content."));
    }

    #[test]
    fn delete_task_removes_file_and_db() {
        let (conn, tmp) = setup();
        let pid = project_id(&conn);

        let _ = do_create_task(&conn, &pid, "To delete", None, None).unwrap();
        let tasks_dir = tmp.path().join(".agents").join("tasks");
        assert!(tasks_dir.join("T-001-to-delete.md").exists());

        let _ = do_delete_task(&conn, &pid, "T-001").unwrap();

        // File should be gone
        assert!(!tasks_dir.join("T-001-to-delete.md").exists());

        // DB record should be gone
        assert!(db::tasks::get(&conn, "T-001", &pid).unwrap().is_none());
    }
}
