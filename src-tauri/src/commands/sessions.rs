use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex as TokioMutex;

use crate::acp::state::AcpState;
use crate::db;
use crate::db::models::{Session, SessionTransport};
use crate::db::DbState;
use crate::error::AppError;
use crate::mcp::McpState;
use crate::pty::PtyState;
use crate::session::{self, AcpChatSessionOpts, AcpResearchSessionOpts, AcpTaskSessionOpts, AcpVibeSessionOpts, ResearchSessionOpts, VibeSessionOpts};

/// Parse transport string from frontend. Defaults to PTY.
fn parse_transport(transport: Option<&str>) -> SessionTransport {
    match transport {
        Some("acp") => SessionTransport::Acp,
        _ => SessionTransport::Pty,
    }
}

// ── Core logic (testable without Tauri State) ──

fn do_list_sessions(
    conn: &rusqlite::Connection,
    project_id: Option<&str>,
) -> Result<Vec<Session>, AppError> {
    match project_id {
        Some(pid) => Ok(db::sessions::list_by_project(conn, pid)?),
        None => Ok(db::sessions::list_active(conn)?),
    }
}

fn do_get_session(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Session, AppError> {
    db::sessions::get(conn, session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Session {session_id}")))
}

// ── IPC Commands ──

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_task_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    app: AppHandle,
    project_id: String,
    task_id: String,
    agent_name: Option<String>,
    model: Option<String>,
    create_worktree: Option<bool>,
    base_branch: Option<String>,
    user_prompt: Option<String>,
    transport: Option<String>,
) -> Result<Session, AppError> {
    let mcp_port = session::get_mcp_port(&mcp);
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let transport = parse_transport(transport.as_deref());
    let session = match transport {
        SessionTransport::Acp => {
            let opts = AcpTaskSessionOpts {
                task_id: &task_id,
                agent_name: agent_name.as_deref(),
                model: model.as_deref(),
                create_worktree: create_worktree.unwrap_or(true),
                base_branch: base_branch.as_deref(),
                user_prompt: user_prompt.as_deref(),
                is_trust_mode: false,
            };
            session::start_acp_task_session(&conn, &app, &mcp, &acp, mcp_port, &project_id, &opts)?
        }
        SessionTransport::Pty => {
            session::start_task_session(
                &conn,
                &pty,
                &app,
                &mcp,
                mcp_port,
                &project_id,
                &task_id,
                agent_name.as_deref(),
                model.as_deref(),
                create_worktree.unwrap_or(true),
                base_branch.as_deref(),
                user_prompt.as_deref(),
            )?
        }
    };

    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        task_id = %task_id,
        agent = %session.agent,
        model = ?session.model,
        transport = %session.transport,
        mode = "task",
        "Session launched"
    );
    Ok(session)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_vibe_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    app: AppHandle,
    project_id: String,
    agent_name: Option<String>,
    model: Option<String>,
    create_worktree: Option<bool>,
    base_branch: Option<String>,
    user_prompt: Option<String>,
    transport: Option<String>,
) -> Result<Session, AppError> {
    let mcp_port = session::get_mcp_port(&mcp);
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let transport = parse_transport(transport.as_deref());
    let session = match transport {
        SessionTransport::Acp => {
            let opts = AcpVibeSessionOpts {
                agent_name: agent_name.as_deref(),
                model: model.as_deref(),
                create_worktree: create_worktree.unwrap_or(false),
                base_branch: base_branch.as_deref(),
                user_prompt: user_prompt.as_deref(),
            };
            session::start_acp_vibe_session(&conn, &app, &mcp, &acp, mcp_port, &project_id, &opts)?
        }
        SessionTransport::Pty => {
            let opts = VibeSessionOpts {
                agent_name: agent_name.as_deref(),
                model: model.as_deref(),
                create_worktree: create_worktree.unwrap_or(false),
                base_branch: base_branch.as_deref(),
                user_prompt: user_prompt.as_deref(),
            };
            session::start_vibe_session(&conn, &pty, &app, &mcp, mcp_port, &project_id, &opts)?
        }
    };

    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        agent = %session.agent,
        model = ?session.model,
        transport = %session.transport,
        mode = "vibe",
        "Session launched"
    );
    Ok(session)
}

