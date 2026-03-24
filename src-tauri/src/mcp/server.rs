use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex as TokioMutex;
use tauri::{AppHandle, Emitter, Manager};

use super::protocol::*;
use super::tools;
use crate::commands::tasks::do_update_task_status;
use crate::continuous::{self, ContinuousState};
use crate::db;
use crate::db::DbState;
use crate::db::models::TaskStatus;
use crate::error::AppError;
use crate::session;
use crate::task_logger::{self, TaskLogEvent};

// ── MCP state ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub action: String,
}

#[derive(Default)]
pub struct McpSessionData {
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub session_mode: Option<String>,
    pub status: String,
    pub message: String,
    pub current_step: Option<u32>,
    pub total_steps: Option<u32>,
    pub step_description: Option<String>,
    pub files_changed: Vec<FileChange>,
    pub waiting: bool,
    pub waiting_question: Option<String>,
    pub completed: bool,
    pub completion_summary: Option<String>,
    pub activity: Option<String>,
}

pub struct McpState {
    pub port: u16,
    pub secret: String,
    pub sessions: HashMap<String, McpSessionData>,
}

/// Shared state for the axum router.
struct RouterState {
    mcp: Arc<TokioMutex<McpState>>,
    app_handle: AppHandle,
    /// Pre-shared secret for authenticating MCP requests.
    secret: String,
}

// ── Event payloads ──

#[derive(Clone, Serialize)]
struct McpStatusEvent {
    session_id: String,
    status: String,
    message: String,
    activity: Option<String>,
    project_id: Option<String>,
}

#[derive(Clone, Serialize)]
struct McpProgressEvent {
    session_id: String,
    current_step: u32,
    total_steps: u32,
    description: String,
}

#[derive(Clone, Serialize)]
struct McpFilesChangedEvent {
    session_id: String,
    files: Vec<FileChange>,
}

#[derive(Clone, Serialize)]
struct McpErrorEvent {
    session_id: String,
    error: String,
    details: Option<String>,
    project_id: Option<String>,
}

#[derive(Clone, Serialize)]
struct McpWaitingEvent {
    session_id: String,
    question: String,
    project_id: Option<String>,
}

#[derive(Clone, Serialize)]
struct McpCompleteEvent {
    session_id: String,
    summary: String,
    files_changed: Option<u32>,
    project_id: Option<String>,
}

// ── Server startup ──

/// Generate a cryptographically random 32-byte hex secret for MCP auth.
fn generate_mcp_secret() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    hex::encode(bytes)
}

pub async fn start_mcp_server(
    app_handle: AppHandle,
) -> Result<Arc<TokioMutex<McpState>>, AppError> {
    let secret = generate_mcp_secret();

    let mcp_state = Arc::new(TokioMutex::new(McpState {
        port: 0,
        secret: secret.clone(),
        sessions: HashMap::new(),
    }));

    let state = Arc::new(RouterState {
        mcp: Arc::clone(&mcp_state),
        app_handle,
        secret: secret.clone(),
    });

    let app = Router::new()
        .route("/session/{session_id}/mcp", post(handle_mcp_request))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Io(format!("Failed to bind MCP server: {e}")))?;

    let addr: SocketAddr = listener
        .local_addr()
        .map_err(|e| AppError::Io(format!("Failed to get MCP server address: {e}")))?;

    let port = addr.port();
    {
        let mut guard = mcp_state.lock().await;
        guard.port = port;
    }

    tracing::info!(port, "MCP server listening on 127.0.0.1");

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!(%e, "MCP server error");
        }
    });

    Ok(mcp_state)
}

// ── Request handler ──

async fn handle_mcp_request(
    AxumPath(session_id): AxumPath<String>,
    AxumState(state): AxumState<Arc<RouterState>>,
    headers: HeaderMap,
    Json(req): Json<JsonRpcRequest>,
) -> Result<Json<JsonRpcResponse>, StatusCode> {
    // Authenticate: require Bearer token matching our pre-shared secret
    let authorized = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|token| token == state.secret);

    if !authorized {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(handle_mcp_request_inner(session_id, state, req).await)
}

async fn handle_mcp_request_inner(
    session_id: String,
    state: Arc<RouterState>,
    req: JsonRpcRequest,
) -> Json<JsonRpcResponse> {
    let response = match req.method.as_str() {
        "initialize" => {
            let result = McpInitializeResult {
                protocol_version: "2025-03-26".into(),
                capabilities: McpCapabilities {
                    tools: McpToolsCapability {
                        list_changed: false,
                    },
                },
                server_info: McpServerInfo {
                    name: "faber".into(),
                    version: env!("CARGO_PKG_VERSION").into(),
                },
            };
            JsonRpcResponse::success(req.id, serde_json::to_value(result).unwrap())
        }

        "notifications/initialized" => {
            // Notification — no response needed, but axum needs something.
            // Return a minimal success so the HTTP layer is happy.
            JsonRpcResponse::success(req.id, Value::Null)
        }

        "tools/list" => {
            // Filter tools based on session mode — vibe/chat sessions don't need task tools
            let session_mode = {
                let guard = state.mcp.lock().await;
                guard.sessions.get(&session_id)
                    .and_then(|d| d.session_mode.clone())
            };
            let result = McpToolsListResult {
                tools: tools::tools_for_mode(session_mode.as_deref()),
            };
            JsonRpcResponse::success(req.id, serde_json::to_value(result).unwrap())
        }

        "tools/call" => {
            let params: McpToolCallParams = match serde_json::from_value(req.params) {
                Ok(p) => p,
                Err(e) => {
                    return Json(JsonRpcResponse::error(
                        req.id,
                        INVALID_PARAMS,
                        format!("Invalid tool call params: {e}"),
                    ));
                }
            };
            let tool_result =
                handle_tool_call(&session_id, &params, &state.mcp, &state.app_handle).await;
            JsonRpcResponse::success(req.id, serde_json::to_value(tool_result).unwrap())
        }

        _ => JsonRpcResponse::error(
            req.id,
            METHOD_NOT_FOUND,
            format!("Unknown method: {}", req.method),
        ),
    };

    Json(response)
}

// ── Tool dispatch ──

async fn handle_tool_call(
    session_id: &str,
    params: &McpToolCallParams,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    match params.name.as_str() {
        "report_status" => handle_report_status(session_id, &params.arguments, mcp, app).await,
        "report_progress" => {
            handle_report_progress(session_id, &params.arguments, mcp, app).await
        }
        "report_files_changed" => {
            handle_report_files_changed(session_id, &params.arguments, mcp, app).await
        }
        "report_waiting" => {
            handle_report_waiting(session_id, &params.arguments, mcp, app).await
        }
        "report_error" => handle_report_error(session_id, &params.arguments, mcp, app).await,
        "report_complete" => {
            handle_report_complete(session_id, &params.arguments, mcp, app).await
        }
        "report_researched" => {
            handle_report_researched(session_id, &params.arguments, mcp, app).await
        }
        "get_task" => handle_get_task(session_id, &params.arguments, mcp, app).await,
        "update_task_plan" => {
            handle_update_task_plan(session_id, &params.arguments, mcp, app).await
        }
        "update_task" => handle_update_task(session_id, &params.arguments, mcp, app).await,
        "list_tasks" => handle_list_tasks(session_id, &params.arguments, mcp, app).await,
        "create_task" => handle_create_task(session_id, &params.arguments, mcp, app).await,
        _ => McpToolResult::error(format!("Unknown tool: {}", params.name)),
    }
}

