//! Task Activity Logger — stores structured MCP events in the `task_activity` DB table.
//!
//! When an agent reports status, progress, file changes, errors, or completion
//! via MCP tools, this module inserts a structured row into the database.
//! Previously this appended markdown to task files; now it uses the DB for
//! structured, queryable storage.

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::Utc;
use serde_json::json;
use tauri::Manager;

use crate::db;
use crate::db::DbState;
use crate::mcp::server::FileChange;

// ── Types ──

/// Events that can be logged to the task_activity table.
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
    task_id: String,
    project_id: String,
}

/// Global cache: session_id -> SessionInfo
static SESSION_CACHE: std::sync::LazyLock<Mutex<HashMap<String, SessionInfo>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

// ── Public API ──

/// Log an MCP event to the task_activity database table.
///
/// This is fire-and-forget: errors are logged to stderr but never propagated.
/// The function does a blocking DB lookup + write, so it should be called
/// from a context where blocking is acceptable (or wrapped in spawn_blocking).
pub fn log_mcp_event(app: &tauri::AppHandle, session_id: &str, event: TaskLogEvent) {
    if let Err(e) = log_mcp_event_inner(app, session_id, event) {
        tracing::warn!(%e, session_id, "Failed to log MCP event to task_activity table");
    }
}

// ── Internals ──

fn log_mcp_event_inner(
    app: &tauri::AppHandle,
    session_id: &str,
    event: TaskLogEvent,
) -> Result<(), String> {
    let SessionInfo {
        task_id,
        project_id,
    } = resolve_session_info(app, session_id)?;

    let now = Utc::now().to_rfc3339();
    let (event_type, data) = event_to_row(&event);
    let id = db::generate_id("act");

    // Write to DB
    let db_state: tauri::State<'_, DbState> = app
        .try_state()
        .ok_or_else(|| "DB state not available".to_string())?;
    let conn = db_state.lock().map_err(|e| format!("db lock: {e}"))?;

    db::task_activity::insert(
        &conn,
        &id,
        &task_id,
        &project_id,
        Some(session_id),
        event_type,
        &now,
        &data,
    )
    .map_err(|e| format!("db insert: {e}"))?;

    Ok(())
}

/// Resolve the task_id and project_id for a session.
/// Results are cached so subsequent calls for the same session are instant.
fn resolve_session_info(
    app: &tauri::AppHandle,
    session_id: &str,
) -> Result<SessionInfo, String> {
    // Check cache first
    {
        let cache = SESSION_CACHE.lock().map_err(|e| format!("cache lock: {e}"))?;
        if let Some(info) = cache.get(session_id) {
            return Ok(SessionInfo {
                task_id: info.task_id.clone(),
                project_id: info.project_id.clone(),
            });
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
        .ok_or_else(|| "session has no task_id (vibe/shell)".to_string())?;

    let info = SessionInfo {
        task_id: task_id.clone(),
        project_id: session.project_id.clone(),
    };

    // Cache it
    {
        let mut cache = SESSION_CACHE.lock().map_err(|e| format!("cache lock: {e}"))?;
        cache.insert(
            session_id.to_string(),
            SessionInfo {
                task_id,
                project_id: session.project_id,
            },
        );
    }

    Ok(info)
}

/// Convert a TaskLogEvent to an (event_type, data JSON) pair for DB storage.
fn event_to_row(event: &TaskLogEvent) -> (&'static str, serde_json::Value) {
    match event {
        TaskLogEvent::Status {
            status,
            message,
            activity,
        } => (
            "status",
            json!({
                "status": status,
                "message": message,
                "activity": activity,
            }),
        ),
        TaskLogEvent::Progress {
            current_step,
            total_steps,
            description,
        } => (
            "progress",
            json!({
                "current_step": current_step,
                "total_steps": total_steps,
                "description": description,
            }),
        ),
        TaskLogEvent::FilesChanged { files } => (
            "files_changed",
            json!({
                "files": files.iter().map(|f| json!({"path": f.path, "action": f.action})).collect::<Vec<_>>(),
            }),
        ),
        TaskLogEvent::Error { error, details } => (
            "error",
            json!({
                "error": error,
                "details": details,
            }),
        ),
        TaskLogEvent::Waiting { question } => (
            "waiting",
            json!({
                "question": question,
            }),
        ),
        TaskLogEvent::Complete {
            summary,
            files_changed,
        } => (
            "complete",
            json!({
                "summary": summary,
                "files_changed": files_changed,
            }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_to_row_status() {
        let (event_type, data) = event_to_row(&TaskLogEvent::Status {
            status: "working".into(),
            message: "Analyzing codebase".into(),
            activity: Some("researching".into()),
        });
        assert_eq!(event_type, "status");
        assert_eq!(data["status"], "working");
        assert_eq!(data["message"], "Analyzing codebase");
        assert_eq!(data["activity"], "researching");
    }

    #[test]
    fn event_to_row_progress() {
        let (event_type, data) = event_to_row(&TaskLogEvent::Progress {
            current_step: 2,
            total_steps: 5,
            description: "Creating module".into(),
        });
        assert_eq!(event_type, "progress");
        assert_eq!(data["current_step"], 2);
        assert_eq!(data["total_steps"], 5);
    }

    #[test]
    fn event_to_row_files_changed() {
        let (event_type, data) = event_to_row(&TaskLogEvent::FilesChanged {
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
        });
        assert_eq!(event_type, "files_changed");
        let files = data["files"].as_array().unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0]["path"], "src/lib.rs");
    }

    #[test]
    fn event_to_row_error() {
        let (event_type, data) = event_to_row(&TaskLogEvent::Error {
            error: "Build failed".into(),
            details: Some("Missing import".into()),
        });
        assert_eq!(event_type, "error");
        assert_eq!(data["error"], "Build failed");
        assert_eq!(data["details"], "Missing import");
    }

    #[test]
    fn event_to_row_complete() {
        let (event_type, data) = event_to_row(&TaskLogEvent::Complete {
            summary: "Done implementing".into(),
            files_changed: Some(3),
        });
        assert_eq!(event_type, "complete");
        assert_eq!(data["summary"], "Done implementing");
        assert_eq!(data["files_changed"], 3);
    }

    #[test]
    fn event_to_row_waiting() {
        let (event_type, data) = event_to_row(&TaskLogEvent::Waiting {
            question: "Ready to start?".into(),
        });
        assert_eq!(event_type, "waiting");
        assert_eq!(data["question"], "Ready to start?");
    }
}