#[tauri::command]
pub fn start_shell_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    app: AppHandle,
    project_id: String,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let session = session::start_shell_session(&conn, &pty, &app, &project_id)?;
    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        mode = "shell",
        "Session launched"
    );
    Ok(session)
}

#[tauri::command]
pub fn start_skill_install_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    app: AppHandle,
    project_id: String,
    source: String,
    skill_name: String,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let session = session::start_skill_install_session(
        &conn, &pty, &app, &project_id, &source, &skill_name,
    )?;
    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        skill_name = %skill_name,
        "Skill install session launched"
    );
    Ok(session)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_research_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    app: AppHandle,
    project_id: String,
    task_id: String,
    agent_name: Option<String>,
    model: Option<String>,
    user_prompt: Option<String>,
    transport: Option<String>,
) -> Result<Session, AppError> {
    let mcp_port = session::get_mcp_port(&mcp);
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let transport = parse_transport(transport.as_deref());
    let session = match transport {
        SessionTransport::Acp => {
            let opts = AcpResearchSessionOpts {
                task_id: &task_id,
                agent_name: agent_name.as_deref(),
                model: model.as_deref(),
                user_prompt: user_prompt.as_deref(),
            };
            session::start_acp_research_session(&conn, &app, &mcp, &acp, mcp_port, &project_id, &opts)?
        }
        SessionTransport::Pty => {
            let opts = ResearchSessionOpts {
                task_id: &task_id,
                agent_name: agent_name.as_deref(),
                model: model.as_deref(),
                user_prompt: user_prompt.as_deref(),
            };
            session::start_research_session(&conn, &pty, &app, &mcp, mcp_port, &project_id, &opts)?
        }
    };

    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        task_id = %task_id,
        agent = %session.agent,
        model = ?session.model,
        transport = %session.transport,
        mode = "research",
        "Session launched"
    );
    Ok(session)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn start_chat_session(
    db: State<'_, DbState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    app: AppHandle,
    project_id: String,
    agent_name: Option<String>,
    model: Option<String>,
    user_prompt: Option<String>,
) -> Result<Session, AppError> {
    tracing::info!(
        project_id = %project_id,
        agent_name = ?agent_name,
        model = ?model,
        "start_chat_session command invoked"
    );
    let mcp_port = session::get_mcp_port(&mcp);
    let conn = db.lock().map_err(|e| {
        tracing::error!(error = %e, "Failed to lock DB for chat session");
        AppError::Database(e.to_string())
    })?;

    let opts = AcpChatSessionOpts {
        agent_name: agent_name.as_deref(),
        model: model.as_deref(),
        user_prompt: user_prompt.as_deref(),
    };
    let session = session::start_acp_chat_session(&conn, &app, &mcp, &acp, mcp_port, &project_id, &opts)
        .map_err(|e| {
            tracing::error!(project_id = %project_id, error = %e, "Failed to start chat session");
            e
        })?;

    tracing::info!(
        session_id = %session.id,
        project_id = %project_id,
        agent = %session.agent,
        model = ?session.model,
        transport = %session.transport,
        mode = "chat",
        "Chat session launched"
    );
    Ok(session)
}

#[tauri::command]
pub fn relaunch_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    app: AppHandle,
    session_id: String,
) -> Result<Session, AppError> {
    let mcp_port = session::get_mcp_port(&mcp);
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let session = session::relaunch_session(&conn, &pty, &app, &mcp, Some(&acp), mcp_port, &session_id)?;
    tracing::info!(session_id = %session.id, mode = %session.mode, "Session relaunched");
    Ok(session)
}

#[tauri::command]
pub fn stop_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    app: AppHandle,
    session_id: String,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let session = session::stop_session(&conn, &pty, &app, &mcp, Some(&acp), &session_id)?;
    tracing::info!(session_id = %session_id, "Session stopped");
    Ok(session)
}

