use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db;
use crate::db::models::{NewTask, Priority, Task, TaskStatus};
use crate::error::AppError;

// ── Per-project setting helper ──

/// Check whether disk task files are enabled for a project.
/// Defaults to `true` (files ON) when no setting exists.
pub fn task_files_enabled(conn: &Connection, project_id: &str) -> bool {
    crate::db::settings::get_value(conn, "project", Some(project_id), "task_files_to_disk")
        .ok()
        .flatten()
        .map(|v| v != "false")
        .unwrap_or(true)
}

// ── Frontmatter types ──

/// YAML frontmatter parsed from a task file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFrontmatter {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub created: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub github_issue: Option<String>,
    #[serde(default)]
    pub github_pr: Option<String>,
}

/// A parsed task file: frontmatter + markdown body.
#[derive(Debug, Clone)]
pub struct ParsedTaskFile {
    pub frontmatter: TaskFrontmatter,
    pub body: String,
    pub file_path: PathBuf,
}

// ── Frontmatter parsing ──

/// Parse a task markdown file into frontmatter + body.
pub fn parse_task_file(content: &str, file_path: &Path) -> Result<ParsedTaskFile, AppError> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Err(AppError::Validation(format!(
            "Missing YAML frontmatter in {}",
            file_path.display()
        )));
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    let close_pos = after_first.find("\n---").ok_or_else(|| {
        AppError::Validation(format!(
            "Unclosed YAML frontmatter in {}",
            file_path.display()
        ))
    })?;

    let yaml_str = &after_first[..close_pos];
    let body_start = close_pos + 4; // skip \n---
    let body = if body_start < after_first.len() {
        after_first[body_start..].trim_start_matches('\n').to_string()
    } else {
        String::new()
    };

    let frontmatter: TaskFrontmatter = serde_yaml::from_str(yaml_str).map_err(|e| {
        AppError::Validation(format!(
            "Invalid YAML frontmatter in {}: {e}",
            file_path.display()
        ))
    })?;

    Ok(ParsedTaskFile {
        frontmatter,
        body,
        file_path: file_path.to_path_buf(),
    })
}

/// Serialize frontmatter + body back to a task file string.
pub fn serialize_task_file(frontmatter: &TaskFrontmatter, body: &str) -> Result<String, AppError> {
    let yaml = serde_yaml::to_string(frontmatter)
        .map_err(|e| AppError::Validation(format!("Failed to serialize frontmatter: {e}")))?;
    // serde_yaml adds a trailing newline; trim it for clean output
    let yaml = yaml.trim_end();
    let mut out = format!("---\n{yaml}\n---\n");
    if !body.is_empty() {
        out.push('\n');
        out.push_str(body);
        if !body.ends_with('\n') {
            out.push('\n');
        }
    }
    Ok(out)
}

// ── Frontmatter → DB conversion ──

fn parse_status(s: &str) -> TaskStatus {
    s.parse().unwrap_or(TaskStatus::Backlog)
}

fn parse_priority(s: &str) -> Priority {
    s.parse().unwrap_or(Priority::P2)
}

/// Convert a parsed task file into a NewTask for DB upsert.
pub fn to_new_task(parsed: &ParsedTaskFile, project_id: &str) -> NewTask {
    let fm = &parsed.frontmatter;
    NewTask {
        id: fm.id.clone(),
        project_id: project_id.to_string(),
        task_file_path: Some(parsed.file_path.to_string_lossy().into_owned()),
        title: fm.title.clone(),
        status: Some(parse_status(&fm.status)),
        priority: Some(parse_priority(&fm.priority)),
        agent: fm.agent.clone(),
        model: fm.model.clone(),
        branch: fm.branch.clone(),
        worktree_path: None,
        github_issue: fm.github_issue.clone(),
        github_pr: fm.github_pr.clone(),
        depends_on: fm.depends_on.clone(),
        labels: fm.labels.clone(),
        body: parsed.body.clone(),
    }
}

// ── Task scanning ──

