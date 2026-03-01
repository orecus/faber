//! Task Log/History — appends agent MCP activity to the task's `.md` file.
//!
//! When an agent reports status, progress, file changes, errors, or completion
//! via MCP tools, this module appends a nicely formatted log entry under an
//! `## Agent History` section in the task markdown file.
//!
//! Entries are grouped per-session with a mode-based header like:
//! `### Implementation (claude-code) — 2026-02-24 14:30`

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::Local;
use tauri::Manager;

use crate::db;
use crate::db::models::SessionMode;
use crate::db::DbState;
use crate::mcp::server::FileChange;

// ── Types ──

/// Events that can be logged to a task file.
pub enum TaskLogEvent {
    Status {
        status: String,
        message: String,
        activity: Option<String>,
    },
    Progress {
        current_step: u32,
        total_steps: u32,
        description: String,
    },
    FilesChanged {
        files: Vec<FileChange>,
    },
    Error {
        error: String,
        details: Option<String>,
    },
    Waiting {
        question: String,
    },
    Complete {
        summary: String,
        files_changed: Option<u32>,
    },
}

/// Cached session metadata to avoid repeated DB lookups.
struct SessionInfo {
    task_file_path: String,
    header_line: String,
}

/// Global cache: session_id -> SessionInfo
static SESSION_CACHE: std::sync::LazyLock<Mutex<HashMap<String, SessionInfo>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

// ── Public API ──

/// Log an MCP event to the task's markdown file.
///
/// This is fire-and-forget: errors are logged to stderr but never propagated.
/// The function does a blocking DB lookup + file I/O, so it should be called
/// from a context where blocking is acceptable (or wrapped in spawn_blocking).
pub fn log_mcp_event(app: &tauri::AppHandle, session_id: &str, event: TaskLogEvent) {
    if let Err(e) = log_mcp_event_inner(app, session_id, event) {
        tracing::warn!(%e, session_id, "Failed to log MCP event to task file");
    }
}

// ── Internals ──

fn log_mcp_event_inner(
    app: &tauri::AppHandle,
    session_id: &str,
    event: TaskLogEvent,
) -> Result<(), String> {
    let (task_file_path, header_line) = resolve_session_info(app, session_id)?;

    let now = Local::now();
    let time_str = now.format("%H:%M").to_string();
    let entry = format_entry(&time_str, &event);

    append_to_task_file(&task_file_path, &header_line, &entry)
}

/// Resolve the task file path and session header for a session.
/// Results are cached so subsequent calls for the same session are instant.
fn resolve_session_info(
    app: &tauri::AppHandle,
    session_id: &str,
) -> Result<(String, String), String> {
    // Check cache first
    {
        let cache = SESSION_CACHE.lock().map_err(|e| format!("cache lock: {e}"))?;
        if let Some(info) = cache.get(session_id) {
            return Ok((info.task_file_path.clone(), info.header_line.clone()));
        }
    }

    // DB lookup
    let db_state: tauri::State<'_, DbState> = app
        .try_state()
        .ok_or_else(|| "DB state not available".to_string())?;
    let conn = db_state.lock().map_err(|e| format!("db lock: {e}"))?;

    let session = db::sessions::get(&conn, session_id)
        .map_err(|e| format!("db query: {e}"))?
        .ok_or_else(|| format!("session {session_id} not found"))?;

    let task_id = session
        .task_id
        .as_deref()
        .ok_or_else(|| "session has no task_id (vibe/shell)".to_string())?;

    let task = db::tasks::get(&conn, task_id, &session.project_id)
        .map_err(|e| format!("db query: {e}"))?
        .ok_or_else(|| format!("task {task_id} not found"))?;

    let task_file_path = task
        .task_file_path
        .ok_or_else(|| format!("task {task_id} has no file path"))?;

    // Build the session header
    let mode_display = friendly_mode_name(&session.mode);
    let now = Local::now();
    let date_str = now.format("%Y-%m-%d %H:%M").to_string();
    let header_line = format!("### {mode_display} ({}) \u{2014} {date_str}", session.agent);

    // Cache it
    {
        let mut cache = SESSION_CACHE.lock().map_err(|e| format!("cache lock: {e}"))?;
        cache.insert(
            session_id.to_string(),
            SessionInfo {
                task_file_path: task_file_path.clone(),
                header_line: header_line.clone(),
            },
        );
    }

    Ok((task_file_path, header_line))
}

/// Map SessionMode to a friendly display name.
fn friendly_mode_name(mode: &SessionMode) -> &'static str {
    match mode {
        SessionMode::Task => "Implementation",
        SessionMode::Research => "Research",
        SessionMode::Vibe => "Vibe",
        SessionMode::Shell => "Shell",
    }
}