#[tauri::command]
pub fn stop_and_remove_session(
    db: State<'_, DbState>,
    pty: State<'_, PtyState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    acp: State<'_, AcpState>,
    app: AppHandle,
    session_id: String,
) -> Result<(), AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    session::stop_and_remove_session(&conn, &pty, &app, &mcp, Some(&acp), &session_id)?;
    tracing::info!(session_id = %session_id, "Session stopped and removed");
    Ok(())
}

#[tauri::command]
pub fn rename_session(
    db: State<'_, DbState>,
    session_id: String,
    name: Option<String>,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::sessions::update_name(&conn, &session_id, name.as_deref())?;
    db::sessions::get(&conn, &session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Session {session_id}")))
}

#[tauri::command]
pub fn remove_session(
    db: State<'_, DbState>,
    session_id: String,
) -> Result<bool, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let deleted = db::sessions::delete(&conn, &session_id)?;
    if deleted {
        tracing::info!(session_id = %session_id, "Session removed");
    }
    Ok(deleted)
}

#[tauri::command]
pub fn list_sessions(
    db: State<'_, DbState>,
    project_id: Option<String>,
) -> Result<Vec<Session>, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    do_list_sessions(&conn, project_id.as_deref())
}

#[tauri::command]
pub fn get_session(
    db: State<'_, DbState>,
    session_id: String,
) -> Result<Session, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    do_get_session(&conn, &session_id)
}

// ── ACP session commands ──

/// An attachment sent from the frontend alongside a text message.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AttachmentPayload {
    /// Base64-encoded data (without the `data:...;base64,` prefix) or a data URL.
    pub data: String,
    /// MIME type (e.g., "image/png", "text/plain", "application/octet-stream").
    pub mime_type: String,
    /// Original filename.
    pub filename: String,
    /// Kind of attachment: "image" or "file".
    pub kind: String,
}

/// Build ACP `ContentBlock` list from text + optional attachments.
///
/// Respects agent capabilities: images require `capabilities.image`,
/// file resources require `capabilities.embedded_context`.
fn build_content_blocks(
    text: &str,
    attachments: &[AttachmentPayload],
) -> Vec<agent_client_protocol::ContentBlock> {
    use agent_client_protocol as acp;

    let mut blocks = Vec::new();

    // Always include the text block first
    if !text.is_empty() {
        blocks.push(acp::ContentBlock::Text(acp::TextContent::new(text)));
    }

    for att in attachments {
        // Extract raw base64 from data URL if needed (strip "data:...;base64," prefix)
        let base64_data = if let Some(pos) = att.data.find(";base64,") {
            att.data[pos + 8..].to_string()
        } else {
            att.data.clone()
        };

        if att.kind == "image" || att.mime_type.starts_with("image/") {
            blocks.push(acp::ContentBlock::Image(
                acp::ImageContent::new(&base64_data, &att.mime_type),
            ));
        } else if att.mime_type.starts_with("text/") || is_text_mime(&att.mime_type) {
            // Decode base64 text content and send as embedded text resource
            if let Ok(decoded) = base64_decode_to_string(&base64_data) {
                blocks.push(acp::ContentBlock::Resource(
                    acp::EmbeddedResource::new(
                        acp::EmbeddedResourceResource::TextResourceContents(
                            acp::TextResourceContents::new(
                                format!("file:///{}", att.filename),
                                decoded,
                            ),
                        ),
                    ),
                ));
            } else {
                // Fallback: send as blob resource
                blocks.push(acp::ContentBlock::Resource(
                    acp::EmbeddedResource::new(
                        acp::EmbeddedResourceResource::BlobResourceContents(
                            acp::BlobResourceContents::new(
                                format!("file:///{}", att.filename),
                                base64_data,
                            )
                            .mime_type(att.mime_type.clone()),
                        ),
                    ),
                ));
            }
        } else {
            // Binary file — send as blob resource
            blocks.push(acp::ContentBlock::Resource(
                acp::EmbeddedResource::new(
                    acp::EmbeddedResourceResource::BlobResourceContents(
                        acp::BlobResourceContents::new(
                            format!("file:///{}", att.filename),
                            base64_data,
                        )
                        .mime_type(att.mime_type.clone()),
                    ),
                ),
            ));
        }
    }

    // If no text and no attachments, add empty text block as fallback
    if blocks.is_empty() {
        blocks.push(acp::ContentBlock::Text(acp::TextContent::new(text)));
    }

    blocks
}