/// Scan the tasks directory, parse all .md files, and upsert into the database.
/// Returns the number of tasks synced.
pub fn scan_and_sync(
    conn: &Connection,
    project_id: &str,
    tasks_dir: &Path,
) -> Result<usize, AppError> {
    if !tasks_dir.is_dir() {
        return Ok(0);
    }

    let mut count = 0;
    let entries = std::fs::read_dir(tasks_dir)?;

    // Collect IDs we find on disk so we can remove stale DB entries
    let mut found_ids: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let parsed = match parse_task_file(&content, &path) {
            Ok(p) => p,
            Err(_) => continue, // skip unparseable files
        };
        found_ids.push(parsed.frontmatter.id.clone());
        let mut new_task = to_new_task(&parsed, project_id);
        // Preserve DB-only fields (not stored in task files) from existing record
        if let Ok(Some(existing)) = db::tasks::get(conn, &new_task.id, project_id) {
            new_task.worktree_path = existing.worktree_path;
        }
        db::tasks::upsert(conn, &new_task)?;
        count += 1;
    }

    // Remove tasks from DB that no longer have a file on disk
    let db_tasks = db::tasks::list_by_project(conn, project_id)?;
    for task in &db_tasks {
        // Only remove tasks that had a task_file_path (file-sourced) and are now missing
        if task.task_file_path.is_some() && !found_ids.contains(&task.id) {
            db::tasks::delete(conn, &task.id, project_id)?;
        }
    }

    Ok(count)
}

// ── TODOS.md generation ──

/// Generate TODOS.md content from tasks in the database.
pub fn generate_todos_md(conn: &Connection, project_id: &str) -> Result<String, AppError> {
    let tasks = db::tasks::list_by_project(conn, project_id)?;

    // Group tasks by status
    let mut groups: HashMap<&str, Vec<&Task>> = HashMap::new();
    for task in &tasks {
        let key = task.status.as_str();
        groups.entry(key).or_default().push(task);
    }

    let mut out = String::new();
    out.push_str("<!-- This file is auto-generated by Faber. Do not edit manually. -->\n");
    out.push_str("<!-- Source: .agents/tasks/ -->\n\n");
    out.push_str("# Project Tasks\n");

    // Ordered status sections
    let section_order = [
        ("in-progress", "In Progress"),
        ("in-review", "In Review"),
        ("ready", "Ready"),
        ("backlog", "Backlog"),
        ("done", "Done"),
        ("archived", "Archived"),
    ];

    for (status_key, heading) in &section_order {
        if let Some(tasks) = groups.get(status_key) {
            out.push_str(&format!("\n## {heading}\n"));
            let mut sorted = tasks.clone();
            sorted.sort_by(|a, b| a.id.cmp(&b.id));
            for task in sorted {
                let check = match *status_key {
                    "done" | "archived" => "x",
                    "in-progress" => "~",
                    _ => " ",
                };
                let link = task
                    .task_file_path
                    .as_ref()
                    .map(|p| {
                        // Make path relative to project root
                        let path = Path::new(p);
                        let relative = path
                            .file_name()
                            .map(|f| format!(".agents/tasks/{}", f.to_string_lossy()))
                            .unwrap_or_else(|| p.clone());
                        format!(" → [task]({relative})")
                    })
                    .unwrap_or_default();
                out.push_str(&format!(
                    "- [{check}] **{}** [{}] {}{link}\n",
                    task.id, task.priority, task.title
                ));
            }
        }
    }

    Ok(out)
}

// ── Task creation ──

/// Generate the next task ID from the database (for DB-only mode).
pub fn next_task_id_from_db(conn: &Connection, project_id: &str) -> Result<String, AppError> {
    let max_num: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(CAST(SUBSTR(id, 3) AS INTEGER)), 0) FROM tasks WHERE project_id = ?1",
            rusqlite::params![project_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(format!("T-{:03}", max_num + 1))
}

/// Scan existing task files to find the highest T-XXX number.
pub fn next_task_id(tasks_dir: &Path) -> Result<String, AppError> {
    let mut max_num: u32 = 0;

    if tasks_dir.is_dir() {
        for entry in std::fs::read_dir(tasks_dir)?.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            // Match T-NNN pattern at the start of filename
            if let Some(rest) = name_str.strip_prefix("T-") {
                if let Some(num_str) = rest.split(|c: char| !c.is_ascii_digit()).next() {
                    if let Ok(n) = num_str.parse::<u32>() {
                        max_num = max_num.max(n);
                    }
                }
            }
        }
    }

    Ok(format!("T-{:03}", max_num + 1))
}