// ── Helpers ──

/// Look up the project_id for a given session. Returns None if the DB
/// lookup fails — callers should not break the MCP flow over this.
fn get_session_project_id(app: &AppHandle, session_id: &str) -> Option<String> {
    let db: tauri::State<'_, DbState> = app.state();
    let conn = db.lock().ok()?;
    let session = db::sessions::get(&conn, session_id).ok()??;
    Some(session.project_id)
}

// ── Tool handlers ──

async fn handle_report_status(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    let status = args
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("working");
    let message = args
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let activity = args
        .get("activity")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    {
        let mut guard = mcp.lock().await;
        if let Some(data) = guard.sessions.get_mut(session_id) {
            data.status = status.to_string();
            data.message = message.to_string();
            // Update activity when working; clear when idle/waiting
            if status == "working" {
                data.activity = activity.clone();
                data.completed = false;
                data.completion_summary = None;
            } else {
                data.activity = None;
            }
            // Clear waiting state when agent reports a non-waiting status
            if status != "waiting" {
                data.waiting = false;
                data.waiting_question = None;
            }
        }
    }

    let project_id = get_session_project_id(app, session_id);

    let _ = app.emit(
        "mcp-status-update",
        McpStatusEvent {
            session_id: session_id.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            activity: activity.clone(),
            project_id,
        },
    );

    // Log to task file (fire-and-forget)
    let app_clone = app.clone();
    let sid = session_id.to_string();
    let log_status = status.to_string();
    let log_message = message.to_string();
    let log_activity = activity.clone();
    std::thread::spawn(move || {
        task_logger::log_mcp_event(
            &app_clone,
            &sid,
            TaskLogEvent::Status {
                status: log_status,
                message: log_message,
                activity: log_activity,
            },
        );
    });

    McpToolResult::text(format!("Status updated: {status}"))
}

async fn handle_report_progress(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    let current_step = args
        .get("current_step")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let total_steps = args
        .get("total_steps")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let description = args
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let was_inactive = {
        let mut guard = mcp.lock().await;
        if let Some(data) = guard.sessions.get_mut(session_id) {
            let was = data.completed || data.waiting || data.status == "done";
            data.current_step = Some(current_step);
            data.total_steps = Some(total_steps);
            data.step_description = Some(description.to_string());
            // If the agent is reporting progress, it's actively working —
            // clear any stale completed/waiting state.
            if data.status != "working" {
                data.status = "working".to_string();
            }
            data.completed = false;
            data.completion_summary = None;
            data.waiting = false;
            data.waiting_question = None;
            was
        } else {
            false
        }
    };

    // Emit a status update first so the frontend knows the agent is working again
    if was_inactive {
        let project_id = get_session_project_id(app, session_id);
        let _ = app.emit(
            "mcp-status-update",
            McpStatusEvent {
                session_id: session_id.to_string(),
                status: "working".to_string(),
                message: description.to_string(),
                activity: None,
                project_id,
            },
        );
    }

    let _ = app.emit(
        "mcp-progress-update",
        McpProgressEvent {
            session_id: session_id.to_string(),
            current_step,
            total_steps,
            description: description.to_string(),
        },
    );

    // Log to task file (fire-and-forget)
    let app_clone = app.clone();
    let sid = session_id.to_string();
    let log_desc = description.to_string();
    std::thread::spawn(move || {
        task_logger::log_mcp_event(
            &app_clone,
            &sid,
            TaskLogEvent::Progress {
                current_step,
                total_steps,
                description: log_desc,
            },
        );
    });

    McpToolResult::text(format!("Progress: step {current_step}/{total_steps}"))
}

async fn handle_report_files_changed(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    let files: Vec<FileChange> = args
        .get("files")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let count = files.len();

    let was_inactive = {
        let mut guard = mcp.lock().await;
        if let Some(data) = guard.sessions.get_mut(session_id) {
            let was = data.completed || data.waiting || data.status == "done";
            data.files_changed.extend(files.clone());
            // Agent is actively working if it's reporting file changes
            if data.status != "working" {
                data.status = "working".to_string();
            }
            data.completed = false;
            data.completion_summary = None;
            data.waiting = false;
            data.waiting_question = None;
            was
        } else {
            false
        }
    };

    if was_inactive {
        let project_id = get_session_project_id(app, session_id);
        let _ = app.emit(
            "mcp-status-update",
            McpStatusEvent {
                session_id: session_id.to_string(),
                status: "working".to_string(),
                message: format!("{count} file(s) changed"),
                activity: None,
                project_id,
            },
        );
    }

    let _ = app.emit(
        "mcp-files-changed",
        McpFilesChangedEvent {
            session_id: session_id.to_string(),
            files: files.clone(),
        },
    );

    // Log to task file (fire-and-forget)
    let app_clone = app.clone();
    let sid = session_id.to_string();
    std::thread::spawn(move || {
        task_logger::log_mcp_event(
            &app_clone,
            &sid,
            TaskLogEvent::FilesChanged { files },
        );
    });

    McpToolResult::text(format!("Recorded {count} file change(s)"))
}

async fn handle_report_waiting(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    let question = args
        .get("question")
        .and_then(|v| v.as_str())
        .unwrap_or("Waiting for user input");

    {
        let mut guard = mcp.lock().await;
        if let Some(data) = guard.sessions.get_mut(session_id) {
            data.status = "waiting".to_string();
            data.message = question.to_string();
            data.waiting = true;
            data.waiting_question = Some(question.to_string());
            // Clear completed state — agent is active again
            data.completed = false;
            data.completion_summary = None;
        }
    }

    let project_id = get_session_project_id(app, session_id);

    let _ = app.emit(
        "mcp-waiting",
        McpWaitingEvent {
            session_id: session_id.to_string(),
            question: question.to_string(),
            project_id,
        },
    );

    // Log to task file (fire-and-forget)
    let app_clone = app.clone();
    let sid = session_id.to_string();
    let log_question = question.to_string();
    std::thread::spawn(move || {
        task_logger::log_mcp_event(
            &app_clone,
            &sid,
            TaskLogEvent::Waiting {
                question: log_question,
            },
        );
    });

    McpToolResult::text(format!(
        "Waiting state set. The user has been notified with your question: \"{question}\". \
         STOP working and wait — the session is paused until the user responds."
    ))
}

async fn handle_report_error(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    let error = args
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown error");
    let details = args.get("details").and_then(|v| v.as_str()).map(String::from);

    {
        let mut guard = mcp.lock().await;
        if let Some(data) = guard.sessions.get_mut(session_id) {
            data.status = "error".to_string();
            data.message = error.to_string();
            // Clear completed/waiting state — error takes precedence
            data.completed = false;
            data.completion_summary = None;
            data.waiting = false;
            data.waiting_question = None;
        }
    }

    let project_id = get_session_project_id(app, session_id);

    let _ = app.emit(
        "mcp-error",
        McpErrorEvent {
            session_id: session_id.to_string(),
            error: error.to_string(),
            details: details.clone(),
            project_id,
        },
    );

    // Log to task file (fire-and-forget)
    let app_clone = app.clone();
    let sid = session_id.to_string();
    let log_error = error.to_string();
    std::thread::spawn(move || {
        task_logger::log_mcp_event(
            &app_clone,
            &sid,
            TaskLogEvent::Error {
                error: log_error,
                details,
            },
        );
    });

    McpToolResult::text(format!(
        "Error reported to the IDE. The session is now in error state. \
         Stop working and wait for the user to address the issue: {error}"
    ))
}