/// Check if a MIME type represents text content (beyond just text/*).
fn is_text_mime(mime: &str) -> bool {
    mime.starts_with("text/")
        || mime == "application/json"
        || mime == "application/xml"
        || mime == "application/javascript"
        || mime == "application/typescript"
        || mime == "application/x-yaml"
        || mime == "application/toml"
        || mime.ends_with("+json")
        || mime.ends_with("+xml")
}

/// Decode base64 to a UTF-8 string.
fn base64_decode_to_string(b64: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn send_acp_message(
    acp: State<'_, AcpState>,
    app: AppHandle,
    session_id: String,
    text: String,
    attachments: Option<Vec<AttachmentPayload>>,
) -> Result<(), AppError> {
    use crate::acp::types::{AcpPromptCompletePayload, AcpErrorPayload, EVENT_ACP_PROMPT_COMPLETE, EVENT_ACP_ERROR};

    // Verify the session exists and has been initialized
    {
        let state = acp.blocking_lock();
        let session_state = state.get(&session_id)
            .ok_or_else(|| AppError::NotFound(format!("ACP session {session_id}")))?;
        if session_state.acp_session_id.is_none() {
            return Err(AppError::Validation("ACP session not yet initialized".into()));
        }
    }

    let attachments = attachments.unwrap_or_default();

    // Spawn prompt in a background thread with LocalSet (ACP uses !Send futures)
    // IMPORTANT: Do NOT hold the ACP state mutex during prompt() — see session.rs comment.
    let acp_state = acp.inner().clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build tokio runtime for ACP message");

        let local = tokio::task::LocalSet::new();
        local.block_on(&rt, async move {
            // Take session out of state map (releases mutex before prompt)
            let mut session_state = {
                let mut state = acp_state.lock().await;
                state.remove(&session_id)
            };
            if let Some(ref mut ss) = session_state {
                if let Some(acp_sid) = ss.acp_session_id.clone() {
                    let content = build_content_blocks(&text, &attachments);

                    tracing::info!(
                        session_id = %session_id,
                        text_len = text.len(),
                        attachment_count = attachments.len(),
                        content_blocks = content.len(),
                        "Sending ACP message with attachments"
                    );

                    match ss.client.prompt(acp_sid, content).await {
                        Ok(response) => {
                            let stop_reason = format!("{:?}", response.stop_reason);
                            tracing::info!(
                                session_id = %session_id,
                                stop_reason = %stop_reason,
                                "ACP follow-up prompt completed"
                            );
                            // Emit prompt-complete so the frontend clears promptPending
                            let _ = app.emit(EVENT_ACP_PROMPT_COMPLETE, AcpPromptCompletePayload {
                                session_id: session_id.clone(),
                                stop_reason,
                            });
                        }
                        Err(e) => {
                            tracing::error!(session_id = %session_id, error = %e, "ACP follow-up prompt failed");
                            // Emit error so the frontend clears promptPending
                            let _ = app.emit(EVENT_ACP_ERROR, AcpErrorPayload {
                                session_id: session_id.clone(),
                                error: e.to_string(),
                            });
                        }
                    }
                }
                // Put session back into state map
                let mut state = acp_state.lock().await;
                state.insert(session_id, session_state.take().unwrap());
            }
        });
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_acp_session(
    acp: State<'_, AcpState>,
    session_id: String,
) -> Result<(), AppError> {
    let acp_state = acp.inner().clone();
    let session_id_clone = session_id.clone();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build tokio runtime for ACP cancel");

        let local = tokio::task::LocalSet::new();
        local.block_on(&rt, async move {
            let state = acp_state.lock().await;
            if let Some(session_state) = state.get(&session_id_clone) {
                if let Some(acp_sid) = session_state.acp_session_id.clone() {
                    let _ = session_state.client.cancel(acp_sid).await;
                    tracing::info!(session_id = %session_id_clone, "ACP session cancelled");
                }
            }
        });
    });

    Ok(())
}

