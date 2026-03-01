use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::State;

use crate::commands::tasks::do_update_task_status;
use crate::db;
use crate::db::DbState;
use crate::error::AppError;
use crate::github;
use crate::tasks;

/// A GitHub issue sent from the frontend for import.
/// Uses snake_case to match frontend serialization.
#[derive(Debug, Clone, Deserialize)]
pub struct GitHubIssueInput {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub labels: Vec<github::GitHubLabel>,
    pub assignees: Vec<github::GitHubUser>,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
}

impl From<GitHubIssueInput> for github::GitHubIssue {
    fn from(input: GitHubIssueInput) -> Self {
        Self {
            number: input.number,
            title: input.title,
            body: input.body,
            state: input.state,
            labels: input.labels,
            assignees: input.assignees,
            created_at: input.created_at,
            updated_at: input.updated_at,
            url: input.url,
        }
    }
}

// ── Helper: get project path with a short DB lock ──

fn get_project_path(state: &DbState, project_id: &str) -> Result<PathBuf, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project = db::projects::get(&conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
    Ok(PathBuf::from(&project.path))
}

// ── IPC Commands ──

#[tauri::command]
pub async fn check_gh_auth() -> github::GhAuthStatus {
    tokio::task::spawn_blocking(github::check_gh_auth)
        .await
        .unwrap_or_else(|_| github::GhAuthStatus {
            installed: false,
            authenticated: false,
            username: None,
            error: Some("Internal error checking auth".to_string()),
            token_source: None,
            missing_scopes: vec![],
            has_scope_warnings: false,
        })
}

