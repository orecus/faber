use std::path::{Path, PathBuf};

use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::error::AppError;
use crate::git::{self, BranchNameVars, BranchList, ChangedFile, CommitDetail, CommitInfo, PullRequestResult, RefInfo, SyncStatus, WorktreeInfo};

// ── Helper: get project path with a short DB lock ──

fn get_project_path(state: &DbState, project_id: &str) -> Result<PathBuf, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project = db::projects::get(&conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
    Ok(PathBuf::from(&project.path))
}

/// Validate that a worktree path belongs to the given project.
/// The worktree must be a subdirectory of the project's `.faber/worktrees/` or
/// match a known worktree listed by git. This prevents path traversal attacks.
fn validate_worktree_path(project_path: &Path, worktree_path: &str) -> Result<PathBuf, AppError> {
    let wt = PathBuf::from(worktree_path);

    // Canonicalize both paths to resolve symlinks, `..`, etc.
    // Use dunce on Windows to avoid UNC prefix issues
    let canon_project = project_path.canonicalize()
        .map_err(|e| AppError::Io(format!("Failed to resolve project path: {e}")))?;
    let canon_wt = wt.canonicalize()
        .map_err(|e| AppError::Io(format!("Failed to resolve worktree path: {e}")))?;

    // The worktree must be under the project directory (or its .faber/worktrees/ subdirectory)
    // Also accept paths under the same parent (sibling worktrees created by git)
    let project_parent = canon_project.parent().unwrap_or(&canon_project);
    if canon_wt.starts_with(&canon_project) || canon_wt.starts_with(project_parent) {
        Ok(canon_wt)
    } else {
        Err(AppError::Validation(format!(
            "Worktree path '{}' is not within the project directory",
            worktree_path
        )))
    }
}