async fn handle_report_complete(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    let summary = args
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let files_changed = args
        .get("files_changed")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    {
        let mut guard = mcp.lock().await;
        if let Some(data) = guard.sessions.get_mut(session_id) {
            data.status = "done".to_string();
            data.message = summary.to_string();
            data.completed = true;
            data.completion_summary = Some(summary.to_string());
            data.waiting = false;
            data.waiting_question = None;
            data.activity = None;
        }
    }

    // Mark the linked task as in-review (or ready for research sessions)
    try_mark_task_complete(app, session_id);

    let project_id = get_session_project_id(app, session_id);

    let _ = app.emit(
        "mcp-complete",
        McpCompleteEvent {
            session_id: session_id.to_string(),
            summary: summary.to_string(),
            files_changed,
            project_id,
        },
    );

    // Log to task file (fire-and-forget)
    let app_clone = app.clone();
    let sid = session_id.to_string();
    let log_summary = summary.to_string();
    std::thread::spawn(move || {
        task_logger::log_mcp_event(
            &app_clone,
            &sid,
            TaskLogEvent::Complete {
                summary: log_summary,
                files_changed,
            },
        );
    });

    // Auto-advance continuous mode: mark item complete + launch next task (chained).
    // Sessions are NOT stopped — they stay alive so the user can review agent output.
    // Only spawn the advance task if this session is actually part of a continuous run.
    let cont_state: tauri::State<'_, ContinuousState> = app.state();
    let is_continuous = continuous::find_run_by_session(&cont_state, session_id).await.is_some();

    if is_continuous {
        let app_clone = app.clone();
        let sid = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            // Must run on a blocking thread — mark_complete_and_advance uses
            // blocking_lock() which panics inside a tokio async context.
            let _ = tokio::task::spawn_blocking(move || {
                continuous::mark_complete_and_advance(&app_clone, &sid);
            }).await;
        });
    }

    McpToolResult::text(
        "Task marked complete and moved to 'in-review'. \
         The user will review your changes. You should stop working now."
            .to_string(),
    )
}

async fn handle_report_researched(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    let summary = args
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    {
        let mut guard = mcp.lock().await;
        if let Some(data) = guard.sessions.get_mut(session_id) {
            data.status = "done".to_string();
            data.message = summary.to_string();
            data.completed = true;
            data.completion_summary = Some(summary.to_string());
            data.waiting = false;
            data.waiting_question = None;
            data.activity = None;
        }
    }

    // Move task from backlog → ready (if applicable)
    try_mark_research_complete(app, session_id);

    let project_id = get_session_project_id(app, session_id);

    let _ = app.emit(
        "mcp-complete",
        McpCompleteEvent {
            session_id: session_id.to_string(),
            summary: summary.to_string(),
            files_changed: None,
            project_id,
        },
    );

    // Log to task file (fire-and-forget)
    let app_clone = app.clone();
    let sid = session_id.to_string();
    let log_summary = summary.to_string();
    std::thread::spawn(move || {
        task_logger::log_mcp_event(
            &app_clone,
            &sid,
            TaskLogEvent::Complete {
                summary: log_summary,
                files_changed: None,
            },
        );
    });

    McpToolResult::text(
        "Research findings recorded. The user has been notified and will decide next steps. \
         You can continue discussing or wait for the user."
            .to_string(),
    )
}

/// Look up the session's linked task and move it to "in-review".
/// Used by report_complete (task/continuous sessions).
/// Errors are logged but not propagated — MCP should always succeed.
fn try_mark_task_complete(app: &AppHandle, session_id: &str) {
    let db: tauri::State<'_, DbState> = app.state();

    let result = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(%e, "Failed to lock DB for task completion");
                return;
            }
        };

        let session = match db::sessions::get(&conn, session_id) {
            Ok(Some(s)) => s,
            Ok(None) => {
                tracing::warn!(session_id, "Session not found for task completion");
                return;
            }
            Err(e) => {
                tracing::error!(%e, session_id, "Failed to fetch session for task completion");
                return;
            }
        };

        let task_id = match &session.task_id {
            Some(tid) => tid.clone(),
            None => return, // vibe/shell session, no task to mark
        };

        let new_status = "in-review";
        match do_update_task_status(&conn, &session.project_id, &task_id, new_status) {
            Ok((task, sync_ctx, todos)) => {
                tracing::info!(task_id = %task.id, %new_status, "Marked task status");
                let _ = app.emit("task-updated", &task);
                if let Some(t) = todos { t.write(); }
                sync_ctx
            }
            Err(e) => {
                tracing::error!(%e, task_id, %new_status, "Failed to mark task status");
                None
            }
        }
    };

    if let Some(ctx) = result {
        crate::commands::tasks::execute_github_sync(ctx);
    }
}

/// Look up the session's linked task and advance backlog → ready.
/// Used by report_researched (research sessions).
/// If the task is already beyond backlog, this is a no-op.
fn try_mark_research_complete(app: &AppHandle, session_id: &str) {
    let db: tauri::State<'_, DbState> = app.state();

    let result = {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(%e, "Failed to lock DB for research completion");
                return;
            }
        };

        let session = match db::sessions::get(&conn, session_id) {
            Ok(Some(s)) => s,
            Ok(None) => {
                tracing::warn!(session_id, "Session not found for research completion");
                return;
            }
            Err(e) => {
                tracing::error!(%e, session_id, "Failed to fetch session for research completion");
                return;
            }
        };

        let task_id = match &session.task_id {
            Some(tid) => tid.clone(),
            None => return,
        };

        // Research sessions only advance backlog → ready. Never beyond.
        let current_task = db::tasks::get(&conn, &task_id, &session.project_id)
            .ok()
            .flatten();
        match current_task {
            Some(task) if task.status == TaskStatus::Backlog => {
                let new_status = "ready";
                match do_update_task_status(&conn, &session.project_id, &task_id, new_status) {
                    Ok((task, sync_ctx, todos)) => {
                        tracing::info!(task_id = %task.id, %new_status, "Research complete, moved task to ready");
                        let _ = app.emit("task-updated", &task);
                        if let Some(t) = todos { t.write(); }
                        sync_ctx
                    }
                    Err(e) => {
                        tracing::error!(%e, task_id, %new_status, "Failed to mark task status");
                        None
                    }
                }
            }
            _ => {
                tracing::info!(task_id, "Research session complete, task status unchanged");
                None
            }
        }
    };

    if let Some(ctx) = result {
        crate::commands::tasks::execute_github_sync(ctx);
    }
}

// ── Task management tool handlers ──

