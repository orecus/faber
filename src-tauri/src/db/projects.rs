use rusqlite::{params, Connection};

use super::generate_id;
use super::models::{NewProject, Project, UpdateProject};

pub fn create(conn: &Connection, new: &NewProject) -> Result<Project, rusqlite::Error> {
    let id = generate_id("proj");
    conn.execute(
        "INSERT INTO projects (id, name, path, default_agent, default_model, branch_naming_pattern, instruction_file_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            new.name,
            new.path,
            new.default_agent,
            new.default_model,
            new.branch_naming_pattern,
            new.instruction_file_path,
        ],
    )?;
    get(conn, &id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Project>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, default_agent, default_model, branch_naming_pattern,
                instruction_file_path, icon_path, color, created_at, updated_at
         FROM projects WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], row_to_project)?;
    rows.next().transpose()
}

pub fn get_by_path(conn: &Connection, path: &str) -> Result<Option<Project>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, default_agent, default_model, branch_naming_pattern,
                instruction_file_path, icon_path, color, created_at, updated_at
         FROM projects WHERE path = ?1",
    )?;
    let mut rows = stmt.query_map(params![path], row_to_project)?;
    rows.next().transpose()
}

pub fn list(conn: &Connection) -> Result<Vec<Project>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, default_agent, default_model, branch_naming_pattern,
                instruction_file_path, icon_path, color, created_at, updated_at
         FROM projects ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_project)?;
    rows.collect()
}

pub fn update(conn: &Connection, id: &str, upd: &UpdateProject) -> Result<Project, rusqlite::Error> {
    if let Some(ref name) = upd.name {
        conn.execute(
            "UPDATE projects SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![name, id],
        )?;
    }
    if let Some(ref val) = upd.default_agent {
        conn.execute(
            "UPDATE projects SET default_agent = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![val, id],
        )?;
    }
    if let Some(ref val) = upd.default_model {
        conn.execute(
            "UPDATE projects SET default_model = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![val, id],
        )?;
    }
    if let Some(ref val) = upd.branch_naming_pattern {
        conn.execute(
            "UPDATE projects SET branch_naming_pattern = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![val, id],
        )?;
    }
    if let Some(ref val) = upd.instruction_file_path {
        conn.execute(
            "UPDATE projects SET instruction_file_path = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![val, id],
        )?;
    }
    if let Some(ref val) = upd.icon_path {
        conn.execute(
            "UPDATE projects SET icon_path = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![val, id],
        )?;
    }
    if let Some(ref val) = upd.color {
        conn.execute(
            "UPDATE projects SET color = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![val, id],
        )?;
    }
    get(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn delete(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let count = conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    Ok(count > 0)
}

fn row_to_project(row: &rusqlite::Row) -> Result<Project, rusqlite::Error> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        default_agent: row.get(3)?,
        default_model: row.get(4)?,
        branch_naming_pattern: row.get(5)?,
        instruction_file_path: row.get(6)?,
        icon_path: row.get(7)?,
        color: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
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

    fn new_project(name: &str, path: &str) -> NewProject {
        NewProject {
            name: name.to_string(),
            path: path.to_string(),
            default_agent: None,
            default_model: None,
            branch_naming_pattern: None,
            instruction_file_path: None,
        }
    }

    #[test]
    fn create_and_get() {
        let conn = setup();
        let p = create(&conn, &new_project("test", "/tmp/test")).unwrap();
        assert!(p.id.starts_with("proj_"));
        assert_eq!(p.name, "test");

        let fetched = get(&conn, &p.id).unwrap().unwrap();
        assert_eq!(fetched.id, p.id);
    }

    #[test]
    fn get_by_path_works() {
        let conn = setup();
        create(&conn, &new_project("test", "/tmp/unique")).unwrap();
        let found = get_by_path(&conn, "/tmp/unique").unwrap();
        assert!(found.is_some());
        assert!(get_by_path(&conn, "/nonexistent").unwrap().is_none());
    }

    #[test]
    fn list_projects() {
        let conn = setup();
        create(&conn, &new_project("a", "/tmp/a")).unwrap();
        create(&conn, &new_project("b", "/tmp/b")).unwrap();
        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn update_project() {
        let conn = setup();
        let p = create(&conn, &new_project("old", "/tmp/upd")).unwrap();
        let updated = update(
            &conn,
            &p.id,
            &UpdateProject {
                name: Some("new".to_string()),
                default_agent: None,
                default_model: None,
                branch_naming_pattern: None,
                instruction_file_path: None,
                icon_path: None,
                color: None,
            },
        )
        .unwrap();
        assert_eq!(updated.name, "new");
    }

    #[test]
    fn delete_project() {
        let conn = setup();
        let p = create(&conn, &new_project("del", "/tmp/del")).unwrap();
        assert!(delete(&conn, &p.id).unwrap());
        assert!(get(&conn, &p.id).unwrap().is_none());
        assert!(!delete(&conn, &p.id).unwrap());
    }

    #[test]
    fn unique_path_constraint() {
        let conn = setup();
        create(&conn, &new_project("a", "/tmp/dup")).unwrap();
        let err = create(&conn, &new_project("b", "/tmp/dup"));
        assert!(err.is_err());
    }
}