/// Slugify a title for use in filenames.
pub fn slugify(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Create a new task file on disk and upsert it into the database.
pub fn create_task_file(
    conn: &Connection,
    project_id: &str,
    tasks_dir: &Path,
    title: &str,
    priority: Option<&str>,
    body: Option<&str>,
) -> Result<Task, AppError> {
    std::fs::create_dir_all(tasks_dir)?;

    let task_id = next_task_id(tasks_dir)?;
    let slug = slugify(title);
    let filename = format!("{task_id}-{slug}.md");
    let file_path = tasks_dir.join(&filename);

    let today = chrono_today();
    let priority_str = priority.unwrap_or("P2");

    let frontmatter = TaskFrontmatter {
        id: task_id.clone(),
        title: title.to_string(),
        status: "backlog".to_string(),
        priority: priority_str.to_string(),
        created: today,
        depends_on: vec![],
        labels: vec![],
        agent: None,
        model: None,
        branch: None,
        github_issue: None,
        github_pr: None,
    };

    let default_body =
        "## Objective\n\n\n\n## Acceptance Criteria\n\n- [ ] \n\n## Implementation Plan\n\n1. \n".to_string();
    let body_content = body.unwrap_or(&default_body);

    let content = serialize_task_file(&frontmatter, body_content)?;
    std::fs::write(&file_path, &content)?;

    // Upsert into DB
    let parsed = parse_task_file(&content, &file_path)?;
    let new_task = to_new_task(&parsed, project_id);
    let task = db::tasks::upsert(conn, &new_task)?;

    Ok(task)
}

fn chrono_today() -> String {
    // Simple date without pulling in chrono crate
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = now / 86400;
    // Calculate year-month-day from days since epoch
    // Using a simple civil calendar algorithm
    let (y, m, d) = days_to_civil(days as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Convert days since 1970-01-01 to (year, month, day).
fn days_to_civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ── Update frontmatter in file ──

/// Update a single frontmatter field in a task file on disk.
/// Reads the file, patches the frontmatter, and writes it back.
pub fn update_task_file_field(
    file_path: &Path,
    field: &str,
    value: &str,
) -> Result<(), AppError> {
    let content = std::fs::read_to_string(file_path)?;
    let mut parsed = parse_task_file(&content, file_path)?;

    match field {
        "status" => parsed.frontmatter.status = value.to_string(),
        "priority" => parsed.frontmatter.priority = value.to_string(),
        "title" => parsed.frontmatter.title = value.to_string(),
        "agent" => parsed.frontmatter.agent = Some(value.to_string()),
        "model" => parsed.frontmatter.model = Some(value.to_string()),
        "branch" => parsed.frontmatter.branch = Some(value.to_string()),
        "github_pr" => parsed.frontmatter.github_pr = Some(value.to_string()),
        _ => {
            return Err(AppError::Validation(format!(
                "Unknown frontmatter field: {field}"
            )));
        }
    }

    let new_content = serialize_task_file(&parsed.frontmatter, &parsed.body)?;
    std::fs::write(file_path, new_content)?;
    Ok(())
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn sample_task_content() -> &'static str {
        "---\n\
         id: T-001\n\
         title: Test task\n\
         status: ready\n\
         priority: P0\n\
         created: 2026-01-01\n\
         labels: [backend, core]\n\
         depends_on: [T-000]\n\
         ---\n\
         \n\
         ## Objective\n\
         \n\
         Do the thing.\n"
    }

    fn setup_db() -> Connection {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        db::projects::create(
            &conn,
            &crate::db::models::NewProject {
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
        db::projects::list(conn).unwrap()[0].id.clone()
    }

    // ── Parsing ──

    #[test]
    fn parse_valid_task_file() {
        let parsed = parse_task_file(sample_task_content(), Path::new("test.md")).unwrap();
        assert_eq!(parsed.frontmatter.id, "T-001");
        assert_eq!(parsed.frontmatter.title, "Test task");
        assert_eq!(parsed.frontmatter.status, "ready");
        assert_eq!(parsed.frontmatter.priority, "P0");
        assert_eq!(parsed.frontmatter.labels, vec!["backend", "core"]);
        assert_eq!(parsed.frontmatter.depends_on, vec!["T-000"]);
        assert!(parsed.body.contains("## Objective"));
        assert!(parsed.body.contains("Do the thing."));
    }

    #[test]
    fn parse_missing_frontmatter() {
        let result = parse_task_file("No frontmatter here", Path::new("bad.md"));
        assert!(result.is_err());
    }

    #[test]
    fn parse_unclosed_frontmatter() {
        let result = parse_task_file("---\nid: T-001\ntitle: x\n", Path::new("bad.md"));
        assert!(result.is_err());
    }

    #[test]
    fn parse_optional_fields_default() {
        let content = "---\n\
                        id: T-001\n\
                        title: Minimal\n\
                        status: backlog\n\
                        priority: P2\n\
                        created: 2026-01-01\n\
                        ---\n";
        let parsed = parse_task_file(content, Path::new("min.md")).unwrap();
        assert!(parsed.frontmatter.agent.is_none());
        assert!(parsed.frontmatter.labels.is_empty());
        assert!(parsed.frontmatter.depends_on.is_empty());
    }

    // ── Serialization roundtrip ──

    #[test]
    fn serialize_roundtrip() {
        let parsed = parse_task_file(sample_task_content(), Path::new("test.md")).unwrap();
        let serialized = serialize_task_file(&parsed.frontmatter, &parsed.body).unwrap();
        let reparsed = parse_task_file(&serialized, Path::new("test.md")).unwrap();
        assert_eq!(reparsed.frontmatter.id, "T-001");
        assert_eq!(reparsed.frontmatter.title, "Test task");
        assert!(reparsed.body.contains("Do the thing."));
    }

    // ── Scanning ──

    #[test]
    fn scan_and_sync_upserts_tasks() {
        let conn = setup_db();
        let pid = project_id(&conn);
        let tmp = TempDir::new().unwrap();
        let tasks_dir = tmp.path().join("tasks");
        fs::create_dir(&tasks_dir).unwrap();

        fs::write(tasks_dir.join("T-001-test.md"), sample_task_content()).unwrap();

        let count = scan_and_sync(&conn, &pid, &tasks_dir).unwrap();
        assert_eq!(count, 1);

        let tasks = db::tasks::list_by_project(&conn, &pid).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "T-001");
        assert_eq!(tasks[0].status, TaskStatus::Ready);
    }

    #[test]
    fn scan_removes_stale_db_entries() {
        let conn = setup_db();
        let pid = project_id(&conn);
        let tmp = TempDir::new().unwrap();
        let tasks_dir = tmp.path().join("tasks");
        fs::create_dir(&tasks_dir).unwrap();

        // Sync a file
        fs::write(tasks_dir.join("T-001-test.md"), sample_task_content()).unwrap();
        scan_and_sync(&conn, &pid, &tasks_dir).unwrap();
        assert_eq!(db::tasks::list_by_project(&conn, &pid).unwrap().len(), 1);

        // Remove the file and re-scan
        fs::remove_file(tasks_dir.join("T-001-test.md")).unwrap();
        scan_and_sync(&conn, &pid, &tasks_dir).unwrap();
        assert_eq!(db::tasks::list_by_project(&conn, &pid).unwrap().len(), 0);
    }

    #[test]
    fn scan_nonexistent_dir_returns_zero() {
        let conn = setup_db();
        let pid = project_id(&conn);
        let count = scan_and_sync(&conn, &pid, Path::new("/nonexistent")).unwrap();
        assert_eq!(count, 0);
    }

    // ── TODOS.md generation ──

    #[test]
    fn generate_todos_md_format() {
        let conn = setup_db();
        let pid = project_id(&conn);

        // Insert some tasks
        db::tasks::upsert(
            &conn,
            &NewTask {
                id: "T-001".into(),
                project_id: pid.clone(),
                task_file_path: Some(".agents/tasks/T-001-foo.md".into()),
                title: "Do foo".into(),
                status: Some(TaskStatus::Ready),
                priority: Some(Priority::P0),
                agent: None,
                model: None,
                branch: None,
                worktree_path: None,
                github_issue: None,
                github_pr: None,
                depends_on: vec![],
                labels: vec![],
                body: String::new(),
            },
        )
        .unwrap();
        db::tasks::upsert(
            &conn,
            &NewTask {
                id: "T-002".into(),
                project_id: pid.clone(),
                task_file_path: Some(".agents/tasks/T-002-bar.md".into()),
                title: "Do bar".into(),
                status: Some(TaskStatus::Done),
                priority: Some(Priority::P1),
                agent: None,
                model: None,
                branch: None,
                worktree_path: None,
                github_issue: None,
                github_pr: None,
                depends_on: vec![],
                labels: vec![],
                body: String::new(),
            },
        )
        .unwrap();

        let content = generate_todos_md(&conn, &pid).unwrap();
        assert!(content.contains("auto-generated by Faber"));
        assert!(content.contains("## Ready"));
        assert!(content.contains("**T-001** [P0] Do foo"));
        assert!(content.contains("## Done"));
        assert!(content.contains("[x] **T-002**"));
    }

    // ── Task creation ──

    #[test]
    fn next_task_id_increments() {
        let tmp = TempDir::new().unwrap();
        let tasks_dir = tmp.path();

        assert_eq!(next_task_id(tasks_dir).unwrap(), "T-001");

        fs::write(tasks_dir.join("T-001-foo.md"), "").unwrap();
        assert_eq!(next_task_id(tasks_dir).unwrap(), "T-002");

        fs::write(tasks_dir.join("T-015-bar.md"), "").unwrap();
        assert_eq!(next_task_id(tasks_dir).unwrap(), "T-016");
    }

    #[test]
    fn next_task_id_nonexistent_dir() {
        assert_eq!(
            next_task_id(Path::new("/nonexistent")).unwrap(),
            "T-001"
        );
    }

    #[test]
    fn slugify_works() {
        assert_eq!(slugify("Fix Auth Bug"), "fix-auth-bug");
        assert_eq!(slugify("Add --verbose flag"), "add-verbose-flag");
        assert_eq!(slugify("  spaces  "), "spaces");
        assert_eq!(slugify("CamelCase"), "camelcase");
    }

    #[test]
    fn create_task_file_on_disk() {
        let conn = setup_db();
        let pid = project_id(&conn);
        let tmp = TempDir::new().unwrap();
        let tasks_dir = tmp.path().join("tasks");

        let task = create_task_file(&conn, &pid, &tasks_dir, "My new task", Some("P1"), None).unwrap();

        assert_eq!(task.id, "T-001");
        assert_eq!(task.title, "My new task");
        assert_eq!(task.priority, Priority::P1);
        assert_eq!(task.status, TaskStatus::Backlog);

        // Verify file on disk
        let file_path = tasks_dir.join("T-001-my-new-task.md");
        assert!(file_path.exists());
        let content = fs::read_to_string(&file_path).unwrap();
        assert!(content.contains("id: T-001"));
        assert!(content.contains("title: My new task"));
        assert!(content.contains("## Objective"));
    }

    #[test]
    fn create_task_file_with_body() {
        let conn = setup_db();
        let pid = project_id(&conn);
        let tmp = TempDir::new().unwrap();
        let tasks_dir = tmp.path().join("tasks");

        let body = "## Objective\n\nCustom body content.\n";
        create_task_file(&conn, &pid, &tasks_dir, "Custom", None, Some(body)).unwrap();

        let file_path = tasks_dir.join("T-001-custom.md");
        let content = fs::read_to_string(&file_path).unwrap();
        assert!(content.contains("Custom body content."));
    }

    // ── Update frontmatter ──

    #[test]
    fn update_task_file_field_status() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("T-001-test.md");
        fs::write(&file, sample_task_content()).unwrap();

        update_task_file_field(&file, "status", "in-progress").unwrap();

        let content = fs::read_to_string(&file).unwrap();
        let parsed = parse_task_file(&content, &file).unwrap();
        assert_eq!(parsed.frontmatter.status, "in-progress");
        // Body should be preserved
        assert!(parsed.body.contains("Do the thing."));
    }

    #[test]
    fn update_task_file_field_unknown_field() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("T-001-test.md");
        fs::write(&file, sample_task_content()).unwrap();

        let result = update_task_file_field(&file, "unknown", "value");
        assert!(result.is_err());
    }

    // ── Date utility ──

    #[test]
    fn chrono_today_format() {
        let today = chrono_today();
        // Should be YYYY-MM-DD format
        assert_eq!(today.len(), 10);
        assert_eq!(today.as_bytes()[4], b'-');
        assert_eq!(today.as_bytes()[7], b'-');
    }
}