/// Resolve task_id from explicit argument or session context.
async fn resolve_task_id(
    session_id: &str,
    args: &Value,
    mcp: &TokioMutex<McpState>,
) -> Result<(String, Option<String>), String> {
    // Check explicit argument first
    if let Some(tid) = args.get("task_id").and_then(|v| v.as_str()) {
        // Get project_id from session context
        let guard = mcp.lock().await;
        let project_id = guard
            .sessions
            .get(session_id)
            .and_then(|d| d.project_id.clone());
        return Ok((tid.to_string(), project_id));
    }

    // Fall back to session context
    let guard = mcp.lock().await;
    if let Some(data) = guard.sessions.get(session_id) {
        if let Some(tid) = &data.task_id {
            return Ok((tid.clone(), data.project_id.clone()));
        }
    }

    Err("No task_id provided and no task associated with this session".to_string())
}

async fn handle_get_task(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    // 1. Resolve task_id
    let (task_id, session_project_id) = match resolve_task_id(session_id, args, mcp).await {
        Ok(v) => v,
        Err(e) => return McpToolResult::error(e),
    };

    // 2. Get project_id (from session context or DB lookup)
    let project_id = session_project_id
        .or_else(|| get_session_project_id(app, session_id));

    let project_id = match project_id {
        Some(pid) => pid,
        None => return McpToolResult::error("Could not determine project_id for this session"),
    };

    // 3. Fetch task from DB
    let db_state: tauri::State<'_, DbState> = app.state();
    let conn = match db_state.lock() {
        Ok(c) => c,
        Err(e) => return McpToolResult::error(format!("Failed to lock DB: {e}")),
    };

    let task = match db::tasks::get(&conn, &task_id, &project_id) {
        Ok(Some(t)) => t,
        Ok(None) => return McpToolResult::error(format!("Task {task_id} not found")),
        Err(e) => return McpToolResult::error(format!("Failed to fetch task: {e}")),
    };

    // 4. Read body: from disk file when disk enabled, otherwise DB only
    let disk_enabled = crate::tasks::task_files_enabled(&conn, &project_id);
    let body = if disk_enabled {
        task.task_file_path
            .as_ref()
            .and_then(|p| {
                let path = std::path::Path::new(p);
                if path.is_file() {
                    let content = std::fs::read_to_string(path).ok()?;
                    crate::tasks::parse_task_file(&content, path)
                        .ok()
                        .map(|parsed| parsed.body)
                } else {
                    None
                }
            })
            .unwrap_or_else(|| task.body.clone())
    } else {
        task.body.clone()
    };

    // 5. Fetch recent activity history from DB (last 50 events)
    let activity_history: Vec<Value> = db::task_activity::list_by_task(&conn, &task_id, &project_id, 50)
        .unwrap_or_default()
        .into_iter()
        .map(|a| json!({
            "event_type": a.event_type,
            "timestamp": a.timestamp,
            "session_id": a.session_id,
            "data": a.data,
        }))
        .collect();

    // 6. Return task data as JSON
    let result = json!({
        "id": task.id,
        "title": task.title,
        "status": task.status,
        "priority": task.priority,
        "labels": task.labels,
        "depends_on": task.depends_on,
        "agent": task.agent,
        "model": task.model,
        "branch": task.branch,
        "github_issue": task.github_issue,
        "github_pr": task.github_pr,
        "body": body,
        "activity_history": activity_history,
    });

    McpToolResult::text(serde_json::to_string_pretty(&result).unwrap_or_default())
}

async fn handle_update_task_plan(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    let plan = match args.get("plan").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return McpToolResult::error("Missing required parameter: plan"),
    };

    // 1. Resolve task_id
    let (task_id, session_project_id) = match resolve_task_id(session_id, args, mcp).await {
        Ok(v) => v,
        Err(e) => return McpToolResult::error(e),
    };

    // 2. Get project_id
    let project_id = session_project_id
        .or_else(|| get_session_project_id(app, session_id));

    let project_id = match project_id {
        Some(pid) => pid,
        None => return McpToolResult::error("Could not determine project_id for this session"),
    };

    // 3. Fetch task from DB
    let db_state: tauri::State<'_, DbState> = app.state();
    let conn = match db_state.lock() {
        Ok(c) => c,
        Err(e) => return McpToolResult::error(format!("Failed to lock DB: {e}")),
    };

    let task = match db::tasks::get(&conn, &task_id, &project_id) {
        Ok(Some(t)) => t,
        Ok(None) => return McpToolResult::error(format!("Task {task_id} not found")),
        Err(e) => return McpToolResult::error(format!("Failed to fetch task: {e}")),
    };

    let disk_enabled = crate::tasks::task_files_enabled(&conn, &project_id);

    // Helper: replace or insert ## Implementation Plan in a body string
    let plan_heading = "## Implementation Plan";
    let new_plan_section = format!("{plan_heading}\n\n{plan}");

    let update_body = |existing_body: &str| -> String {
        if let Some(plan_start) = existing_body.find(plan_heading) {
            let after_plan = &existing_body[plan_start + plan_heading.len()..];
            let plan_end = after_plan
                .find("\n## ")
                .map(|pos| plan_start + plan_heading.len() + pos)
                .unwrap_or(existing_body.len());

            let mut body = String::new();
            body.push_str(&existing_body[..plan_start]);
            body.push_str(&new_plan_section);
            if plan_end < existing_body.len() {
                body.push_str(&existing_body[plan_end..]);
            } else {
                body.push('\n');
            }
            body
        } else if let Some(history_pos) = existing_body.find("## Agent History") {
            let mut body = String::new();
            body.push_str(&existing_body[..history_pos]);
            body.push_str(&new_plan_section);
            body.push_str("\n\n");
            body.push_str(&existing_body[history_pos..]);
            body
        } else {
            let mut body = existing_body.to_string();
            if !body.is_empty() && !body.ends_with('\n') {
                body.push('\n');
            }
            body.push('\n');
            body.push_str(&new_plan_section);
            body.push('\n');
            body
        }
    };

    if disk_enabled {
        // Disk mode: read/write task file
        let file_path_str = match &task.task_file_path {
            Some(p) => p.clone(),
            None => return McpToolResult::error(format!("Task {task_id} has no task file")),
        };
        let file_path = std::path::Path::new(&file_path_str);

        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(e) => return McpToolResult::error(format!("Failed to read task file: {e}")),
        };

        let parsed = match crate::tasks::parse_task_file(&content, file_path) {
            Ok(p) => p,
            Err(e) => return McpToolResult::error(format!("Failed to parse task file: {e}")),
        };

        let new_body = update_body(&parsed.body);

        match crate::tasks::serialize_task_file(&parsed.frontmatter, &new_body) {
            Ok(content) => {
                if let Err(e) = std::fs::write(file_path, content) {
                    return McpToolResult::error(format!("Failed to write task file: {e}"));
                }
            }
            Err(e) => return McpToolResult::error(format!("Failed to serialize task file: {e}")),
        }
    } else {
        // DB-only mode: update body in database
        let new_body = update_body(&task.body);
        let new_task = db::models::NewTask {
            id: task.id.clone(),
            project_id: project_id.clone(),
            task_file_path: None,
            title: task.title.clone(),
            status: Some(task.status),
            priority: Some(task.priority),
            task_type: Some(task.task_type),
            epic_id: task.epic_id.clone(),
            agent: task.agent.clone(),
            model: task.model.clone(),
            branch: task.branch.clone(),
            worktree_path: task.worktree_path.clone(),
            github_issue: task.github_issue.clone(),
            github_pr: task.github_pr.clone(),
            depends_on: task.depends_on.clone(),
            labels: task.labels.clone(),
            body: new_body,
        };
        if let Err(e) = db::tasks::upsert(&conn, &new_task) {
            return McpToolResult::error(format!("Failed to update task: {e}"));
        }
    }

    McpToolResult::text(format!("Updated implementation plan for task {task_id}"))
}

