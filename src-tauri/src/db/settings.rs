use rusqlite::{params, Connection};

use super::models::Setting;

pub fn set_value(
    conn: &Connection,
    scope: &str,
    scope_id: Option<&str>,
    key: &str,
    value: &str,
) -> Result<(), rusqlite::Error> {
    // Delete existing then insert — works correctly with NULL scope_id
    conn.execute(
        "DELETE FROM settings WHERE scope = ?1 AND scope_id IS ?2 AND key = ?3",
        params![scope, scope_id, key],
    )?;
    conn.execute(
        "INSERT INTO settings (scope, scope_id, key, value) VALUES (?1, ?2, ?3, ?4)",
        params![scope, scope_id, key, value],
    )?;
    Ok(())
}

pub fn get_value(
    conn: &Connection,
    scope: &str,
    scope_id: Option<&str>,
    key: &str,
) -> Result<Option<String>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        "SELECT value FROM settings WHERE scope = ?1 AND scope_id IS ?2 AND key = ?3",
    )?;
    let mut rows = stmt.query_map(params![scope, scope_id, key], |row| row.get(0))?;
    rows.next().transpose()
}

/// Resolve a setting with cascade: project scope → global scope.
pub fn get_resolved(
    conn: &Connection,
    project_id: &str,
    key: &str,
) -> Result<Option<String>, rusqlite::Error> {
    if let Some(val) = get_value(conn, "project", Some(project_id), key)? {
        return Ok(Some(val));
    }
    get_value(conn, "global", None, key)
}

#[cfg(test)]
pub fn delete_value(
    conn: &Connection,
    scope: &str,
    scope_id: Option<&str>,
    key: &str,
) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "DELETE FROM settings WHERE scope = ?1 AND scope_id IS ?2 AND key = ?3",
        params![scope, scope_id, key],
    )?;
    Ok(count > 0)
}

pub fn get_all(
    conn: &Connection,
    scope: &str,
    scope_id: Option<&str>,
) -> Result<Vec<Setting>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, scope, scope_id, key, value FROM settings
         WHERE scope = ?1 AND scope_id IS ?2 ORDER BY key",
    )?;
    let rows = stmt.query_map(params![scope, scope_id], |row| {
        Ok(Setting {
            id: row.get(0)?,
            scope: row.get(1)?,
            scope_id: row.get(2)?,
            key: row.get(3)?,
            value: row.get(4)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn setup() -> Connection {
        let state = db::init_memory().unwrap();
        state.into_inner().unwrap()
    }

    #[test]
    fn set_and_get() {
        let conn = setup();
        set_value(&conn, "global", None, "theme", "dark").unwrap();
        assert_eq!(
            get_value(&conn, "global", None, "theme").unwrap(),
            Some("dark".into())
        );
    }

    #[test]
    fn upsert_overwrite() {
        let conn = setup();
        set_value(&conn, "global", None, "theme", "dark").unwrap();
        set_value(&conn, "global", None, "theme", "light").unwrap();
        assert_eq!(
            get_value(&conn, "global", None, "theme").unwrap(),
            Some("light".into())
        );
    }

    #[test]
    fn cascade_resolution() {
        let conn = setup();
        set_value(&conn, "global", None, "model", "sonnet").unwrap();
        // No project override → falls back to global
        assert_eq!(
            get_resolved(&conn, "proj_123", "model").unwrap(),
            Some("sonnet".into())
        );

        // Project override wins
        set_value(&conn, "project", Some("proj_123"), "model", "opus").unwrap();
        assert_eq!(
            get_resolved(&conn, "proj_123", "model").unwrap(),
            Some("opus".into())
        );
    }

    #[test]
    fn delete_and_get_all() {
        let conn = setup();
        set_value(&conn, "global", None, "a", "1").unwrap();
        set_value(&conn, "global", None, "b", "2").unwrap();
        let all = get_all(&conn, "global", None).unwrap();
        assert_eq!(all.len(), 2);

        assert!(delete_value(&conn, "global", None, "a").unwrap());
        assert!(!delete_value(&conn, "global", None, "a").unwrap());
        assert_eq!(get_all(&conn, "global", None).unwrap().len(), 1);
    }

    #[test]
    fn missing_key_returns_none() {
        let conn = setup();
        assert!(get_value(&conn, "global", None, "nonexistent").unwrap().is_none());
        assert!(get_resolved(&conn, "proj_123", "nonexistent").unwrap().is_none());
    }
}