#[tauri::command]
pub async fn list_branches(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<String>, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    tokio::task::spawn_blocking(move || git::list_branches(&project_path))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

// ── IPC Commands ──

#[tauri::command]
pub fn create_worktree(
    state: State<'_, DbState>,
    project_id: String,
    branch_name: Option<String>,
    task_id: Option<String>,
    task_slug: Option<String>,
    base_ref: Option<String>,
) -> Result<WorktreeInfo, AppError> {
    let conn = state
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let project = db::projects::get(&conn, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    let repo_path = Path::new(&project.path);

    let branch = match branch_name {
        Some(name) => name,
        None => {
            let pattern = project
                .branch_naming_pattern
                .as_deref()
                .unwrap_or(git::DEFAULT_BRANCH_PATTERN);
            git::resolve_branch_name(
                pattern,
                &BranchNameVars {
                    task_id: task_id.as_deref(),
                    task_slug: task_slug.as_deref(),
                },
            )
        }
    };

    git::create_worktree(repo_path, &branch, base_ref.as_deref(), None)
}

#[tauri::command]
pub async fn list_worktrees(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<WorktreeInfo>, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    tokio::task::spawn_blocking(move || git::list_worktrees(&project_path))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn delete_worktree(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
) -> Result<(), AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || git::delete_worktree(&project_path, &validated_wt))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn get_worktree_disk_usage(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
) -> Result<u64, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || git::get_disk_usage(&validated_wt))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn get_changed_files(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
) -> Result<Vec<ChangedFile>, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || git::get_changed_files(&validated_wt))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn get_file_diff(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
    file_path: Option<String>,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || git::get_file_diff(&validated_wt, file_path.as_deref()))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn get_branch_files(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
) -> Result<Vec<ChangedFile>, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || git::get_branch_files(&validated_wt, None))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn get_branch_diff(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
    file_path: Option<String>,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || git::get_branch_diff(&validated_wt, file_path.as_deref(), None))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn commit_staged(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
    message: String,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || git::commit_staged(&validated_wt, &message))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn stage_file(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
    file_path: String,
) -> Result<(), AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || git::stage_file(&validated_wt, &file_path))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_file(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
    file_path: String,
) -> Result<(), AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || git::unstage_file(&validated_wt, &file_path))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn push_branch(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
    remote: Option<String>,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || {
        git::push_branch(&validated_wt, remote.as_deref())
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn create_pull_request(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
    title: String,
    body: String,
    base: Option<String>,
) -> Result<PullRequestResult, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let validated_wt = validate_worktree_path(&project_path, &worktree_path)?;
    tokio::task::spawn_blocking(move || {
        git::create_pull_request(&validated_wt, &title, &body, base.as_deref())
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn merge_worktree_branch(
    state: State<'_, DbState>,
    project_id: String,
    worktree_path: String,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    let _validated_wt = validate_worktree_path(&project_path, &worktree_path)?;

    tokio::task::spawn_blocking(move || {
        let repo_path = Path::new(&project_path);
        // Find the branch name for this worktree
        let worktrees = git::list_worktrees(repo_path)?;
        let wt = worktrees
            .iter()
            .find(|w| w.path == worktree_path)
            .ok_or_else(|| AppError::NotFound(format!("Worktree {worktree_path}")))?;

        let branch = wt
            .branch
            .as_deref()
            .ok_or_else(|| AppError::Git("Worktree has no branch".to_string()))?;

        git::merge_branch(repo_path, branch)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

// ── Sync / branch commands (async — no DB lock during git subprocess) ──

#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<SyncStatus, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    tokio::task::spawn_blocking(move || git::get_sync_status(&project_path))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn git_pull(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    tokio::task::spawn_blocking(move || git::git_pull(&project_path))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn git_push(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    tokio::task::spawn_blocking(move || git::git_push_main(&project_path))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn list_all_branches(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<BranchList, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    tokio::task::spawn_blocking(move || git::list_all_branches(&project_path))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn checkout_branch(
    state: State<'_, DbState>,
    project_id: String,
    branch: String,
    is_remote: bool,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    tokio::task::spawn_blocking(move || git::checkout_branch(&project_path, &branch, is_remote))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn create_branch(
    state: State<'_, DbState>,
    project_id: String,
    branch_name: String,
    base_ref: Option<String>,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;
    tokio::task::spawn_blocking(move || git::create_branch(&project_path, &branch_name, base_ref.as_deref()))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

// ── Commit history commands (async — no DB lock during git subprocess) ──

#[tauri::command]
pub async fn git_commit_log(
    state: State<'_, DbState>,
    project_id: String,
    max_count: Option<u32>,
    skip: Option<u32>,
    all_branches: Option<bool>,
) -> Result<Vec<CommitInfo>, AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    let mc = max_count.unwrap_or(50);
    let sk = skip.unwrap_or(0);
    let ab = all_branches.unwrap_or(true);

    tokio::task::spawn_blocking(move || {
        git::commit_log(&project_path, mc, sk, ab)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn git_refs_for_commit(
    state: State<'_, DbState>,
    project_id: String,
    commit_hash: String,
) -> Result<RefInfo, AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    tokio::task::spawn_blocking(move || {
        git::refs_for_commit(&project_path, &commit_hash)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

/// Batch variant: fetch refs for multiple commit hashes in a single IPC call.
/// Reduces per-commit IPC overhead when scrolling through the commit list.
#[derive(Clone, serde::Serialize)]
pub struct CommitRefEntry {
    pub hash: String,
    pub refs: RefInfo,
}

#[tauri::command]
pub async fn git_refs_batch(
    state: State<'_, DbState>,
    project_id: String,
    commit_hashes: Vec<String>,
) -> Result<Vec<CommitRefEntry>, AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    tokio::task::spawn_blocking(move || {
        // Use bulk lookup (2 git processes total) instead of 2×N per commit
        let hash_set: std::collections::HashSet<String> = commit_hashes.iter().cloned().collect();
        let ref_map = git::refs_for_commits_bulk(&project_path, &hash_set)?;

        let results: Vec<CommitRefEntry> = ref_map
            .into_iter()
            .map(|(hash, refs)| CommitRefEntry { hash, refs })
            .collect();

        Ok::<_, AppError>(results)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn git_commit_detail(
    state: State<'_, DbState>,
    project_id: String,
    commit_hash: String,
) -> Result<CommitDetail, AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    tokio::task::spawn_blocking(move || {
        git::commit_detail(&project_path, &commit_hash)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn git_head_hash(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<String, AppError> {
    let project_path = get_project_path(&state, &project_id)?;

    tokio::task::spawn_blocking(move || {
        git::head_hash(&project_path)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}
