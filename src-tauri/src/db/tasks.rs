use rusqlite::{params, Connection};

use super::models::{NewTask, Task, TaskStatus};

pub fn upsert(conn: &Connection, new: &NewTask) -> Result<Task, rusqlite::Error> {
    let status = new.status.unwrap_or(TaskStatus::Backlog).as_str().to_string();
    let priority = new
        .priority
        .unwrap_or(super::models::Priority::P2)
        .as_str()
        .to_string();
    let depends_on = serde_json::to_string(&new.depends_on).unwrap_or_else(|_| "[]".to_string());
    let labels = serde_json::to_string(&new.labels).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO tasks (id, project_id, task_file_path, title, status, priority, agent, model,
                            branch, worktree_path, github_issue, depends_on, labels, github_pr, body)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT(id, project_id) DO UPDATE SET
            task_file_path = excluded.task_file_path,
            title          = excluded.title,
            status         = excluded.status,
            priority       = excluded.priority,
            agent          = excluded.agent,
            model          = excluded.model,
            branch         = excluded.branch,
            worktree_path  = excluded.worktree_path,
            github_issue   = excluded.github_issue,
            depends_on     = excluded.depends_on,
            labels         = excluded.labels,
            github_pr      = excluded.github_pr,
            body           = excluded.body,
            updated_at     = datetime('now')",
        params![
            new.id,
            new.project_id,
            new.task_file_path,
            new.title,
            status,
            priority,
            new.agent,
            new.model,
            new.branch,
            new.worktree_path,
            new.github_issue,
            depends_on,
            labels,
            new.github_pr,
            new.body,
        ],
    )?;
    get(conn, &new.id, &new.project_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

pub fn get(conn: &Connection, id: &str, project_id: &str) -> Result<Option<Task>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, task_file_path, title, status, priority, agent, model,
                branch, worktree_path, github_issue, depends_on, labels, created_at, updated_at, github_pr, body
         FROM tasks WHERE id = ?1 AND project_id = ?2",
    )?;
    let mut rows = stmt.query_map(params![id, project_id], row_to_task)?;
    rows.next().transpose()
}

pub fn list_by_project(conn: &Connection, project_id: &str) -> Result<Vec<Task>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, task_file_path, title, status, priority, agent, model,
                branch, worktree_path, github_issue, depends_on, labels, created_at, updated_at, github_pr, body
         FROM tasks WHERE project_id = ?1 ORDER BY created_at",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_task)?;
    rows.collect()
}

pub fn update_status(
    conn: &Connection,
    id: &str,
    project_id: &str,
    status: TaskStatus,
) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "UPDATE tasks SET status = ?1, updated_at = datetime('now') WHERE id = ?2 AND project_id = ?3",
        params![status.as_str(), id, project_id],
    )?;
    Ok(count > 0)
}

pub fn update_worktree(
    conn: &Connection,
    id: &str,
    project_id: &str,
    worktree_path: Option<&str>,
) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "UPDATE tasks SET worktree_path = ?1, updated_at = datetime('now') WHERE id = ?2 AND project_id = ?3",
        params![worktree_path, id, project_id],
    )?;
    Ok(count > 0)
}

pub fn update_github_pr(
    conn: &Connection,
    id: &str,
    project_id: &str,
    github_pr: Option<&str>,
) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "UPDATE tasks SET github_pr = ?1, updated_at = datetime('now') WHERE id = ?2 AND project_id = ?3",
        params![github_pr, id, project_id],
    )?;
    Ok(count > 0)
}

pub fn delete(conn: &Connection, id: &str, project_id: &str) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "DELETE FROM tasks WHERE id = ?1 AND project_id = ?2",
        params![id, project_id],
    )?;
    Ok(count > 0)
}

fn parse_json_array(s: Option<String>) -> Vec<String> {
    s.and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default()
}