#[tauri::command]
pub fn stop_acp_session(
    app: AppHandle,
    db: State<'_, DbState>,
    acp: State<'_, AcpState>,
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
    session_id: String,
) -> Result<(), AppError> {
    // Use the session::shutdown_acp_session helper (spawns background thread)
    session::shutdown_acp_client(&acp, &session_id, Some(&app));

    // Clean up MCP session data
    {
        let mut guard = mcp.blocking_lock();
        guard.sessions.remove(&session_id);
    }

    // Update DB status
    {
        let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let _ = db::sessions::update_status(&conn, &session_id, crate::db::models::SessionStatus::Stopped);
    }

    tracing::info!(session_id = %session_id, "ACP session stopped");
    Ok(())
}

/// Get agent capabilities for an ACP session.
/// Returns a simplified capabilities object for the frontend.
#[tauri::command]
pub async fn get_acp_capabilities(
    acp: State<'_, AcpState>,
    session_id: String,
) -> Result<AcpCapabilitiesResponse, AppError> {
    let state = acp.lock().await;
    if let Some(session_state) = state.get(&session_id) {
        let caps = session_state.client.agent_capabilities.as_ref();
        Ok(AcpCapabilitiesResponse {
            image: caps.map(|c| c.prompt_capabilities.image).unwrap_or(false),
            audio: caps.map(|c| c.prompt_capabilities.audio).unwrap_or(false),
            embedded_context: caps.map(|c| c.prompt_capabilities.embedded_context).unwrap_or(false),
        })
    } else {
        // Session not found or not ACP — return defaults
        Ok(AcpCapabilitiesResponse::default())
    }
}

/// Set the session mode for an ACP session (e.g., "code", "architect", "ask").
#[tauri::command]
pub fn set_acp_mode(
    acp: State<'_, AcpState>,
    app: AppHandle,
    session_id: String,
    mode_id: String,
) -> Result<(), AppError> {
    use crate::acp::types::{AcpModeUpdatePayload, EVENT_ACP_MODE_UPDATE};

    let acp_state = acp.inner().clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build tokio runtime for ACP set_mode");

        let local = tokio::task::LocalSet::new();
        local.block_on(&rt, async move {
            let state = acp_state.lock().await;
            if let Some(session_state) = state.get(&session_id) {
                if let Some(acp_sid) = session_state.acp_session_id.clone() {
                    match session_state.client.set_mode(acp_sid, mode_id.clone()).await {
                        Ok(_response) => {
                            // Emit the mode update so frontend state stays in sync
                            // The response doesn't carry the mode ID back, use what we requested
                            let _ = app.emit(EVENT_ACP_MODE_UPDATE, AcpModeUpdatePayload {
                                session_id: session_id.clone(),
                                mode: mode_id.clone(),
                            });
                            tracing::info!(session_id = %session_id, mode_id = %mode_id, "ACP mode set");
                        }
                        Err(e) => {
                            tracing::error!(session_id = %session_id, error = %e, "ACP set_mode failed");
                        }
                    }
                }
            }
        });
    });

    Ok(())
}

/// Set a configuration option value for an ACP session.
#[tauri::command]
pub fn set_acp_config_option(
    acp: State<'_, AcpState>,
    app: AppHandle,
    session_id: String,
    config_id: String,
    value: String,
) -> Result<(), AppError> {
    use crate::acp::types::{AcpConfigOptionUpdatePayload, EVENT_ACP_CONFIG_OPTION_UPDATE};
    use crate::acp::handler::convert_config_option_public;

    let acp_state = acp.inner().clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build tokio runtime for ACP set_config_option");

        let local = tokio::task::LocalSet::new();
        local.block_on(&rt, async move {
            let state = acp_state.lock().await;
            if let Some(session_state) = state.get(&session_id) {
                if let Some(acp_sid) = session_state.acp_session_id.clone() {
                    match session_state.client.set_config_option(acp_sid, config_id.clone(), value.clone()).await {
                        Ok(response) => {
                            // The response contains the updated config options — emit them
                            let config_options: Vec<crate::acp::types::AcpConfigOption> = response
                                .config_options
                                .iter()
                                .map(convert_config_option_public)
                                .collect();
                            let _ = app.emit(EVENT_ACP_CONFIG_OPTION_UPDATE, AcpConfigOptionUpdatePayload {
                                session_id: session_id.clone(),
                                config_options,
                            });
                            tracing::info!(
                                session_id = %session_id,
                                config_id = %config_id,
                                value = %value,
                                "ACP config option set"
                            );
                        }
                        Err(e) => {
                            tracing::error!(
                                session_id = %session_id,
                                error = %e,
                                "ACP set_config_option failed"
                            );
                        }
                    }
                }
            }
        });
    });

    Ok(())
}