async fn handle_update_task(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    // 1. Resolve task_id
    let (task_id, session_project_id) = match resolve_task_id(session_id, args, mcp).await {
        Ok(v) => v,
        Err(e) => return McpToolResult::error(e),
    };

    // 2. Get project_id
    let project_id = session_project_id
        .or_else(|| get_session_project_id(app, session_id));

    let project_id = match project_id {
        Some(pid) => pid,
        None => return McpToolResult::error("Could not determine project_id for this session"),
    };

    // 3. Fetch existing task from DB
    let db_state: tauri::State<'_, DbState> = app.state();
    let conn = match db_state.lock() {
        Ok(c) => c,
        Err(e) => return McpToolResult::error(format!("Failed to lock DB: {e}")),
    };

    let task = match db::tasks::get(&conn, &task_id, &project_id) {
        Ok(Some(t)) => t,
        Ok(None) => return McpToolResult::error(format!("Task {task_id} not found")),
        Err(e) => return McpToolResult::error(format!("Failed to fetch task: {e}")),
    };

    // 4. Merge provided fields with existing task values
    let new_title = args
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or(&task.title);
    let new_status = args
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or(task.status.as_str());
    let new_priority = args
        .get("priority")
        .and_then(|v| v.as_str())
        .unwrap_or(task.priority.as_str());
    let new_labels: Vec<String> = args
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| task.labels.clone());
    let new_depends_on: Vec<String> = args
        .get("depends_on")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| task.depends_on.clone());
    let new_github_issue = args
        .get("github_issue")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| task.github_issue.clone());
    let new_github_pr = args
        .get("github_pr")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| task.github_pr.clone());

    // Handle task_type changes
    let new_task_type = args
        .get("task_type")
        .and_then(|v| v.as_str())
        .map(|s| s.parse::<db::models::TaskType>().unwrap_or(task.task_type))
        .unwrap_or(task.task_type);

    // Handle epic_id changes (empty string = unassign)
    let new_epic_id = if let Some(v) = args.get("epic_id").and_then(|v| v.as_str()) {
        if v.is_empty() { None } else { Some(v.to_string()) }
    } else {
        task.epic_id.clone()
    };

    // Validate: epics cannot have an epic_id (no nesting)
    if new_task_type == db::models::TaskType::Epic && new_epic_id.is_some() {
        return McpToolResult::error("Epics cannot be nested inside other epics");
    }

    // Validate: if epic_id is set, verify target exists and is an epic
    if let Some(ref eid) = new_epic_id {
        match db::tasks::get(&conn, eid, &project_id) {
            Ok(Some(parent)) => {
                if parent.task_type != db::models::TaskType::Epic {
                    return McpToolResult::error(format!("Task {eid} is not an epic"));
                }
            }
            Ok(None) => return McpToolResult::error(format!("Epic {eid} not found")),
            Err(e) => return McpToolResult::error(format!("Failed to look up epic: {e}")),
        }
    }

    // Validate: if changing from epic to task, verify no children reference it
    if task.task_type == db::models::TaskType::Epic && new_task_type == db::models::TaskType::Task {
        match db::tasks::list_by_epic(&conn, &project_id, &task.id) {
            Ok(children) if !children.is_empty() => {
                return McpToolResult::error(format!(
                    "Cannot change type to 'task': {} children still reference this epic",
                    children.len()
                ));
            }
            _ => {}
        }
    }

    // Validate status
    if new_status.parse::<TaskStatus>().is_err() {
        return McpToolResult::error(format!("Invalid status: {new_status}"));
    }

    // 5. Update task file on disk if it exists
    let disk_enabled = crate::tasks::task_files_enabled(&conn, &project_id);
    if disk_enabled {
        if let Some(ref file_path_str) = task.task_file_path {
            let file_path = std::path::Path::new(file_path_str);
            if file_path.is_file() {
                let content = match std::fs::read_to_string(file_path) {
                    Ok(c) => c,
                    Err(e) => {
                        return McpToolResult::error(format!("Failed to read task file: {e}"))
                    }
                };
                let parsed = match crate::tasks::parse_task_file(&content, file_path) {
                    Ok(p) => p,
                    Err(e) => {
                        return McpToolResult::error(format!("Failed to parse task file: {e}"))
                    }
                };

                let frontmatter = crate::tasks::TaskFrontmatter {
                    id: task.id.clone(),
                    title: new_title.to_string(),
                    status: new_status.to_string(),
                    priority: new_priority.to_string(),
                    created: parsed.frontmatter.created,
                    depends_on: new_depends_on.clone(),
                    labels: new_labels.clone(),
                    task_type: if new_task_type == db::models::TaskType::Epic { Some("epic".to_string()) } else { None },
                    epic_id: new_epic_id.clone(),
                    agent: task.agent.clone(),
                    model: task.model.clone(),
                    branch: task.branch.clone(),
                    github_issue: new_github_issue.clone(),
                    github_pr: new_github_pr.clone(),
                };

                match crate::tasks::serialize_task_file(&frontmatter, &parsed.body) {
                    Ok(new_content) => {
                        if let Err(e) = std::fs::write(file_path, new_content) {
                            return McpToolResult::error(format!(
                                "Failed to write task file: {e}"
                            ));
                        }
                    }
                    Err(e) => {
                        return McpToolResult::error(format!(
                            "Failed to serialize task file: {e}"
                        ))
                    }
                }
            }
        }
    }

    // 6. Update DB via upsert
    let new_task = db::models::NewTask {
        id: task.id.clone(),
        project_id: project_id.clone(),
        task_file_path: task.task_file_path.clone(),
        title: new_title.to_string(),
        status: Some(
            new_status
                .parse::<TaskStatus>()
                .unwrap_or(TaskStatus::Backlog),
        ),
        priority: Some(new_priority.to_string()),
        task_type: Some(new_task_type),
        epic_id: new_epic_id.clone(),
        agent: task.agent.clone(),
        model: task.model.clone(),
        branch: task.branch.clone(),
        worktree_path: task.worktree_path.clone(),
        github_issue: new_github_issue.clone(),
        github_pr: new_github_pr.clone(),
        depends_on: new_depends_on.clone(),
        labels: new_labels.clone(),
        body: task.body.clone(),
    };

    let updated = match db::tasks::upsert(&conn, &new_task) {
        Ok(t) => t,
        Err(e) => return McpToolResult::error(format!("Failed to update task: {e}")),
    };

    // 7. Auto-derive parent epic status if this task belongs to an epic
    if let Some(ref epic_id) = updated.epic_id {
        if let Ok(children) = db::tasks::list_by_epic(&conn, &project_id, epic_id) {
            let derived = crate::commands::tasks::derive_epic_status(&children);
            if let Ok(Some(epic)) = db::tasks::get(&conn, epic_id, &project_id) {
                if derived != epic.status {
                    let _ = db::tasks::update_status(&conn, epic_id, &project_id, derived);
                    // Also update file if disk enabled
                    if crate::tasks::task_files_enabled(&conn, &project_id) {
                        if let Some(ref fp) = epic.task_file_path {
                            let path = std::path::Path::new(fp);
                            if path.exists() {
                                let _ = crate::tasks::update_task_file_field(path, "status", derived.as_str());
                            }
                        }
                    }
                    // Emit event for the epic status change
                    if let Ok(Some(updated_epic)) = db::tasks::get(&conn, epic_id, &project_id) {
                        let _ = app.emit("task-updated", &updated_epic);
                    }
                }
            }
        }
    }

    // 8. Emit task-updated event
    let _ = app.emit("task-updated", &updated);

    tracing::info!(
        task_id = %updated.id,
        source = "agent",
        session_id,
        "Task updated via MCP"
    );

    // 8. Return updated task metadata
    let result = json!({
        "id": updated.id,
        "title": updated.title,
        "status": updated.status,
        "priority": updated.priority,
        "task_type": updated.task_type,
        "epic_id": updated.epic_id,
        "labels": updated.labels,
        "depends_on": updated.depends_on,
        "github_issue": updated.github_issue,
        "github_pr": updated.github_pr,
    });

    McpToolResult::text(serde_json::to_string_pretty(&result).unwrap_or_default())
}