#[tauri::command]
pub async fn list_github_issues(
    state: State<'_, DbState>,
    project_id: String,
    state_filter: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<github::GitHubIssueWithImportStatus>, AppError> {
    // Short lock: get project path + imported issue map
    let (project_path, imported_map) = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let project = db::projects::get(&conn, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
        let map = github::get_imported_issue_map(&conn, &project_id)?;
        (PathBuf::from(&project.path), map)
    };
    // Lock dropped — now do slow network calls

    let filter = state_filter.unwrap_or_else(|| "open".to_string());
    let lim = limit.unwrap_or(50);

    let (repo_slug, issues) = tokio::task::spawn_blocking(move || {
        let repo_path = Path::new(&project_path);
        let slug = github::detect_repo_slug(repo_path)?;
        let issues = github::fetch_issues(repo_path, &filter, lim)?;
        Ok::<_, AppError>((slug, issues))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    // Build result without lock
    let result = issues
        .into_iter()
        .map(|issue| {
            let issue_ref = format!("{repo_slug}#{}", issue.number);
            let existing_task_id = imported_map.get(&issue_ref).cloned();
            let already_imported = existing_task_id.is_some();
            github::GitHubIssueWithImportStatus {
                issue,
                already_imported,
                existing_task_id,
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn import_github_issues(
    state: State<'_, DbState>,
    project_id: String,
    issues: Vec<GitHubIssueInput>,
) -> Result<github::ImportResult, AppError> {
    // Import needs DB access throughout (upsert per issue), but the gh CLI call
    // (detect_repo_slug) is the only slow part. Get repo slug first without lock.
    let project_path = get_project_path(&state, &project_id)?;

    let pp = project_path.clone();
    let repo_slug = tokio::task::spawn_blocking(move || {
        github::detect_repo_slug(&pp)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    // Now do the import with a lock (file I/O + DB writes, but no network)
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let issues: Vec<github::GitHubIssue> = issues.into_iter().map(Into::into).collect();
    github::import_issues(&conn, &project_id, &project_path, &issues, &repo_slug)
}

#[tauri::command]
pub async fn close_github_issue(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    comment: Option<String>,
) -> Result<(), AppError> {
    // Short lock: get project path + issue ref
    let (project_path, issue_ref) = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let project = db::projects::get(&conn, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
        let task = db::tasks::get(&conn, &task_id, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;
        let issue_ref = task.github_issue
            .ok_or_else(|| AppError::Validation("Task has no linked GitHub issue".into()))?;
        (PathBuf::from(&project.path), issue_ref)
    };

    // Network call without lock
    tokio::task::spawn_blocking(move || {
        github::close_issue(Path::new(&project_path), &issue_ref, comment.as_deref())
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn reopen_github_issue(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
) -> Result<(), AppError> {
    let (project_path, issue_ref) = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let project = db::projects::get(&conn, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
        let task = db::tasks::get(&conn, &task_id, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;
        let issue_ref = task.github_issue
            .ok_or_else(|| AppError::Validation("Task has no linked GitHub issue".into()))?;
        (PathBuf::from(&project.path), issue_ref)
    };

    tokio::task::spawn_blocking(move || {
        github::reopen_issue(Path::new(&project_path), &issue_ref)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn fetch_repo_labels(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<github::GitHubLabelFull>, AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    tokio::task::spawn_blocking(move || {
        github::fetch_repo_labels(Path::new(&project_path))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn check_pr_merged(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
) -> Result<github::PrStatus, AppError> {
    // Short lock: get project path + PR URL + task status
    let (project_path, pr_url, task_status) = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let project = db::projects::get(&conn, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
        let task = db::tasks::get(&conn, &task_id, &project_id)?
            .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;
        let pr_url = task.github_pr
            .ok_or_else(|| AppError::Validation("Task has no linked PR".into()))?;
        (PathBuf::from(&project.path), pr_url, task.status)
    };

    // Network call without lock
    let pp = project_path;
    let pu = pr_url;
    let status = tokio::task::spawn_blocking(move || {
        github::check_pr_status(Path::new(&pp), &pu)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    // Re-acquire lock only if we need to update task status
    if status.merged && task_status != crate::db::models::TaskStatus::Done {
        let result = {
            let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
            do_update_task_status(&conn, &project_id, &task_id, "done").ok()
        };
        if let Some((_task, sync_ctx, todos)) = result {
            if let Some(t) = todos { t.write(); }
            if let Some(ctx) = sync_ctx {
                crate::commands::tasks::execute_github_sync(ctx);
            }
        }
    }

    Ok(status)
}

#[tauri::command]
pub fn set_task_github_pr(
    state: State<'_, DbState>,
    project_id: String,
    task_id: String,
    pr_url: String,
) -> Result<crate::db::models::Task, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let task = db::tasks::get(&conn, &task_id, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;

    // Update DB
    db::tasks::update_github_pr(&conn, &task_id, &project_id, Some(&pr_url))?;

    // Update task file on disk if it exists
    if let Some(ref file_path) = task.task_file_path {
        let path = Path::new(file_path);
        if path.exists() {
            let _ = tasks::update_task_file_field(path, "github_pr", &pr_url);
        }
    }

    db::tasks::get(&conn, &task_id, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))
}

// ── Pull Request commands ──

#[tauri::command]
pub async fn list_pull_requests(
    state: State<'_, DbState>,
    project_id: String,
    state_filter: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<github::GitHubPR>, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let filter = state_filter.unwrap_or_else(|| "open".to_string());
    let lim = limit.unwrap_or(50);

    tokio::task::spawn_blocking(move || {
        github::fetch_pull_requests(Path::new(&project_path), &filter, lim)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn get_pr_detail(
    state: State<'_, DbState>,
    project_id: String,
    number: u64,
) -> Result<github::GitHubPRDetail, AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    tokio::task::spawn_blocking(move || {
        github::fetch_pr_detail(Path::new(&project_path), number)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn merge_pull_request(
    state: State<'_, DbState>,
    project_id: String,
    number: u64,
    method: Option<String>,
) -> Result<(), AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let merge_method = method.unwrap_or_else(|| "merge".to_string());

    tokio::task::spawn_blocking(move || {
        github::merge_pull_request(Path::new(&project_path), number, &merge_method)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn close_pull_request(
    state: State<'_, DbState>,
    project_id: String,
    number: u64,
) -> Result<(), AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    tokio::task::spawn_blocking(move || {
        github::close_pull_request(Path::new(&project_path), number)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

// ── Issue create/update commands ──

#[tauri::command]
pub async fn create_github_issue(
    state: State<'_, DbState>,
    project_id: String,
    title: String,
    body: Option<String>,
    labels: Option<Vec<String>>,
) -> Result<github::GitHubIssueCreated, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let body_text = body.unwrap_or_default();
    let label_list = labels.unwrap_or_default();

    tokio::task::spawn_blocking(move || {
        github::create_issue(Path::new(&project_path), &title, &body_text, &label_list)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn update_github_issue(
    state: State<'_, DbState>,
    project_id: String,
    issue_number: u64,
    title: String,
    body: String,
) -> Result<(), AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    tokio::task::spawn_blocking(move || {
        github::update_issue(Path::new(&project_path), issue_number, &title, &body)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn fetch_github_issue(
    state: State<'_, DbState>,
    project_id: String,
    issue_number: u64,
) -> Result<github::GitHubIssue, AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    tokio::task::spawn_blocking(move || {
        github::fetch_single_issue(Path::new(&project_path), issue_number)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub fn get_project_setting(
    state: State<'_, DbState>,
    project_id: String,
    key: String,
) -> Result<Option<String>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let value = db::settings::get_value(&conn, "project", Some(&project_id), &key)?;
    Ok(value)
}

#[tauri::command]
pub fn set_project_setting(
    state: State<'_, DbState>,
    project_id: String,
    key: String,
    value: String,
) -> Result<(), AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::settings::set_value(&conn, "project", Some(&project_id), &key, &value)?;
    Ok(())
}