/// Get buffered terminal output for an ACP-managed terminal.
///
/// Returns combined stdout + stderr output accumulated by the terminal.
/// The `terminal_id` is obtained from `ToolCallContentItem::Terminal` events.
#[tauri::command]
pub async fn get_acp_terminal_output(
    acp: State<'_, AcpState>,
    session_id: String,
    terminal_id: String,
) -> Result<AcpTerminalOutputResponse, AppError> {
    let state = acp.lock().await;
    let session_state = state
        .get(&session_id)
        .ok_or_else(|| AppError::NotFound(format!("ACP session {session_id}")))?;

    let terminals = session_state.client.terminals();
    match crate::acp::capabilities::terminal_output(terminals, &terminal_id).await {
        Ok((stdout, stderr)) => {
            let output = if stderr.is_empty() {
                stdout
            } else if stdout.is_empty() {
                stderr
            } else {
                format!("{stdout}{stderr}")
            };
            Ok(AcpTerminalOutputResponse { output })
        }
        Err(e) => Err(AppError::Io(e)),
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AcpTerminalOutputResponse {
    pub output: String,
}

#[derive(Default, Debug, Clone, serde::Serialize)]
pub struct AcpCapabilitiesResponse {
    pub image: bool,
    pub audio: bool,
    pub embedded_context: bool,
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::models::{NewProject, NewSession, SessionMode, SessionTransport};

    fn setup() -> (rusqlite::Connection, String) {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        let p = db::projects::create(
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
        (conn, p.id)
    }

    #[test]
    fn list_sessions_by_project() {
        let (conn, pid) = setup();
        db::sessions::create(
            &conn,
            &NewSession {
                project_id: pid.clone(),
                task_id: None,
                name: None,
                mode: SessionMode::Vibe,
                transport: SessionTransport::Pty,
                agent: "claude-code".into(),
                model: None,
                worktree_path: None,
            },
        )
        .unwrap();

        let sessions = do_list_sessions(&conn, Some(&pid)).unwrap();
        assert_eq!(sessions.len(), 1);

        let sessions = do_list_sessions(&conn, Some("nonexistent")).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn list_sessions_active() {
        let (conn, pid) = setup();
        let s = db::sessions::create(
            &conn,
            &NewSession {
                project_id: pid.clone(),
                task_id: None,
                name: None,
                mode: SessionMode::Task,
                transport: SessionTransport::Pty,
                agent: "claude-code".into(),
                model: None,
                worktree_path: None,
            },
        )
        .unwrap();

        // Active sessions (status: starting)
        let sessions = do_list_sessions(&conn, None).unwrap();
        assert_eq!(sessions.len(), 1);

        // Stop it
        db::sessions::update_status(&conn, &s.id, crate::db::models::SessionStatus::Stopped)
            .unwrap();
        let sessions = do_list_sessions(&conn, None).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn get_session_found_and_not_found() {
        let (conn, pid) = setup();
        let s = db::sessions::create(
            &conn,
            &NewSession {
                project_id: pid,
                task_id: None,
                name: None,
                mode: SessionMode::Vibe,
                transport: SessionTransport::Pty,
                agent: "claude-code".into(),
                model: None,
                worktree_path: None,
            },
        )
        .unwrap();

        let fetched = do_get_session(&conn, &s.id).unwrap();
        assert_eq!(fetched.id, s.id);

        let result = do_get_session(&conn, "nonexistent");
        assert!(result.is_err());
    }
}