fn row_to_task(row: &rusqlite::Row) -> Result<Task, rusqlite::Error> {
    let status_str: String = row.get(4)?;
    let priority_str: String = row.get(5)?;
    let depends_on_raw: Option<String> = row.get(11)?;
    let labels_raw: Option<String> = row.get(12)?;
    let body_raw: Option<String> = row.get(16)?;

    Ok(Task {
        id: row.get(0)?,
        project_id: row.get(1)?,
        task_file_path: row.get(2)?,
        title: row.get(3)?,
        status: status_str.parse().map_err(|e: String| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::from(e))
        })?,
        priority: priority_str.parse().map_err(|e: String| {
            rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::from(e))
        })?,
        agent: row.get(6)?,
        model: row.get(7)?,
        branch: row.get(8)?,
        worktree_path: row.get(9)?,
        github_issue: row.get(10)?,
        depends_on: parse_json_array(depends_on_raw),
        labels: parse_json_array(labels_raw),
        body: body_raw.unwrap_or_default(),
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        github_pr: row.get(15)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::models::{NewProject, Priority};
    use crate::db::projects;

    fn setup() -> Connection {
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
        conn
    }

    fn project_id(conn: &Connection) -> String {
        projects::list(conn).unwrap()[0].id.clone()
    }

    fn new_task(project_id: &str) -> NewTask {
        NewTask {
            id: "T-001".into(),
            project_id: project_id.into(),
            task_file_path: None,
            title: "Test task".into(),
            status: None,
            priority: None,
            agent: None,
            model: None,
            branch: None,
            worktree_path: None,
            github_issue: None,
            github_pr: None,
            depends_on: vec![],
            labels: vec!["backend".into()],
            body: String::new(),
        }
    }

    #[test]
    fn upsert_creates_and_updates() {
        let conn = setup();
        let pid = project_id(&conn);
        let t = upsert(&conn, &new_task(&pid)).unwrap();
        assert_eq!(t.id, "T-001");
        assert_eq!(t.status, TaskStatus::Backlog);
        assert_eq!(t.priority, Priority::P2);
        assert_eq!(t.labels, vec!["backend"]);

        // Upsert with updated title
        let mut nt = new_task(&pid);
        nt.title = "Updated".into();
        nt.status = Some(TaskStatus::Ready);
        let t2 = upsert(&conn, &nt).unwrap();
        assert_eq!(t2.title, "Updated");
        assert_eq!(t2.status, TaskStatus::Ready);

        // Still only one task
        assert_eq!(list_by_project(&conn, &pid).unwrap().len(), 1);
    }

    #[test]
    fn list_by_project_contains_multiple_statuses() {
        let conn = setup();
        let pid = project_id(&conn);
        upsert(&conn, &new_task(&pid)).unwrap();

        let mut t2 = new_task(&pid);
        t2.id = "T-002".into();
        t2.status = Some(TaskStatus::Ready);
        upsert(&conn, &t2).unwrap();

        let all = list_by_project(&conn, &pid).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all.iter().filter(|t| t.status == TaskStatus::Backlog).count(), 1);
        assert_eq!(all.iter().filter(|t| t.status == TaskStatus::Ready).count(), 1);
    }

    #[test]
    fn update_status_and_worktree() {
        let conn = setup();
        let pid = project_id(&conn);
        upsert(&conn, &new_task(&pid)).unwrap();

        assert!(update_status(&conn, "T-001", &pid, TaskStatus::InProgress).unwrap());
        let t = get(&conn, "T-001", &pid).unwrap().unwrap();
        assert_eq!(t.status, TaskStatus::InProgress);

        assert!(update_worktree(&conn, "T-001", &pid, Some("/tmp/wt")).unwrap());
        let t = get(&conn, "T-001", &pid).unwrap().unwrap();
        assert_eq!(t.worktree_path.as_deref(), Some("/tmp/wt"));
    }

    #[test]
    fn delete_task() {
        let conn = setup();
        let pid = project_id(&conn);
        upsert(&conn, &new_task(&pid)).unwrap();
        assert!(delete(&conn, "T-001", &pid).unwrap());
        assert!(get(&conn, "T-001", &pid).unwrap().is_none());
    }

    #[test]
    fn cascade_delete_on_project() {
        let conn = setup();
        let pid = project_id(&conn);
        upsert(&conn, &new_task(&pid)).unwrap();
        projects::delete(&conn, &pid).unwrap();
        assert!(get(&conn, "T-001", &pid).unwrap().is_none());
    }
}