/// Format a log entry line from an MCP event.
fn format_entry(time: &str, event: &TaskLogEvent) -> String {
    match event {
        TaskLogEvent::Status { status, message, activity } => {
            let emoji = match activity.as_deref() {
                Some("researching" | "exploring") => "\u{1f50d}", // 🔍
                Some("planning") => "\u{1f4cb}",                  // 📋
                Some("testing") => "\u{1f9ea}",                   // 🧪
                Some("coding") => "\u{1f4bb}",                    // 💻
                Some("debugging") => "\u{1f41b}",                 // 🐛
                Some("reviewing") => "\u{1f441}",                 // 👁
                _ => match status.as_str() {
                    "working" => "\u{1f504}",                     // 🔄
                    "idle" => "\u{1f634}",                        // 😴
                    "waiting" => "\u{23f3}",                      // ⏳
                    "finished" => "\u{2705}",                     // ✅
                    "error" => "\u{274c}",                        // ❌
                    _ => "\u{1f4cb}",                             // 📋
                },
            };
            let label = activity.as_deref().unwrap_or(status.as_str());
            if message.is_empty() {
                format!("- **{time}** {emoji} Status: *{label}*")
            } else {
                format!("- **{time}** {emoji} Status: *{label}* \u{2014} {message}")
            }
        }
        TaskLogEvent::Progress {
            current_step,
            total_steps,
            description,
        } => {
            format!(
                "- **{time}** \u{1f4ca} Progress: Step {current_step}/{total_steps} \u{2014} {description}"
            )
        }
        TaskLogEvent::FilesChanged { files } => {
            let file_list: Vec<String> = files
                .iter()
                .map(|f| format!("`{}` ({})", f.path, f.action))
                .collect();
            format!(
                "- **{time}** \u{1f4c1} Files changed: {}",
                file_list.join(", ")
            )
        }
        TaskLogEvent::Error { error, details } => {
            if let Some(d) = details {
                format!("- **{time}** \u{26a0}\u{fe0f} Error: {error} \u{2014} {d}")
            } else {
                format!("- **{time}** \u{26a0}\u{fe0f} Error: {error}")
            }
        }
        TaskLogEvent::Waiting { question } => {
            format!("- **{time}** \u{23f3} Waiting: {question}")
        }
        TaskLogEvent::Complete {
            summary,
            files_changed,
        } => {
            if let Some(n) = files_changed {
                format!(
                    "- **{time}** \u{2705} Complete: {summary} ({n} files changed)"
                )
            } else {
                format!("- **{time}** \u{2705} Complete: {summary}")
            }
        }
    }
}

