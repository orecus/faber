use rusqlite::{params, Connection};

use super::models::{AgentConfig, NewAgentConfig};

pub fn upsert(conn: &Connection, new: &NewAgentConfig) -> Result<AgentConfig, rusqlite::Error> {
    let flags_json = serde_json::to_string(&new.flags).unwrap_or_else(|_| "[]".to_string());

    // Delete existing then insert — works correctly with NULL scope_id
    conn.execute(
        "DELETE FROM agent_configs WHERE scope = ?1 AND scope_id IS ?2 AND agent_name = ?3",
        params![new.scope, new.scope_id, new.agent_name],
    )?;
    conn.execute(
        "INSERT INTO agent_configs (scope, scope_id, agent_name, model, flags, env_vars)
         VALUES (?1, ?2, ?3, ?4, ?5, '{}')",
        params![new.scope, new.scope_id, new.agent_name, new.model, flags_json],
    )?;
    get(conn, &new.scope, new.scope_id.as_deref(), &new.agent_name)?
        .ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn get(
    conn: &Connection,
    scope: &str,
    scope_id: Option<&str>,
    agent_name: &str,
) -> Result<Option<AgentConfig>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, scope, scope_id, agent_name, model, flags
         FROM agent_configs
         WHERE scope = ?1 AND scope_id IS ?2 AND agent_name = ?3",
    )?;
    let mut rows = stmt.query_map(params![scope, scope_id, agent_name], row_to_config)?;
    rows.next().transpose()
}

/// Resolve with 3-level cascade: task → project → global.
pub fn resolve(
    conn: &Connection,
    task_scope_id: Option<&str>,
    project_id: &str,
    agent_name: &str,
) -> Result<Option<AgentConfig>, rusqlite::Error> {
    if let Some(tid) = task_scope_id {
        if let Some(cfg) = get(conn, "task", Some(tid), agent_name)? {
            return Ok(Some(cfg));
        }
    }
    if let Some(cfg) = get(conn, "project", Some(project_id), agent_name)? {
        return Ok(Some(cfg));
    }
    get(conn, "global", None, agent_name)
}

pub fn delete(
    conn: &Connection,
    scope: &str,
    scope_id: Option<&str>,
    agent_name: &str,
) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "DELETE FROM agent_configs WHERE scope = ?1 AND scope_id IS ?2 AND agent_name = ?3",
        params![scope, scope_id, agent_name],
    )?;
    Ok(count > 0)
}

fn row_to_config(row: &rusqlite::Row) -> Result<AgentConfig, rusqlite::Error> {
    let flags_raw: Option<String> = row.get(5)?;

    Ok(AgentConfig {
        id: row.get(0)?,
        scope: row.get(1)?,
        scope_id: row.get(2)?,
        agent_name: row.get(3)?,
        model: row.get(4)?,
        flags: flags_raw
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn setup() -> Connection {
        let state = db::init_memory().unwrap();
        state.into_inner().unwrap()
    }

    fn new_config(scope: &str, scope_id: Option<&str>, agent: &str) -> NewAgentConfig {
        NewAgentConfig {
            scope: scope.into(),
            scope_id: scope_id.map(String::from),
            agent_name: agent.into(),
            model: Some("opus".into()),
            flags: vec!["--verbose".into()],
        }
    }

    #[test]
    fn upsert_and_get() {
        let conn = setup();
        let cfg = upsert(&conn, &new_config("global", None, "claude")).unwrap();
        assert_eq!(cfg.agent_name, "claude");
        assert_eq!(cfg.model, Some("opus".into()));
        assert_eq!(cfg.flags, vec!["--verbose"]);

        // Upsert overwrites
        let mut updated = new_config("global", None, "claude");
        updated.model = Some("sonnet".into());
        let cfg2 = upsert(&conn, &updated).unwrap();
        assert_eq!(cfg2.model, Some("sonnet".into()));
        // Only one row should exist for this (scope, scope_id, agent_name)
        assert!(get(&conn, "global", None, "claude").unwrap().is_some());
    }

    #[test]
    fn three_level_cascade() {
        let conn = setup();
        upsert(&conn, &new_config("global", None, "claude")).unwrap();

        // Global only
        let r = resolve(&conn, None, "proj_1", "claude").unwrap().unwrap();
        assert_eq!(r.scope, "global");

        // Project overrides global
        let mut proj = new_config("project", Some("proj_1"), "claude");
        proj.model = Some("haiku".into());
        upsert(&conn, &proj).unwrap();
        let r = resolve(&conn, None, "proj_1", "claude").unwrap().unwrap();
        assert_eq!(r.scope, "project");
        assert_eq!(r.model, Some("haiku".into()));

        // Task overrides project
        let mut task = new_config("task", Some("T-001"), "claude");
        task.model = Some("sonnet".into());
        upsert(&conn, &task).unwrap();
        let r = resolve(&conn, Some("T-001"), "proj_1", "claude").unwrap().unwrap();
        assert_eq!(r.scope, "task");
        assert_eq!(r.model, Some("sonnet".into()));
    }

    #[test]
    fn delete_config() {
        let conn = setup();
        upsert(&conn, &new_config("global", None, "claude")).unwrap();
        assert!(delete(&conn, "global", None, "claude").unwrap());
        assert!(get(&conn, "global", None, "claude").unwrap().is_none());
        assert!(!delete(&conn, "global", None, "claude").unwrap());
    }

    #[test]
    fn resolve_returns_none_when_missing() {
        let conn = setup();
        assert!(resolve(&conn, None, "proj_1", "nonexistent").unwrap().is_none());
    }
}
