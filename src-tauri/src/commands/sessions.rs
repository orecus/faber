use std::sync::Arc;

use tauri::{AppHandle, State};
use tokio::sync::Mutex as TokioMutex;

use crate::db;
use crate::db::models::Session;
use crate::db::DbState;
use crate::error::AppError;
use crate::mcp::McpState;
use crate::pty::PtyState;
use crate::session::{self, ResearchSessionOpts, VibeSessionOpts};

// ── Core logic (testable without Tauri State) ──

fn do_list_sessions(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
) -> Result<Vec<Session>, AppError> {
    match project_id {
        Some(pid) => Ok(db::sessions::list_by_project(conn, pid)?),
        None => Ok(db::sessions::list_active(conn)?),
    }
}

fn do_get_session(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Session, AppError> {
    db::sessions::get(conn, session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Session {session_id}")))
}

// ── IPC Commands ──

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_task_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    app: AppHandle,
    project_id: String,
    task_id: String,
    agent_name: Option<String>,
    model: Option<String>,
    create_worktree: Option<bool>,
    base_branch: Option<String>,
    user_prompt: Option<String>,
) -> Result<Session, AppError> {
    // Get MCP port BEFORE acquiring DB lock to avoid nested mutex contention
    let mcp_port = session::get_mcp_port(&mcp);
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let session = session::start_task_session(
        &conn,
        &pty,
        &app,
        &mcp,
        mcp_port,
        &project_id,
        &task_id,
        agent_name.as_deref(),
        model.as_deref(),
        create_worktree.unwrap_or(true),
        base_branch.as_deref(),
        user_prompt.as_deref(),
    )?;
    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        task_id = %task_id,
        agent = %session.agent,
        model = ?session.model,
        mode = "task",
        "Session launched"
    );
    Ok(session)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_vibe_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    app: AppHandle,
    project_id: String,
    agent_name: Option<String>,
    model: Option<String>,
    create_worktree: Option<bool>,
    base_branch: Option<String>,
    user_prompt: Option<String>,
) -> Result<Session, AppError> {
    let mcp_port = session::get_mcp_port(&mcp);
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let opts = VibeSessionOpts {
        agent_name: agent_name.as_deref(),
        model: model.as_deref(),
        create_worktree: create_worktree.unwrap_or(false),
        base_branch: base_branch.as_deref(),
        user_prompt: user_prompt.as_deref(),
    };
    let session = session::start_vibe_session(&conn, &pty, &app, &mcp, mcp_port, &project_id, &opts)?;
    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        agent = %session.agent,
        model = ?session.model,
        mode = "vibe",
        "Session launched"
    );
    Ok(session)
}

#[tauri::command]
pub fn start_shell_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    app: AppHandle,
    project_id: String,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let session = session::start_shell_session(&conn, &pty, &app, &project_id)?;
    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        mode = "shell",
        "Session launched"
    );
    Ok(session)
}

#[tauri::command]
pub fn start_skill_install_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    app: AppHandle,
    project_id: String,
    source: String,
    skill_name: String,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let session = session::start_skill_install_session(
        &conn, &pty, &app, &project_id, &source, &skill_name,
    )?;
    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        skill_name = %skill_name,
        "Skill install session launched"
    );
    Ok(session)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_research_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    app: AppHandle,
    project_id: String,
    task_id: String,
    agent_name: Option<String>,
    model: Option<String>,
    user_prompt: Option<String>,
) -> Result<Session, AppError> {
    let mcp_port = session::get_mcp_port(&mcp);
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let opts = ResearchSessionOpts {
        task_id: &task_id,
        agent_name: agent_name.as_deref(),
        model: model.as_deref(),
        user_prompt: user_prompt.as_deref(),
    };
    let session = session::start_research_session(&conn, &pty, &app, &mcp, mcp_port, &project_id, &opts)?;
    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        task_id = %task_id,
        agent = %session.agent,
        model = ?session.model,
        mode = "research",
        "Session launched"
    );
    Ok(session)
}