/// Append a log entry to the task file under the `## Agent History` section.
///
/// Strategy:
/// 1. Read the file
/// 2. Find `## Agent History` — if missing, append it at the end
/// 3. Find the session's header — if missing, append it after `## Agent History`
/// 4. Append the entry after the session header (at the end of that section)
/// 5. Write the file back
fn append_to_task_file(
    task_file_path: &str,
    session_header: &str,
    entry: &str,
) -> Result<(), String> {
    let content =
        std::fs::read_to_string(task_file_path).map_err(|e| format!("read file: {e}"))?;

    let mut lines: Vec<String> = content.lines().map(String::from).collect();

    // Find the `## Agent History` section
    let history_idx = lines.iter().position(|l| l.trim() == "## Agent History");

    let history_start = if let Some(idx) = history_idx {
        idx
    } else {
        // Append the section at the end
        // Ensure there's a blank line before the new section
        if lines.last().is_some_and(|l| !l.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push("## Agent History".to_string());
        lines.push(String::new());
        lines.len() - 2 // index of "## Agent History"
    };

    // Find the session header within the Agent History section
    let session_header_idx = lines[history_start..]
        .iter()
        .position(|l| l.trim() == session_header.trim())
        .map(|i| i + history_start);

    if let Some(header_idx) = session_header_idx {
        // Find the end of this session's entries (next ### header or ## header or EOF)
        let insert_idx = find_section_end(&lines, header_idx + 1);
        lines.insert(insert_idx, entry.to_string());
    } else {
        // Create a new session header — find where to insert it
        // (at the end of the Agent History section, before the next ## header)
        let insert_idx = find_section_end(&lines, history_start + 1);

        // Ensure blank line before the new session header
        if insert_idx > 0
            && lines
                .get(insert_idx - 1)
                .is_some_and(|l| !l.trim().is_empty())
        {
            lines.insert(insert_idx, String::new());
            let insert_idx = insert_idx + 1;
            lines.insert(insert_idx, session_header.to_string());
            lines.insert(insert_idx + 1, String::new());
            lines.insert(insert_idx + 2, entry.to_string());
        } else {
            lines.insert(insert_idx, session_header.to_string());
            lines.insert(insert_idx + 1, String::new());
            lines.insert(insert_idx + 2, entry.to_string());
        }
    }

    // Write back — ensure trailing newline
    let mut output = lines.join("\n");
    if !output.ends_with('\n') {
        output.push('\n');
    }

    std::fs::write(task_file_path, output).map_err(|e| format!("write file: {e}"))?;
    Ok(())
}

/// Find the end of a section: the line index where a new `##` or `###` header
/// starts, or the end of the file. Skips the first line (which is the current header).
fn find_section_end(lines: &[String], start: usize) -> usize {
    for (i, line) in lines[start..].iter().enumerate() {
        let trimmed = line.trim();
        // Stop at next ## header (but not ### within Agent History)
        if trimmed.starts_with("## ") && trimmed != "## Agent History" {
            return start + i;
        }
    }
    lines.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_status_entry() {
        let entry = format_entry(
            "14:30",
            &TaskLogEvent::Status {
                status: "working".into(),
                message: "Analyzing codebase".into(),
                activity: None,
            },
        );
        assert!(entry.contains("**14:30**"));
        assert!(entry.contains("*working*"));
        assert!(entry.contains("Analyzing codebase"));
    }

    #[test]
    fn format_progress_entry() {
        let entry = format_entry(
            "14:31",
            &TaskLogEvent::Progress {
                current_step: 2,
                total_steps: 5,
                description: "Creating module".into(),
            },
        );
        assert!(entry.contains("Step 2/5"));
        assert!(entry.contains("Creating module"));
    }

    #[test]
    fn format_files_changed_entry() {
        let entry = format_entry(
            "14:32",
            &TaskLogEvent::FilesChanged {
                files: vec![
                    FileChange {
                        path: "src/lib.rs".into(),
                        action: "modified".into(),
                    },
                    FileChange {
                        path: "src/new.rs".into(),
                        action: "created".into(),
                    },
                ],
            },
        );
        assert!(entry.contains("`src/lib.rs` (modified)"));
        assert!(entry.contains("`src/new.rs` (created)"));
    }

    #[test]
    fn format_error_entry() {
        let entry = format_entry(
            "14:33",
            &TaskLogEvent::Error {
                error: "Build failed".into(),
                details: Some("Missing import".into()),
            },
        );
        assert!(entry.contains("Build failed"));
        assert!(entry.contains("Missing import"));
    }

    #[test]
    fn format_complete_entry() {
        let entry = format_entry(
            "14:40",
            &TaskLogEvent::Complete {
                summary: "Done implementing".into(),
                files_changed: Some(3),
            },
        );
        assert!(entry.contains("Done implementing"));
        assert!(entry.contains("3 files changed"));
    }

    #[test]
    fn append_creates_history_section() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("task.md");
        std::fs::write(
            &path,
            "---\nid: T-001\n---\n\n## Objective\n\nDo something\n",
        )
        .unwrap();

        append_to_task_file(
            path.to_str().unwrap(),
            "### Implementation (claude-code) \u{2014} 2026-02-24 14:30",
            "- **14:30** \u{1f504} Status: *working* \u{2014} Starting",
        )
        .unwrap();

        let result = std::fs::read_to_string(&path).unwrap();
        assert!(result.contains("## Agent History"));
        assert!(result.contains("### Implementation (claude-code)"));
        assert!(result.contains("Status: *working*"));
    }

    #[test]
    fn append_reuses_existing_section() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("task.md");
        let header = "### Implementation (claude-code) \u{2014} 2026-02-24 14:30";
        std::fs::write(
            &path,
            format!(
                "---\nid: T-001\n---\n\n## Agent History\n\n{header}\n\n- **14:30** first entry\n"
            ),
        )
        .unwrap();

        append_to_task_file(
            path.to_str().unwrap(),
            header,
            "- **14:31** second entry",
        )
        .unwrap();

        let result = std::fs::read_to_string(&path).unwrap();
        assert!(result.contains("first entry"));
        assert!(result.contains("second entry"));
        // Should only have one Agent History section
        assert_eq!(result.matches("## Agent History").count(), 1);
        // Should only have one session header
        assert_eq!(result.matches("### Implementation").count(), 1);
    }

    #[test]
    fn append_adds_new_session_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("task.md");
        let header1 = "### Research (claude-code) \u{2014} 2026-02-24 13:00";
        std::fs::write(
            &path,
            format!(
                "---\nid: T-001\n---\n\n## Agent History\n\n{header1}\n\n- **13:00** research entry\n"
            ),
        )
        .unwrap();

        let header2 = "### Implementation (claude-code) \u{2014} 2026-02-24 14:30";
        append_to_task_file(
            path.to_str().unwrap(),
            header2,
            "- **14:30** impl entry",
        )
        .unwrap();

        let result = std::fs::read_to_string(&path).unwrap();
        assert!(result.contains("### Research"));
        assert!(result.contains("### Implementation"));
        assert!(result.contains("research entry"));
        assert!(result.contains("impl entry"));
    }

    #[test]
    fn friendly_mode_names() {
        assert_eq!(friendly_mode_name(&SessionMode::Task), "Implementation");
        assert_eq!(friendly_mode_name(&SessionMode::Research), "Research");
        assert_eq!(friendly_mode_name(&SessionMode::Vibe), "Vibe");
        assert_eq!(friendly_mode_name(&SessionMode::Shell), "Shell");
    }
}