async fn handle_list_tasks(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    // 1. Get project_id from session context
    let project_id = {
        let guard = mcp.lock().await;
        guard
            .sessions
            .get(session_id)
            .and_then(|d| d.project_id.clone())
    }
    .or_else(|| get_session_project_id(app, session_id));

    let project_id = match project_id {
        Some(pid) => pid,
        None => {
            return McpToolResult::error(
                "Could not determine project_id — agent must be in a project context",
            )
        }
    };

    // 2. Fetch all tasks from DB
    let db_state: tauri::State<'_, DbState> = app.state();
    let conn = match db_state.lock() {
        Ok(c) => c,
        Err(e) => return McpToolResult::error(format!("Failed to lock DB: {e}")),
    };

    let tasks = match db::tasks::list_by_project(&conn, &project_id) {
        Ok(t) => t,
        Err(e) => return McpToolResult::error(format!("Failed to list tasks: {e}")),
    };

    // 3. Apply optional filters
    let status_filter = args.get("status").and_then(|v| v.as_str());
    let label_filter = args.get("label").and_then(|v| v.as_str());
    let task_type_filter = args.get("task_type").and_then(|v| v.as_str());
    let epic_id_filter = args.get("epic_id").and_then(|v| v.as_str());

    let filtered: Vec<_> = tasks
        .into_iter()
        .filter(|t| {
            if let Some(status) = status_filter {
                if t.status.as_str() != status {
                    return false;
                }
            }
            if let Some(label) = label_filter {
                if !t.labels.iter().any(|l| l == label) {
                    return false;
                }
            }
            if let Some(tt) = task_type_filter {
                if t.task_type.as_str() != tt {
                    return false;
                }
            }
            if let Some(eid) = epic_id_filter {
                if t.epic_id.as_deref() != Some(eid) {
                    return false;
                }
            }
            true
        })
        .collect();

    // 4. Build compact response (no body)
    let items: Vec<Value> = filtered
        .iter()
        .map(|t| {
            json!({
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "priority": t.priority,
                "task_type": t.task_type,
                "epic_id": t.epic_id,
                "labels": t.labels,
                "depends_on": t.depends_on,
                "github_issue": t.github_issue,
                "github_pr": t.github_pr,
            })
        })
        .collect();

    let result = json!({
        "count": items.len(),
        "tasks": items,
    });

    McpToolResult::text(serde_json::to_string_pretty(&result).unwrap_or_default())
}

async fn handle_create_task(
    session_id: &str,
    args: &Value,
    mcp: &Arc<TokioMutex<McpState>>,
    app: &AppHandle,
) -> McpToolResult {
    let title = match args.get("title").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return McpToolResult::error("Missing required parameter: title"),
    };

    let priority = args.get("priority").and_then(|v| v.as_str());
    let body = args.get("body").and_then(|v| v.as_str());
    let task_type_str = args.get("task_type").and_then(|v| v.as_str());
    let epic_id_str = args.get("epic_id").and_then(|v| v.as_str());

    // 1. Get project_id from session context
    let project_id = {
        let guard = mcp.lock().await;
        guard
            .sessions
            .get(session_id)
            .and_then(|d| d.project_id.clone())
    }
    .or_else(|| get_session_project_id(app, session_id));

    let project_id = match project_id {
        Some(pid) => pid,
        None => return McpToolResult::error("Could not determine project_id — agent must be in a project context"),
    };

    // 2. Get project path from DB
    let db_state: tauri::State<'_, DbState> = app.state();
    let conn = match db_state.lock() {
        Ok(c) => c,
        Err(e) => return McpToolResult::error(format!("Failed to lock DB: {e}")),
    };

    let project = match db::projects::get(&conn, &project_id) {
        Ok(Some(p)) => p,
        Ok(None) => return McpToolResult::error(format!("Project {project_id} not found")),
        Err(e) => return McpToolResult::error(format!("Failed to fetch project: {e}")),
    };

    let disk_enabled = crate::tasks::task_files_enabled(&conn, &project_id);

    // 3. Create the task (file + DB when disk enabled, DB-only otherwise)
    let task = if disk_enabled {
        let tasks_dir = std::path::Path::new(&project.path)
            .join(".agents")
            .join("tasks");
        match crate::tasks::create_task_file(&conn, &project_id, &tasks_dir, title, priority, body) {
            Ok(t) => t,
            Err(e) => return McpToolResult::error(format!("Failed to create task: {e}")),
        }
    } else {
        // DB-only mode: generate ID from DB, insert directly
        let task_id = match crate::tasks::next_task_id_from_db(&conn, &project_id) {
            Ok(id) => id,
            Err(e) => return McpToolResult::error(format!("Failed to generate task ID: {e}")),
        };
        let default_body =
            "## Objective\n\n\n\n## Acceptance Criteria\n\n- [ ] \n\n## Implementation Plan\n\n1. \n";
        let body_content = body.unwrap_or(default_body);
        let priority_val = priority.unwrap_or("P2");
        let new_task = db::models::NewTask {
            id: task_id,
            project_id: project_id.clone(),
            task_file_path: None,
            title: title.to_string(),
            status: None,
            priority: Some(priority_val.to_string()),
            task_type: task_type_str.map(|s| s.parse().unwrap_or(db::models::TaskType::Task)),
            epic_id: epic_id_str.map(|s| s.to_string()),
            agent: None,
            model: None,
            branch: None,
            worktree_path: None,
            github_issue: None,
            github_pr: None,
            depends_on: vec![],
            labels: vec![],
            body: body_content.to_string(),
        };
        match db::tasks::upsert(&conn, &new_task) {
            Ok(t) => t,
            Err(e) => return McpToolResult::error(format!("Failed to create task: {e}")),
        }
    };

    // 4. Update labels/depends_on if provided
    let label_strs: Vec<String> = args
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let dep_strs: Vec<String> = args
        .get("depends_on")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    // Determine effective task_type and epic_id for post-creation updates
    let effective_task_type = task_type_str.and_then(|s| s.parse::<db::models::TaskType>().ok());
    let effective_epic_id = epic_id_str.map(|s| s.to_string());
    let needs_type_update = effective_task_type.is_some() || effective_epic_id.is_some();

    if !label_strs.is_empty() || !dep_strs.is_empty() || needs_type_update {
        if disk_enabled {
            // Update via file for disk mode
            if let Some(file_path) = &task.task_file_path {
                let file_path = std::path::Path::new(file_path);
                if file_path.is_file() {
                    if let Ok(content) = std::fs::read_to_string(file_path) {
                        if let Ok(mut parsed) = crate::tasks::parse_task_file(&content, file_path) {
                            if !label_strs.is_empty() {
                                parsed.frontmatter.labels = label_strs.clone();
                            }
                            if !dep_strs.is_empty() {
                                parsed.frontmatter.depends_on = dep_strs.clone();
                            }
                            if let Some(ref tt) = effective_task_type {
                                parsed.frontmatter.task_type = if *tt == db::models::TaskType::Epic { Some("epic".to_string()) } else { None };
                            }
                            if effective_epic_id.is_some() {
                                parsed.frontmatter.epic_id = effective_epic_id.clone();
                            }
                            if let Ok(new_content) = crate::tasks::serialize_task_file(&parsed.frontmatter, &parsed.body) {
                                let _ = std::fs::write(file_path, new_content);
                            }
                        }
                    }
                }
            }
        } else {
            // Update via DB for DB-only mode
            let new_task = db::models::NewTask {
                id: task.id.clone(),
                project_id: project_id.clone(),
                task_file_path: None,
                title: task.title.clone(),
                status: Some(task.status),
                priority: Some(task.priority.clone()),
                task_type: effective_task_type.or(Some(task.task_type)),
                epic_id: if effective_epic_id.is_some() { effective_epic_id.clone() } else { task.epic_id.clone() },
                agent: task.agent.clone(),
                model: task.model.clone(),
                branch: task.branch.clone(),
                worktree_path: task.worktree_path.clone(),
                github_issue: task.github_issue.clone(),
                github_pr: task.github_pr.clone(),
                depends_on: if !dep_strs.is_empty() { dep_strs } else { task.depends_on.clone() },
                labels: if !label_strs.is_empty() { label_strs } else { task.labels.clone() },
                body: task.body.clone(),
            };
            let _ = db::tasks::upsert(&conn, &new_task);
        }
    }

    tracing::info!(
        task_id = %task.id,
        title = %task.title,
        priority = %task.priority,
        source = "agent",
        session_id,
        "Task created"
    );

    // 5. Emit task-updated event
    let _ = app.emit("task-updated", &task);

    // 6. Return result
    let relative_path = task.task_file_path.as_ref().map(|p| {
        // Try to make it relative to project path
        p.strip_prefix(&project.path)
            .map(|r| r.to_string())
            .unwrap_or_else(|| p.clone())
    });

    let result = json!({
        "task_id": task.id,
        "title": task.title,
        "status": "backlog",
        "file_path": relative_path,
    });

    McpToolResult::text(serde_json::to_string_pretty(&result).unwrap_or_default())
}