#[tauri::command]
pub fn relaunch_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    app: AppHandle,
    session_id: String,
) -> Result<Session, AppError> {
    let mcp_port = session::get_mcp_port(&mcp);
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let session = session::relaunch_session(&conn, &pty, &app, &mcp, mcp_port, &session_id)?;
    tracing::info!(session_id = %session.id, mode = %session.mode, "Session relaunched");
    Ok(session)
}

#[tauri::command]
pub fn stop_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    app: AppHandle,
    session_id: String,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let session = session::stop_session(&conn, &pty, &app, &mcp, &session_id)?;
    tracing::info!(session_id = %session_id, "Session stopped");
    Ok(session)
}

#[tauri::command]
pub fn stop_and_remove_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    app: AppHandle,
    session_id: String,
) -> Result<(), AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    session::stop_and_remove_session(&conn, &pty, &app, &mcp, &session_id)?;
    tracing::info!(session_id = %session_id, "Session stopped and removed");
    Ok(())
}

#[tauri::command]
pub fn rename_session(
    db: State<'_, DbState>,
    session_id: String,
    name: Option<String>,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::sessions::update_name(&conn, &session_id, name.as_deref())?;
    db::sessions::get(&conn, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Session {session_id}")))
}

#[tauri::command]
pub fn remove_session(
    db: State<'_, DbState>,
    session_id: String,
) -> Result<bool, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let deleted = db::sessions::delete(&conn, &session_id)?;
    if deleted {
        tracing::info!(session_id = %session_id, "Session removed");
    }
    Ok(deleted)
}

#[tauri::command]
pub fn list_sessions(
    db: State<'_, DbState>,
    project_id: Option<String>,
) -> Result<Vec<Session>, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    do_list_sessions(&conn, project_id.as_deref())
}

#[tauri::command]
pub fn get_session(
    db: State<'_, DbState>,
    session_id: String,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    do_get_session(&conn, &session_id)
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::models::{NewProject, NewSession, SessionMode};

    fn setup() -> (rusqlite::Connection, String) {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        let p = db::projects::create(
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
        (conn, p.id)
    }

    #[test]
    fn list_sessions_by_project() {
        let (conn, pid) = setup();
        db::sessions::create(
            &conn,
            &NewSession {
                project_id: pid.clone(),
                task_id: None,
                name: None,
                mode: SessionMode::Vibe,
                agent: "claude-code".into(),
                model: None,
                worktree_path: None,
            },
        )
        .unwrap();

        let sessions = do_list_sessions(&conn, Some(&pid)).unwrap();
        assert_eq!(sessions.len(), 1);

        let sessions = do_list_sessions(&conn, Some("nonexistent")).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn list_sessions_active() {
        let (conn, pid) = setup();
        let s = db::sessions::create(
            &conn,
            &NewSession {
                project_id: pid.clone(),
                task_id: None,
                name: None,
                mode: SessionMode::Task,
                agent: "claude-code".into(),
                model: None,
                worktree_path: None,
            },
        )
        .unwrap();

        // Active sessions (status: starting)
        let sessions = do_list_sessions(&conn, None).unwrap();
        assert_eq!(sessions.len(), 1);

        // Stop it
        db::sessions::update_status(&conn, &s.id, crate::db::models::SessionStatus::Stopped)
            .unwrap();
        let sessions = do_list_sessions(&conn, None).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn get_session_found_and_not_found() {
        let (conn, pid) = setup();
        let s = db::sessions::create(
            &conn,
            &NewSession {
                project_id: pid,
                task_id: None,
                name: None,
                mode: SessionMode::Vibe,
                agent: "claude-code".into(),
                model: None,
                worktree_path: None,
            },
        )
        .unwrap();

        let fetched = do_get_session(&conn, &s.id).unwrap();
        assert_eq!(fetched.id, s.id);

        let result = do_get_session(&conn, "nonexistent");
        assert!(result.is_err());
    }
}
