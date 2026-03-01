use rusqlite::{params, Connection};
use tracing::{debug, info, warn};

use super::generate_id;
use super::models::{NewSession, Session, SessionStatus};

pub fn create(conn: &Connection, new: &NewSession) -> Result<Session, rusqlite::Error> {
    let id = generate_id("sess");
    create_with_id(conn, &id, new)
}

pub fn create_with_id(conn: &Connection, id: &str, new: &NewSession) -> Result<Session, rusqlite::Error> {
    conn.execute(
        "INSERT INTO sessions (id, project_id, task_id, name, mode, agent, model, worktree_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            new.project_id,
            new.task_id,
            new.name,
            new.mode.as_str(),
            new.agent,
            new.model,
            new.worktree_path,
        ],
    )?;
    get(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Session>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, project_id, task_id, name, mode, agent, model, status, pid, worktree_path,
                mcp_connected, started_at, ended_at
         FROM sessions WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], row_to_session)?;
    rows.next().transpose()
}

pub fn list_by_project(conn: &Connection, project_id: &str) -> Result<Vec<Session>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, project_id, task_id, name, mode, agent, model, status, pid, worktree_path,
                mcp_connected, started_at, ended_at
         FROM sessions WHERE project_id = ?1 ORDER BY started_at DESC",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_session)?;
    let sessions: Vec<Session> = rows.collect::<Result<_, _>>()?;
    debug!(
        project_id,
        count = sessions.len(),
        statuses = %sessions.iter().map(|s| format!("{}:{}", &s.id[..s.id.len().min(12)], s.status)).collect::<Vec<_>>().join(", "),
        "list_by_project"
    );
    Ok(sessions)
}

pub fn list_active(conn: &Connection) -> Result<Vec<Session>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, project_id, task_id, name, mode, agent, model, status, pid, worktree_path,
                mcp_connected, started_at, ended_at
         FROM sessions WHERE status IN ('starting', 'running', 'paused')
         ORDER BY started_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_session)?;
    rows.collect()
}

pub fn update_mcp_connected(
    conn: &Connection,
    id: &str,
    connected: bool,
) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "UPDATE sessions SET mcp_connected = ?1 WHERE id = ?2",
        params![connected as i32, id],
    )?;
    Ok(count > 0)
}

pub fn update_status(
    conn: &Connection,
    id: &str,
    status: SessionStatus,
) -> Result<bool, rusqlite::Error> {
    // Only fetch old status when debug/info tracing is enabled (avoids extra SELECT)
    if tracing::enabled!(tracing::Level::INFO) {
        let old_status: Option<String> = conn
            .query_row("SELECT status FROM sessions WHERE id = ?1", params![id], |row| row.get(0))
            .ok();
        info!(
            session_id = id,
            old_status = old_status.as_deref().unwrap_or("(not found)"),
            new_status = status.as_str(),
            "Session status change"
        );
    }

    let ended_at = match status {
        SessionStatus::Stopped | SessionStatus::Finished | SessionStatus::Error => {
            Some("datetime('now')".to_string())
        }
        _ => None,
    };

    let count = if ended_at.is_some() {
        conn.execute(
            "UPDATE sessions SET status = ?1, ended_at = datetime('now') WHERE id = ?2",
            params![status.as_str(), id],
        )?
    } else {
        conn.execute(
            "UPDATE sessions SET status = ?1 WHERE id = ?2",
            params![status.as_str(), id],
        )?
    };
    Ok(count > 0)
}

/// Mark all active sessions (starting/running/paused) as stopped.
/// Called on app startup to clean up sessions orphaned by a crash or force-quit.
/// Returns the number of sessions that were cleaned up.
pub fn cleanup_orphaned(conn: &Connection) -> Result<usize, rusqlite::Error> {
    // Log which sessions will be affected (for debugging T-062 — shared DB between instances)
    let mut stmt = conn.prepare(
        "SELECT id, project_id, mode, agent, status FROM sessions
         WHERE status IN ('starting', 'running', 'paused')",
    )?;
    let orphans: Vec<(String, String, String, String, String)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })?
        .filter_map(|r| r.ok())
        .collect();
    for (id, pid, mode, agent, status) in &orphans {
        warn!(
            session_id = id.as_str(),
            project_id = pid.as_str(),
            mode = mode.as_str(),
            agent = agent.as_str(),
            old_status = status.as_str(),
            "cleanup_orphaned: marking session as stopped"
        );
    }

    let count = conn.execute(
        "UPDATE sessions SET status = 'stopped', ended_at = datetime('now')
         WHERE status IN ('starting', 'running', 'paused')",
        [],
    )?;
    Ok(count)
}