// ── MCP config writer ──

/// The key we use inside `mcpServers` so we can add/remove our entry without
/// clobbering user-defined servers.
const MCP_SERVER_KEY: &str = "faber";

/// Resolve the path to the `faber-mcp` sidecar binary.
/// In production Tauri bundles it with a target-triple suffix
/// (e.g. `faber-mcp-x86_64-unknown-linux-gnu`); in dev both
/// binaries share the same `target/debug/` directory without suffix.
pub fn resolve_sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;

    let ext = if cfg!(windows) { ".exe" } else { "" };

    // Try bundled name first (production): includes target triple
    let bundled = dir.join(format!(
        "faber-mcp-{}{}",
        env!("TAURI_ENV_TARGET_TRIPLE"),
        ext
    ));
    if bundled.exists() {
        return Some(bundled);
    }

    // Fall back to plain name (development)
    let plain = dir.join(format!("faber-mcp{}", ext));
    if plain.exists() {
        return Some(plain);
    }

    None
}

/// Build the MCP server entry for an agent config file.
///
/// The config is **session-agnostic**: it only contains the sidecar command.
/// The session-specific `FABER_MCP_URL` is passed via the PTY process
/// environment so multiple sessions can share the same config file.
fn build_mcp_entry(agent_name: &str) -> Option<Value> {
    let sidecar = resolve_sidecar_path();
    if sidecar.is_none() {
        tracing::warn!("MCP sidecar not found, skipping MCP config");
        return None;
    }
    let sidecar_str = sidecar.unwrap().to_string_lossy().into_owned();

    let entry = match agent_name {
        "gemini" => json!({
            "command": sidecar_str,
            "args": []
        }),
        "copilot" => json!({
            "type": "local",
            "command": sidecar_str,
            "args": []
        }),
        "opencode" => json!({
            "type": "local",
            "command": [sidecar_str],
            "enabled": true
        }),
        _ => json!({
            "type": "stdio",
            "command": sidecar_str,
            "args": []
        }),
    };
    Some(entry)
}

/// Build the full MCP URL for a specific session.
pub fn build_session_mcp_url(port: u16, session_id: &str) -> String {
    format!("http://127.0.0.1:{port}/session/{session_id}/mcp")
}

/// Merge our MCP server entry into an existing config file, preserving
/// user-defined servers. Creates the file if it doesn't exist.
fn merge_mcp_config(path: &Path, entry: &Value) -> Result<(), AppError> {
    let mut config = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        serde_json::from_str::<Value>(&content).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    // Ensure mcpServers object exists
    if !config.get("mcpServers").is_some_and(|v| v.is_object()) {
        config
            .as_object_mut()
            .unwrap()
            .insert("mcpServers".into(), json!({}));
    }

    // Insert/update our entry
    config["mcpServers"][MCP_SERVER_KEY] = entry.clone();

    // Create parent dirs if needed
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(path, serde_json::to_string_pretty(&config).unwrap())?;
    Ok(())
}

/// Merge our MCP server entry into an OpenCode config file.
/// OpenCode uses a `"mcp"` key (not `"mcpServers"`).
fn merge_opencode_mcp_config(path: &Path, entry: &Value) -> Result<(), AppError> {
    let mut config = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        serde_json::from_str::<Value>(&content).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    if !config.get("mcp").is_some_and(|v| v.is_object()) {
        config
            .as_object_mut()
            .unwrap()
            .insert("mcp".into(), json!({}));
    }

    config["mcp"][MCP_SERVER_KEY] = entry.clone();

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(path, serde_json::to_string_pretty(&config).unwrap())?;
    Ok(())
}

/// Remove only the Faber entry from an OpenCode MCP config file.
/// If the file becomes empty (no other servers), delete it entirely.
fn remove_opencode_mcp_entry(path: &Path) {
    if !path.exists() {
        return;
    }
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let mut config: Value = match serde_json::from_str(&content) {
        Ok(c) => c,
        Err(_) => return,
    };

    if let Some(servers) = config.get_mut("mcp").and_then(|v| v.as_object_mut()) {
        servers.remove(MCP_SERVER_KEY);

        if servers.is_empty() {
            let _ = std::fs::remove_file(path);
            tracing::debug!(path = %path.display(), "Removed empty MCP config");
        } else {
            let _ = std::fs::write(path, serde_json::to_string_pretty(&config).unwrap());
            tracing::debug!(path = %path.display(), "Removed faber entry from MCP config");
        }
    }
}

