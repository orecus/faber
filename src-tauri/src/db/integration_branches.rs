use rusqlite::Connection;

use crate::db;
use crate::error::AppError;

use super::models::IntegrationBranch;

/// Create a new integration branch record.
pub fn create(
    conn: &Connection,
    run_type: &str,
    run_id: &str,
    project_id: &str,
    branch_name: &str,
    base_branch: &str,
    worktree_strategy: &str,
    pending_tasks: &[String],
) -> Result<IntegrationBranch, AppError> {
    let id = db::generate_id("ib");
    let pending_json = serde_json::to_string(pending_tasks).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO integration_branches (id, run_type, run_id, project_id, branch_name, base_branch, worktree_strategy, pending_tasks)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, run_type, run_id, project_id, branch_name, base_branch, worktree_strategy, pending_json],
    )?;

    get(conn, &id)?.ok_or_else(|| AppError::NotFound("Integration branch just created".into()))
}

/// Get an integration branch by ID.
pub fn get(conn: &Connection, id: &str) -> Result<Option<IntegrationBranch>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, run_type, run_id, project_id, branch_name, base_branch, worktree_strategy,
                merged_tasks, pending_tasks, conflict_task, conflict_files, pushed, pr_url, status,
                created_at, updated_at
         FROM integration_branches WHERE id = ?1",
    )?;

    let result = stmt.query_row([id], row_to_branch).optional()?;
    Ok(result)
}

/// Get the active integration branch for a run.
pub fn get_by_run(
    conn: &Connection,
    run_type: &str,
    run_id: &str,
) -> Result<Option<IntegrationBranch>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, run_type, run_id, project_id, branch_name, base_branch, worktree_strategy,
                merged_tasks, pending_tasks, conflict_task, conflict_files, pushed, pr_url, status,
                created_at, updated_at
         FROM integration_branches WHERE run_type = ?1 AND run_id = ?2 AND status != 'cleaned_up'
         ORDER BY created_at DESC LIMIT 1",
    )?;

    let result = stmt.query_row([run_type, run_id], row_to_branch).optional()?;
    Ok(result)
}

/// Get the active integration branch for a project.
pub fn get_active_for_project(
    conn: &Connection,
    project_id: &str,
) -> Result<Option<IntegrationBranch>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, run_type, run_id, project_id, branch_name, base_branch, worktree_strategy,
                merged_tasks, pending_tasks, conflict_task, conflict_files, pushed, pr_url, status,
                created_at, updated_at
         FROM integration_branches WHERE project_id = ?1 AND status IN ('active', 'conflict')
         ORDER BY created_at DESC LIMIT 1",
    )?;

    let result = stmt.query_row([project_id], row_to_branch).optional()?;
    Ok(result)
}

/// Record a successful task merge.
pub fn record_merge(
    conn: &Connection,
    id: &str,
    task_id: &str,
) -> Result<(), AppError> {
    let ib = get(conn, id)?.ok_or_else(|| AppError::NotFound("Integration branch".into()))?;

    let mut merged: Vec<String> = ib.merged_tasks;
    if !merged.contains(&task_id.to_string()) {
        merged.push(task_id.to_string());
    }

    let mut pending: Vec<String> = ib.pending_tasks;
    pending.retain(|t| t != task_id);

    let merged_json = serde_json::to_string(&merged).unwrap_or_else(|_| "[]".to_string());
    let pending_json = serde_json::to_string(&pending).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "UPDATE integration_branches SET merged_tasks = ?1, pending_tasks = ?2, updated_at = datetime('now') WHERE id = ?3",
        rusqlite::params![merged_json, pending_json, id],
    )?;

    Ok(())
}

/// Record a merge conflict.
pub fn record_conflict(
    conn: &Connection,
    id: &str,
    task_id: &str,
    conflict_files: &[String],
) -> Result<(), AppError> {
    let files_json = serde_json::to_string(conflict_files).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "UPDATE integration_branches SET conflict_task = ?1, conflict_files = ?2, status = 'conflict', updated_at = datetime('now') WHERE id = ?3",
        rusqlite::params![task_id, files_json, id],
    )?;

    Ok(())
}

/// Clear a conflict (after user resolution or skip).
pub fn clear_conflict(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE integration_branches SET conflict_task = NULL, conflict_files = '[]', status = 'active', updated_at = datetime('now') WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Mark the integration branch as completed (all tasks merged).
pub fn mark_completed(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE integration_branches SET status = 'completed', updated_at = datetime('now') WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Mark the integration branch as pushed to remote.
pub fn mark_pushed(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE integration_branches SET pushed = 1, updated_at = datetime('now') WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Store the PR URL.
pub fn set_pr_url(conn: &Connection, id: &str, pr_url: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE integration_branches SET pr_url = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![pr_url, id],
    )?;
    Ok(())
}

/// Mark as cleaned up (final state after branches deleted).
pub fn mark_cleaned_up(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE integration_branches SET status = 'cleaned_up', updated_at = datetime('now') WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Remove a task from pending (e.g., on skip).
pub fn remove_pending_task(
    conn: &Connection,
    id: &str,
    task_id: &str,
) -> Result<(), AppError> {
    let ib = get(conn, id)?.ok_or_else(|| AppError::NotFound("Integration branch".into()))?;

    let mut pending: Vec<String> = ib.pending_tasks;
    pending.retain(|t| t != task_id);

    let pending_json = serde_json::to_string(&pending).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "UPDATE integration_branches SET pending_tasks = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![pending_json, id],
    )?;

    Ok(())
}

// ── Row mapper ──

fn row_to_branch(row: &rusqlite::Row) -> rusqlite::Result<IntegrationBranch> {
    let merged_str: String = row.get(7)?;
    let pending_str: String = row.get(8)?;
    let conflict_files_str: String = row.get(10)?;

    Ok(IntegrationBranch {
        id: row.get(0)?,
        run_type: row.get(1)?,
        run_id: row.get(2)?,
        project_id: row.get(3)?,
        branch_name: row.get(4)?,
        base_branch: row.get(5)?,
        worktree_strategy: row.get(6)?,
        merged_tasks: serde_json::from_str(&merged_str).unwrap_or_default(),
        pending_tasks: serde_json::from_str(&pending_str).unwrap_or_default(),
        conflict_task: row.get(9)?,
        conflict_files: serde_json::from_str(&conflict_files_str).unwrap_or_default(),
        pushed: row.get(11)?,
        pr_url: row.get(12)?,
        status: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

use rusqlite::OptionalExtension;
