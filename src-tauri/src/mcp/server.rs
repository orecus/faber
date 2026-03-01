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
use crate::db::models::{SessionMode, TaskStatus};
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
            let result = McpToolsListResult {
                tools: tools::all_tools(),
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
        "get_task" => handle_get_task(session_id, &params.arguments, mcp, app).await,
        "update_task_plan" => {
            handle_update_task_plan(session_id, &params.arguments, mcp, app).await
        }
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

    McpToolResult::text(format!("Waiting reported: {question}"))
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

    McpToolResult::text("Error reported")
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

    // Auto-advance continuous mode: stop completed session + launch next task.
    // Only spawn the advance task if this session is actually part of a continuous run.
    let cont_state: tauri::State<'_, ContinuousState> = app.state();
    let is_continuous = continuous::find_run_by_session(&cont_state, session_id).await.is_some();

    if is_continuous {
        let app_clone = app.clone();
        let sid = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            // Must run on a blocking thread — stop_current_and_advance uses
            // blocking_lock() which panics inside a tokio async context.
            let _ = tokio::task::spawn_blocking(move || {
                continuous::stop_current_and_advance(&app_clone, &sid);
            }).await;
        });
    }

    McpToolResult::text("Task marked complete")
}

/// Look up the session's linked task and advance its status.
/// Research sessions move to "ready" (plan written, ready to implement).
/// However, if the task is already "ready" or "in-progress" (meaning the user
/// continued the session into implementation), advance to "in-review" instead.
/// Regular task sessions always move to "in-review".
/// Errors are logged but not propagated — MCP should always succeed.
fn try_mark_task_complete(app: &AppHandle, session_id: &str) {
    let db: tauri::State<'_, DbState> = app.state();

    // Phase 1: Hold DB lock for task update + read GitHub sync context
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

        let new_status = if session.mode == SessionMode::Research {
            // Check if the task has already moved past research phase.
            // This handles the flow where a user continues a research session
            // into implementation — the second report_complete should advance
            // the task to "in-review" instead of keeping it at "ready".
            let current_task = db::tasks::get(&conn, &task_id, &session.project_id)
                .ok()
                .flatten();
            match current_task {
                Some(task)
                    if task.status == TaskStatus::Ready
                        || task.status == TaskStatus::InProgress =>
                {
                    "in-review"
                }
                _ => "ready",
            }
        } else {
            "in-review"
        };

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
    // DB lock released here

    // Phase 2: GitHub sync without holding DB lock (spawns `gh` CLI subprocesses)
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

    // 4. Read and parse task file if available
    let body = task
        .task_file_path
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
        .unwrap_or_default();

    // 5. Return task data as JSON
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

    // 4. Get task file path
    let file_path_str = match &task.task_file_path {
        Some(p) => p.clone(),
        None => return McpToolResult::error(format!("Task {task_id} has no task file")),
    };
    let file_path = std::path::Path::new(&file_path_str);

    // 5. Read and parse
    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(e) => return McpToolResult::error(format!("Failed to read task file: {e}")),
    };

    let parsed = match crate::tasks::parse_task_file(&content, file_path) {
        Ok(p) => p,
        Err(e) => return McpToolResult::error(format!("Failed to parse task file: {e}")),
    };

    // 6. Replace or insert ## Implementation Plan section
    let plan_heading = "## Implementation Plan";
    let new_plan_section = format!("{plan_heading}\n\n{plan}");

    let new_body = if let Some(plan_start) = parsed.body.find(plan_heading) {
        // Find the end of the plan section (next ## heading or ## Agent History or end)
        let after_plan = &parsed.body[plan_start + plan_heading.len()..];
        let plan_end = after_plan
            .find("\n## ")
            .map(|pos| plan_start + plan_heading.len() + pos)
            .unwrap_or(parsed.body.len());

        let mut body = String::new();
        body.push_str(&parsed.body[..plan_start]);
        body.push_str(&new_plan_section);
        if plan_end < parsed.body.len() {
            body.push_str(&parsed.body[plan_end..]);
        } else {
            body.push('\n');
        }
        body
    } else {
        // No plan section — insert before ## Agent History or append
        if let Some(history_pos) = parsed.body.find("## Agent History") {
            let mut body = String::new();
            body.push_str(&parsed.body[..history_pos]);
            body.push_str(&new_plan_section);
            body.push_str("\n\n");
            body.push_str(&parsed.body[history_pos..]);
            body
        } else {
            let mut body = parsed.body.clone();
            if !body.is_empty() && !body.ends_with('\n') {
                body.push('\n');
            }
            body.push('\n');
            body.push_str(&new_plan_section);
            body.push('\n');
            body
        }
    };

    // 7. Write back
    match crate::tasks::serialize_task_file(&parsed.frontmatter, &new_body) {
        Ok(content) => {
            if let Err(e) = std::fs::write(file_path, content) {
                return McpToolResult::error(format!("Failed to write task file: {e}"));
            }
        }
        Err(e) => return McpToolResult::error(format!("Failed to serialize task file: {e}")),
    }

    McpToolResult::text(format!("Updated implementation plan for task {task_id}"))
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

    let tasks_dir = std::path::Path::new(&project.path)
        .join(".agents")
        .join("tasks");

    // 3. Create the task file
    let task = match crate::tasks::create_task_file(&conn, &project_id, &tasks_dir, title, priority, body) {
        Ok(t) => t,
        Err(e) => return McpToolResult::error(format!("Failed to create task: {e}")),
    };

    // 4. Update labels/depends_on if provided
    if let Some(file_path) = &task.task_file_path {
        let file_path = std::path::Path::new(file_path);
        if file_path.is_file() {
            // Update labels
            if let Some(labels) = args.get("labels").and_then(|v| v.as_array()) {
                let label_strs: Vec<String> = labels
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect();
                if !label_strs.is_empty() {
                    if let Ok(content) = std::fs::read_to_string(file_path) {
                        if let Ok(mut parsed) = crate::tasks::parse_task_file(&content, file_path) {
                            parsed.frontmatter.labels = label_strs;
                            if let Ok(new_content) = crate::tasks::serialize_task_file(&parsed.frontmatter, &parsed.body) {
                                let _ = std::fs::write(file_path, new_content);
                            }
                        }
                    }
                }
            }

            // Update depends_on
            if let Some(deps) = args.get("depends_on").and_then(|v| v.as_array()) {
                let dep_strs: Vec<String> = deps
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect();
                if !dep_strs.is_empty() {
                    if let Ok(content) = std::fs::read_to_string(file_path) {
                        if let Ok(mut parsed) = crate::tasks::parse_task_file(&content, file_path) {
                            parsed.frontmatter.depends_on = dep_strs;
                            if let Ok(new_content) = crate::tasks::serialize_task_file(&parsed.frontmatter, &parsed.body) {
                                let _ = std::fs::write(file_path, new_content);
                            }
                        }
                    }
                }
            }
        }
    }

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
        session::write_instruction_file(cwd, filename);
    }

    Ok(Some(config_path))
}

/// Remove MCP config entries from a working directory.
/// Only removes the Faber entry from config files (preserving user-defined servers).
/// Instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) are intentionally left in place
/// as their content is static and will be upserted on next session start.
pub fn cleanup_mcp_config(cwd: &Path) {
    remove_mcp_entry(&cwd.join(".mcp.json"));
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
        let result = write_mcp_config(dir.path(), "claude-code").unwrap();
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
        let result = write_mcp_config(dir.path(), "gemini").unwrap();
        if let Some(path) = result {
            assert!(path.exists());
            assert!(path.to_str().unwrap().contains(".gemini"));
        }
    }

    #[test]
    fn write_mcp_config_shell_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let result = write_mcp_config(dir.path(), "shell").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn cleanup_removes_our_entry() {
        let dir = tempfile::tempdir().unwrap();
        write_mcp_config(dir.path(), "claude-code").unwrap();
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
        write_mcp_config(dir.path(), "claude-code").unwrap();

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