/// Remove only the Faber entry from an MCP config file.
/// If the file becomes empty (no other servers), delete it entirely.
fn remove_mcp_entry(path: &Path) {
    if !path.exists() {
        return;
    }
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let mut config: Value = match serde_json::from_str(&content) {
        Ok(c) => c,
        Err(_) => return,
    };

    if let Some(servers) = config.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        servers.remove(MCP_SERVER_KEY);

        if servers.is_empty() {
            // No servers left — remove the file entirely
            let _ = std::fs::remove_file(path);
            tracing::debug!(path = %path.display(), "Removed empty MCP config");
        } else {
            // Other servers remain — write back without our entry
            let _ = std::fs::write(path, serde_json::to_string_pretty(&config).unwrap());
            tracing::debug!(path = %path.display(), "Removed faber entry from MCP config");
        }
    }
}

/// Write agent-specific MCP config to the working directory.
/// Merges our entry into existing config files (preserving user-defined servers).
///
/// The config is session-agnostic (just the sidecar path). The session-specific
/// URL is passed to the agent via the PTY environment (`FABER_MCP_URL`).
/// Returns the config path written, or `None` if the agent/sidecar isn't available.
pub fn write_mcp_config(
    cwd: &Path,
    agent_name: &str,
    session_mode: Option<&str>,
) -> Result<Option<PathBuf>, AppError> {
    let entry = match build_mcp_entry(agent_name) {
        Some(e) => e,
        None => return Ok(None),
    };

    let config_path = match agent_name {
        "claude-code" => cwd.join(".mcp.json"),
        "cursor-agent" => cwd.join(".cursor").join("mcp.json"),
        "gemini" => cwd.join(".gemini").join("settings.json"),
        "codex" => cwd.join(".codex").join("mcp.json"),
        "copilot" => cwd.join(".copilot").join("mcp-config.json"),
        "opencode" => cwd.join("opencode.json"),
        _ => {
            tracing::debug!(agent_name, "Skipping MCP config for unsupported agent");
            return Ok(None);
        }
    };

    if agent_name == "opencode" {
        merge_opencode_mcp_config(&config_path, &entry)?;
    } else {
        merge_mcp_config(&config_path, &entry)?;
    }
    tracing::info!(agent_name, path = %config_path.display(), "Wrote MCP config");

    // Write or update the agent's instruction file with the MCP section.
    // Always call this — `write_instruction_file` is idempotent and will
    // upsert the MCP section into an existing file or create a new one.
    if let Some(filename) = session::agent_instruction_filename(agent_name) {
        session::write_instruction_file(cwd, filename, session_mode);
    }

    Ok(Some(config_path))
}

/// Remove MCP config entries from a working directory.
/// Only removes the Faber entry from config files (preserving user-defined servers).
/// Instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) are intentionally left in place
/// as their content is static and will be upserted on next session start.
pub fn cleanup_mcp_config(cwd: &Path) {
    remove_mcp_entry(&cwd.join(".mcp.json"));
    remove_mcp_entry(&cwd.join(".copilot").join("mcp-config.json"));
    remove_mcp_entry(&cwd.join(".cursor").join("mcp.json"));
    remove_mcp_entry(&cwd.join(".gemini").join("settings.json"));
    remove_mcp_entry(&cwd.join(".codex").join("mcp.json"));
    remove_opencode_mcp_entry(&cwd.join("opencode.json"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_mcp_config_claude_code() {
        let dir = tempfile::tempdir().unwrap();
        let result = write_mcp_config(dir.path(), "claude-code", None).unwrap();
        // Result depends on whether sidecar binary exists in dev
        if let Some(path) = result {
            assert!(path.exists());
            let content: Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let entry = &content["mcpServers"]["faber"];
            // Should be stdio transport (sidecar found)
            assert_eq!(entry.get("type").and_then(|v| v.as_str()), Some("stdio"));
            // Config should NOT contain session-specific data
            let raw = serde_json::to_string(&content).unwrap();
            assert!(!raw.contains("FABER_MCP_URL"));
        }
    }

    #[test]
    fn write_mcp_config_gemini() {
        let dir = tempfile::tempdir().unwrap();
        let result = write_mcp_config(dir.path(), "gemini", None).unwrap();
        if let Some(path) = result {
            assert!(path.exists());
            assert!(path.to_str().unwrap().contains(".gemini"));
        }
    }

    #[test]
    fn write_mcp_config_shell_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let result = write_mcp_config(dir.path(), "shell", None).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn cleanup_removes_our_entry() {
        let dir = tempfile::tempdir().unwrap();
        write_mcp_config(dir.path(), "claude-code", None).unwrap();
        // Only assert cleanup if sidecar was found and config was written
        if dir.path().join(".mcp.json").exists() {
            cleanup_mcp_config(dir.path());
            assert!(!dir.path().join(".mcp.json").exists());
        }
    }

    #[test]
    fn merge_preserves_user_servers() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join(".mcp.json");

        // Pre-existing user config with a custom MCP server
        let user_config = json!({
            "mcpServers": {
                "my-custom-server": {
                    "type": "stdio",
                    "command": "/usr/bin/my-tool",
                    "args": ["--flag"]
                }
            }
        });
        std::fs::write(
            &config_path,
            serde_json::to_string_pretty(&user_config).unwrap(),
        )
        .unwrap();

        // Write our config — should merge, not overwrite
        write_mcp_config(dir.path(), "claude-code", None).unwrap();

        let content: Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        let servers = content["mcpServers"].as_object().unwrap();

        // User's server should always be preserved
        assert!(servers.contains_key("my-custom-server"));
        assert_eq!(
            servers["my-custom-server"]["command"].as_str().unwrap(),
            "/usr/bin/my-tool"
        );
    }

    #[test]
    fn cleanup_preserves_user_servers() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join(".mcp.json");

        // Config with our entry + a user entry
        let config = json!({
            "mcpServers": {
                "faber": { "type": "stdio", "command": "/usr/bin/faber-mcp" },
                "my-server": { "type": "stdio", "command": "my-tool" }
            }
        });
        std::fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).unwrap(),
        )
        .unwrap();

        cleanup_mcp_config(dir.path());

        // File should still exist with only the user's server
        assert!(config_path.exists());
        let content: Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        let servers = content["mcpServers"].as_object().unwrap();
        assert!(!servers.contains_key("faber"));
        assert!(servers.contains_key("my-server"));
    }

    #[test]
    fn build_session_mcp_url_format() {
        let url = build_session_mcp_url(9999, "sess_abc");
        assert_eq!(url, "http://127.0.0.1:9999/session/sess_abc/mcp");
    }

    #[test]
    fn build_mcp_entry_is_session_agnostic() {
        if let Some(entry) = build_mcp_entry("claude-code") {
            let raw = serde_json::to_string(&entry).unwrap();
            // Should NOT contain any session ID or URL
            assert!(!raw.contains("FABER_MCP_URL"));
            assert!(!raw.contains("127.0.0.1"));
            // Should contain the sidecar command
            assert!(raw.contains("faber-mcp"));
        }
    }
}