pub fn update_name(conn: &Connection, id: &str, name: Option<&str>) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "UPDATE sessions SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    Ok(count > 0)
}

pub fn delete(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let count = conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
    Ok(count > 0)
}

#[cfg(test)]
pub fn update_pid(conn: &Connection, id: &str, pid: i64) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "UPDATE sessions SET pid = ?1 WHERE id = ?2",
        params![pid, id],
    )?;
    Ok(count > 0)
}

fn row_to_session(row: &rusqlite::Row) -> Result<Session, rusqlite::Error> {
    let mode_str: String = row.get(4)?;
    let status_str: String = row.get(7)?;
    let mcp_int: i32 = row.get(10)?;

    Ok(Session {
        id: row.get(0)?,
        project_id: row.get(1)?,
        task_id: row.get(2)?,
        name: row.get(3)?,
        mode: mode_str.parse().map_err(|e: String| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::from(e))
        })?,
        agent: row.get(5)?,
        model: row.get(6)?,
        status: status_str.parse().map_err(|e: String| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::from(e))
        })?,
        pid: row.get(8)?,
        worktree_path: row.get(9)?,
        mcp_connected: mcp_int != 0,
        started_at: row.get(11)?,
        ended_at: row.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::models::{NewProject, SessionMode};
    use crate::db::projects;

    fn setup() -> (Connection, String) {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        let p = projects::create(
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

    fn new_session(project_id: &str) -> NewSession {
        NewSession {
            project_id: project_id.into(),
            task_id: None,
            name: None,
            mode: SessionMode::Task,
            agent: "claude".into(),
            model: Some("opus".into()),
            worktree_path: None,
        }
    }

    #[test]
    fn create_and_get_session() {
        let (conn, pid) = setup();
        let s = create(&conn, &new_session(&pid)).unwrap();
        assert!(s.id.starts_with("sess_"));
        assert_eq!(s.status, SessionStatus::Starting);
        assert!(s.ended_at.is_none());

        let fetched = get(&conn, &s.id).unwrap().unwrap();
        assert_eq!(fetched.agent, "claude");
    }

    #[test]
    fn list_by_project_and_active() {
        let (conn, pid) = setup();
        create(&conn, &new_session(&pid)).unwrap();
        assert_eq!(list_by_project(&conn, &pid).unwrap().len(), 1);
        assert_eq!(list_active(&conn).unwrap().len(), 1);
    }

    #[test]
    fn update_status_sets_ended_at() {
        let (conn, pid) = setup();
        let s = create(&conn, &new_session(&pid)).unwrap();

        update_status(&conn, &s.id, SessionStatus::Running).unwrap();
        let s = get(&conn, &s.id).unwrap().unwrap();
        assert_eq!(s.status, SessionStatus::Running);
        assert!(s.ended_at.is_none());

        update_status(&conn, &s.id, SessionStatus::Finished).unwrap();
        let s = get(&conn, &s.id).unwrap().unwrap();
        assert_eq!(s.status, SessionStatus::Finished);
        assert!(s.ended_at.is_some());
    }

    #[test]
    fn update_pid_works() {
        let (conn, pid) = setup();
        let s = create(&conn, &new_session(&pid)).unwrap();
        update_pid(&conn, &s.id, 12345).unwrap();
        let s = get(&conn, &s.id).unwrap().unwrap();
        assert_eq!(s.pid, Some(12345));
    }

    #[test]
    fn cascade_on_project_delete() {
        let (conn, pid) = setup();
        let s = create(&conn, &new_session(&pid)).unwrap();
        projects::delete(&conn, &pid).unwrap();
        assert!(get(&conn, &s.id).unwrap().is_none());
    }
}
