use rusqlite::{params, Connection};

use super::models::TaskActivity;

/// Insert a new task activity event.
#[allow(clippy::too_many_arguments)]
pub fn insert(
    conn: &Connection,
    id: &str,
    task_id: &str,
    project_id: &str,
    session_id: Option<&str>,
    event_type: &str,
    timestamp: &str,
    data: &serde_json::Value,
) -> Result<(), rusqlite::Error> {
    let data_str = serde_json::to_string(data).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "INSERT INTO task_activity (id, task_id, project_id, session_id, event_type, timestamp, data)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, task_id, project_id, session_id, event_type, timestamp, data_str],
    )?;
    Ok(())
}

/// List activity events for a task, ordered by timestamp descending.
/// Use `limit` to cap the number of results (0 = unlimited).
pub fn list_by_task(
    conn: &Connection,
    task_id: &str,
    project_id: &str,
    limit: u32,
) -> Result<Vec<TaskActivity>, rusqlite::Error> {
    let sql = if limit > 0 {
        format!(
            "SELECT id, task_id, project_id, session_id, event_type, timestamp, data
             FROM task_activity
             WHERE task_id = ?1 AND project_id = ?2
             ORDER BY timestamp DESC
             LIMIT {limit}"
        )
    } else {
        "SELECT id, task_id, project_id, session_id, event_type, timestamp, data
         FROM task_activity
         WHERE task_id = ?1 AND project_id = ?2
         ORDER BY timestamp DESC"
            .to_string()
    };

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![task_id, project_id], row_to_activity)?;
    rows.collect()
}

/// List activity events for a session, ordered by timestamp ascending.
#[allow(dead_code)]
pub fn list_by_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<TaskActivity>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, project_id, session_id, event_type, timestamp, data
         FROM task_activity
         WHERE session_id = ?1
         ORDER BY timestamp ASC",
    )?;
    let rows = stmt.query_map(params![session_id], row_to_activity)?;
    rows.collect()
}

/// Delete all activity events for a task.
#[allow(dead_code)]
pub fn delete_by_task(
    conn: &Connection,
    task_id: &str,
    project_id: &str,
) -> Result<usize, rusqlite::Error> {
    conn.execute(
        "DELETE FROM task_activity WHERE task_id = ?1 AND project_id = ?2",
        params![task_id, project_id],
    )
}

fn row_to_activity(row: &rusqlite::Row) -> Result<TaskActivity, rusqlite::Error> {
    let data_str: String = row.get(6)?;
    let data: serde_json::Value =
        serde_json::from_str(&data_str).unwrap_or(serde_json::Value::Object(Default::default()));

    Ok(TaskActivity {
        id: row.get(0)?,
        task_id: row.get(1)?,
        project_id: row.get(2)?,
        session_id: row.get(3)?,
        event_type: row.get(4)?,
        timestamp: row.get(5)?,
        data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::models::NewProject;
    use crate::db::projects;
    use serde_json::json;

    fn setup() -> (Connection, String) {
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

    #[test]
    fn insert_and_list_by_task() {
        let (conn, pid) = setup();

        insert(
            &conn,
            "act_1",
            "T-001",
            &pid,
            Some("sess_1"),
            "status",
            "2026-03-04T10:00:00Z",
            &json!({"status": "working", "message": "Starting"}),
        )
        .unwrap();

        insert(
            &conn,
            "act_2",
            "T-001",
            &pid,
            Some("sess_1"),
            "progress",
            "2026-03-04T10:01:00Z",
            &json!({"current_step": 1, "total_steps": 3, "description": "Step 1"}),
        )
        .unwrap();

        let activities = list_by_task(&conn, "T-001", &pid, 0).unwrap();
        assert_eq!(activities.len(), 2);
        // DESC order — most recent first
        assert_eq!(activities[0].event_type, "progress");
        assert_eq!(activities[1].event_type, "status");
    }

    #[test]
    fn list_by_task_with_limit() {
        let (conn, pid) = setup();

        for i in 0..5 {
            insert(
                &conn,
                &format!("act_{i}"),
                "T-001",
                &pid,
                Some("sess_1"),
                "status",
                &format!("2026-03-04T10:0{i}:00Z"),
                &json!({"status": "working"}),
            )
            .unwrap();
        }

        let activities = list_by_task(&conn, "T-001", &pid, 3).unwrap();
        assert_eq!(activities.len(), 3);
    }

    #[test]
    fn list_by_session_filters() {
        let (conn, pid) = setup();

        insert(
            &conn,
            "act_1",
            "T-001",
            &pid,
            Some("sess_1"),
            "status",
            "2026-03-04T10:00:00Z",
            &json!({"status": "working"}),
        )
        .unwrap();

        insert(
            &conn,
            "act_2",
            "T-001",
            &pid,
            Some("sess_2"),
            "status",
            "2026-03-04T10:01:00Z",
            &json!({"status": "working"}),
        )
        .unwrap();

        let activities = list_by_session(&conn, "sess_1").unwrap();
        assert_eq!(activities.len(), 1);
        assert_eq!(activities[0].session_id.as_deref(), Some("sess_1"));
    }

    #[test]
    fn delete_by_task_clears_all() {
        let (conn, pid) = setup();

        insert(
            &conn,
            "act_1",
            "T-001",
            &pid,
            Some("sess_1"),
            "status",
            "2026-03-04T10:00:00Z",
            &json!({}),
        )
        .unwrap();

        insert(
            &conn,
            "act_2",
            "T-001",
            &pid,
            Some("sess_1"),
            "complete",
            "2026-03-04T10:05:00Z",
            &json!({}),
        )
        .unwrap();

        let deleted = delete_by_task(&conn, "T-001", &pid).unwrap();
        assert_eq!(deleted, 2);
        assert_eq!(list_by_task(&conn, "T-001", &pid, 0).unwrap().len(), 0);
    }
}
