//! ACP Client trait implementation for Faber.
//!
//! `FaberAcpHandler` implements the `agent_client_protocol::Client` trait,
//! which defines how Faber responds to agent requests (file operations,
//! terminal management) and receives session notifications (message chunks,
//! tool calls, plans).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use agent_client_protocol as acp;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex as TokioMutex};
use tracing::{debug, error, info, warn};

use super::capabilities::{self, ManagedTerminals};
use super::permissions::{self, PermissionAction, PermissionContext, PermissionDecision, CapabilityType};
use super::types::*;
use crate::db::DbState;

/// Shared map of pending permission requests awaiting user response.
/// Key: request_id, Value: oneshot sender to resolve the pending future.
pub type PendingPermissions = Arc<TokioMutex<HashMap<String, oneshot::Sender<bool>>>>;

/// Create a new empty pending permissions map.
pub fn new_pending_permissions() -> PendingPermissions {
    Arc::new(TokioMutex::new(HashMap::new()))
}

/// Faber's implementation of the ACP `Client` trait.
///
/// Each `FaberAcpHandler` is bound to a single Faber session. It holds
/// the `AppHandle` for emitting Tauri events to the frontend, the session
/// ID for event routing, and the working directory for file operations.
pub struct FaberAcpHandler {
    /// Tauri app handle for emitting events to the frontend.
    pub app_handle: AppHandle,
    /// Faber session ID (used for event routing to the correct UI pane).
    pub session_id: String,
    /// Project ID (for permission rule lookups).
    pub project_id: String,
    /// Working directory (worktree path or project root).
    pub cwd: PathBuf,
    /// Managed terminal processes spawned on behalf of the agent.
    pub terminals: ManagedTerminals,
    /// Whether this session is running in trust mode (autonomous permission handling).
    pub is_trust_mode: bool,
    /// Pending permission requests awaiting user response.
    pub pending_permissions: PendingPermissions,
}

impl FaberAcpHandler {
    /// Create a new handler for a specific session.
    pub fn new(
        app_handle: AppHandle,
        session_id: String,
        project_id: String,
        cwd: PathBuf,
        is_trust_mode: bool,
        pending_permissions: PendingPermissions,
    ) -> Self {
        Self {
            app_handle,
            session_id,
            project_id,
            cwd,
            terminals: capabilities::new_managed_terminals(),
            is_trust_mode,
            pending_permissions,
        }
    }

    /// Emit a Tauri event, logging any failures.
    fn emit<S: serde::Serialize + Clone>(&self, event: &str, payload: S) {
        if let Err(e) = self.app_handle.emit(event, payload) {
            error!(event = %event, session_id = %self.session_id, error = %e, "Failed to emit ACP event");
        }
    }

    /// Classify an ACP permission request into a capability type and detail string.
    fn classify_permission(&self, args: &acp::RequestPermissionRequest) -> (CapabilityType, String) {
        // Try to infer capability from the permission description/options
        let description = args.options.first()
            .map(|o| o.name.as_str())
            .unwrap_or("");

        let desc_lower = description.to_lowercase();

        if desc_lower.contains("read") && (desc_lower.contains("file") || desc_lower.contains("path")) {
            let detail = extract_path_from_description(description);
            (CapabilityType::FsRead, detail)
        } else if desc_lower.contains("write") || desc_lower.contains("edit") || desc_lower.contains("create") || desc_lower.contains("modify") {
            let detail = extract_path_from_description(description);
            (CapabilityType::FsWrite, detail)
        } else if desc_lower.contains("terminal") || desc_lower.contains("command") || desc_lower.contains("execute") || desc_lower.contains("run") || desc_lower.contains("shell") {
            (CapabilityType::Terminal, description.to_string())
        } else {
            (CapabilityType::Other(description.to_string()), description.to_string())
        }
    }

    /// Evaluate permission using the policy engine.
    /// Returns the action to take and whether to log the decision.
    fn evaluate_permission(&self, capability: &CapabilityType, detail: &str) -> PermissionAction {
        let ctx = PermissionContext {
            project_id: self.project_id.clone(),
            session_id: self.session_id.clone(),
            capability: capability.clone(),
            detail: detail.to_string(),
            is_trust_mode: self.is_trust_mode,
        };

        // Access DB via Tauri managed state
        let db_state: tauri::State<'_, DbState> = self.app_handle.state();
        let result = match db_state.lock() {
            Ok(conn) => permissions::evaluate(&conn, &ctx),
            Err(e) => {
                warn!(error = %e, "Failed to lock DB for permission evaluation, defaulting to ask");
                PermissionAction::Ask
            }
        };
        result
    }

    /// Log a permission decision to the database.
    fn log_permission(&self, capability: &str, detail: &str, decision: &PermissionDecision) {
        let db_state: tauri::State<'_, DbState> = self.app_handle.state();
        match db_state.lock() {
            Ok(conn) => {
                permissions::log_decision(
                    &conn,
                    &self.session_id,
                    &self.project_id,
                    capability,
                    detail,
                    decision,
                );
            }
            Err(e) => {
                warn!(error = %e, "Failed to lock DB for permission logging");
            }
        };
    }

    /// Route a `SessionUpdate` notification to the appropriate Tauri event.
    fn route_session_update(&self, session_id: &acp::SessionId, update: acp::SessionUpdate) {
        let sid = session_id.to_string();

        match update {
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                let text = extract_text_from_content_block(&chunk.content);
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    text_len = text.len(),
                    text_preview = %truncate_for_log(&text, 120),
                    "ACP ← AgentMessageChunk"
                );
                self.emit(
                    EVENT_ACP_MESSAGE_CHUNK,
                    AcpMessageChunkPayload {
                        session_id: self.session_id.clone(),
                        text,
                    },
                );
            }

            acp::SessionUpdate::ToolCall(tool_call) => {
                let kind_str = normalize_acp_enum(&format!("{:?}", tool_call.kind));
                let status_str = normalize_acp_enum(&format!("{:?}", tool_call.status));
                let content_items = convert_tool_call_content(&tool_call.content);
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    tool_call_id = %tool_call.tool_call_id,
                    title = %tool_call.title,
                    kind = %kind_str,
                    status = %status_str,
                    content_count = content_items.len(),
                    "ACP ← ToolCall"
                );
                self.emit(
                    EVENT_ACP_TOOL_CALL,
                    AcpToolCallPayload {
                        session_id: self.session_id.clone(),
                        tool_call_id: tool_call.tool_call_id.to_string(),
                        title: tool_call.title.clone(),
                        kind: kind_str,
                        status: status_str,
                        content: content_items,
                    },
                );
            }

            acp::SessionUpdate::ToolCallUpdate(update) => {
                let status_str = update
                    .fields
                    .status
                    .as_ref()
                    .map(|s| normalize_acp_enum(&format!("{:?}", s)))
                    .unwrap_or_default();
                let content_items = update
                    .fields
                    .content
                    .as_ref()
                    .map(|c| convert_tool_call_content(c));
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    tool_call_id = %update.tool_call_id,
                    status = %status_str,
                    title = ?update.fields.title,
                    content_count = content_items.as_ref().map(|c| c.len()).unwrap_or(0),
                    "ACP ← ToolCallUpdate"
                );
                self.emit(
                    EVENT_ACP_TOOL_CALL_UPDATE,
                    AcpToolCallUpdatePayload {
                        session_id: self.session_id.clone(),
                        tool_call_id: update.tool_call_id.to_string(),
                        status: status_str,
                        title: update.fields.title.clone(),
                        content: content_items,
                    },
                );
            }

            acp::SessionUpdate::Plan(plan) => {
                let entry_count = plan.entries.len();
                let entries: Vec<AcpPlanEntry> = plan
                    .entries
                    .iter()
                    .enumerate()
                    .map(|(i, e)| AcpPlanEntry {
                        id: format!("{}", i),
                        title: e.content.clone(),
                        status: normalize_acp_enum(&format!("{:?}", e.status)),
                    })
                    .collect();
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    entry_count = entry_count,
                    "ACP ← Plan"
                );
                self.emit(
                    EVENT_ACP_PLAN_UPDATE,
                    AcpPlanUpdatePayload {
                        session_id: self.session_id.clone(),
                        entries,
                    },
                );
            }

            acp::SessionUpdate::CurrentModeUpdate(mode_update) => {
                let mode = mode_update.current_mode_id.to_string();
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    mode = %mode,
                    "ACP ← CurrentModeUpdate"
                );
                self.emit(
                    EVENT_ACP_MODE_UPDATE,
                    AcpModeUpdatePayload {
                        session_id: self.session_id.clone(),
                        mode,
                    },
                );
            }

            acp::SessionUpdate::SessionInfoUpdate(info_update) => {
                // MaybeUndefined -> Option conversion
                let title = match &info_update.title {
                    acp::MaybeUndefined::Value(t) => Some(t.clone()),
                    acp::MaybeUndefined::Null => None,
                    acp::MaybeUndefined::Undefined => None,
                };
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    title = ?title,
                    "ACP ← SessionInfoUpdate"
                );
                self.emit(
                    EVENT_ACP_SESSION_INFO,
                    AcpSessionInfoPayload {
                        session_id: self.session_id.clone(),
                        title,
                    },
                );
            }

            acp::SessionUpdate::AgentThoughtChunk(chunk) => {
                let text = extract_text_from_content_block(&chunk.content);
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    text_len = text.len(),
                    text_preview = %truncate_for_log(&text, 120),
                    "ACP ← AgentThoughtChunk"
                );
                self.emit(
                    EVENT_ACP_THOUGHT_CHUNK,
                    AcpMessageChunkPayload {
                        session_id: self.session_id.clone(),
                        text,
                    },
                );
            }

            acp::SessionUpdate::UserMessageChunk(chunk) => {
                let text = extract_text_from_content_block(&chunk.content);
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    text_len = text.len(),
                    "ACP ← UserMessageChunk"
                );
            }

            acp::SessionUpdate::AvailableCommandsUpdate(cmds) => {
                let commands: Vec<AcpAvailableCommand> = cmds
                    .available_commands
                    .iter()
                    .map(|cmd| {
                        let input_hint = cmd.input.as_ref().and_then(|input| {
                            match input {
                                acp::AvailableCommandInput::Unstructured(u) => Some(u.hint.clone()),
                                _ => None,
                            }
                        });
                        AcpAvailableCommand {
                            name: cmd.name.clone(),
                            description: cmd.description.clone(),
                            input_hint,
                        }
                    })
                    .collect();
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    command_count = commands.len(),
                    "ACP ← AvailableCommandsUpdate"
                );
                self.emit(
                    EVENT_ACP_AVAILABLE_COMMANDS,
                    AcpAvailableCommandsPayload {
                        session_id: self.session_id.clone(),
                        commands,
                    },
                );
            }

            acp::SessionUpdate::ConfigOptionUpdate(cfg) => {
                let config_options: Vec<AcpConfigOption> = cfg
                    .config_options
                    .iter()
                    .map(|opt| convert_config_option(opt))
                    .collect();
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    option_count = config_options.len(),
                    "ACP ← ConfigOptionUpdate"
                );
                self.emit(
                    EVENT_ACP_CONFIG_OPTION_UPDATE,
                    AcpConfigOptionUpdatePayload {
                        session_id: self.session_id.clone(),
                        config_options,
                    },
                );
            }

            acp::SessionUpdate::UsageUpdate(usage) => {
                let (cost_amount, cost_currency) = usage
                    .cost
                    .as_ref()
                    .map(|c| (Some(c.amount), Some(c.currency.clone())))
                    .unwrap_or((None, None));
                info!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    used = usage.used,
                    size = usage.size,
                    cost = ?usage.cost,
                    "ACP ← UsageUpdate"
                );
                self.emit(
                    EVENT_ACP_USAGE_UPDATE,
                    AcpUsageUpdatePayload {
                        session_id: self.session_id.clone(),
                        used: usage.used,
                        size: usage.size,
                        cost_amount,
                        cost_currency,
                    },
                );
            }

            // Catch-all for future variants (non_exhaustive)
            _ => {
                warn!(
                    session_id = %self.session_id,
                    acp_session = %sid,
                    "ACP ← Unknown session update variant"
                );
            }
        }
    }
}

#[async_trait::async_trait(?Send)]
impl acp::Client for FaberAcpHandler {
    // ── Required Methods ──

    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        // 1. Classify the permission request
        let (capability, detail) = self.classify_permission(&args);
        let capability_str = capability.as_str().to_string();

        // 2. Evaluate against policy engine
        let action = self.evaluate_permission(&capability, &detail);

        // Find allow/deny options from the ACP request
        let allow_option = args.options.iter().find(|o| {
            matches!(
                o.kind,
                acp::PermissionOptionKind::AllowOnce | acp::PermissionOptionKind::AllowAlways
            )
        });
        let deny_option = args.options.iter().find(|o| {
            matches!(
                o.kind,
                acp::PermissionOptionKind::RejectOnce | acp::PermissionOptionKind::RejectAlways
            )
        });

        match action {
            PermissionAction::AutoApprove => {
                info!(
                    session_id = %self.session_id,
                    capability = %capability_str,
                    detail = %detail,
                    "ACP permission auto-approved"
                );
                self.log_permission(&capability_str, &detail, &PermissionDecision::AutoApproved);

                let selected = allow_option
                    .or(args.options.first())
                    .map(|o| o.option_id.clone());

                match selected {
                    Some(option_id) => Ok(acp::RequestPermissionResponse::new(
                        acp::RequestPermissionOutcome::Selected(
                            acp::SelectedPermissionOutcome::new(option_id),
                        ),
                    )),
                    None => Ok(acp::RequestPermissionResponse::new(
                        acp::RequestPermissionOutcome::Cancelled,
                    )),
                }
            }

            PermissionAction::Deny => {
                info!(
                    session_id = %self.session_id,
                    capability = %capability_str,
                    detail = %detail,
                    "ACP permission auto-denied"
                );
                self.log_permission(&capability_str, &detail, &PermissionDecision::AutoDenied);

                let selected = deny_option.map(|o| o.option_id.clone());

                match selected {
                    Some(option_id) => Ok(acp::RequestPermissionResponse::new(
                        acp::RequestPermissionOutcome::Selected(
                            acp::SelectedPermissionOutcome::new(option_id),
                        ),
                    )),
                    None => Ok(acp::RequestPermissionResponse::new(
                        acp::RequestPermissionOutcome::Cancelled,
                    )),
                }
            }

            PermissionAction::Ask => {
                // 3. Emit event to frontend and wait for user response
                let request_id = crate::db::generate_id("perm_req");

                // Build option descriptions for the dialog
                let options: Vec<AcpPermissionOption> = args.options.iter().map(|o| {
                    AcpPermissionOption {
                        option_id: o.option_id.to_string(),
                        name: o.name.clone(),
                        kind: format!("{:?}", o.kind),
                        description: None,
                    }
                }).collect();

                info!(
                    session_id = %self.session_id,
                    request_id = %request_id,
                    capability = %capability_str,
                    detail = %detail,
                    "ACP permission request — asking user"
                );

                // Create oneshot channel for the response
                let (tx, rx) = oneshot::channel();
                {
                    let mut pending = self.pending_permissions.lock().await;
                    pending.insert(request_id.clone(), tx);
                }

                // Emit the permission request event to the frontend
                self.emit(
                    EVENT_ACP_PERMISSION_REQUEST,
                    AcpPermissionRequestPayload {
                        session_id: self.session_id.clone(),
                        request_id: request_id.clone(),
                        capability: capability_str.clone(),
                        detail: detail.clone(),
                        description: args.options.first()
                            .map(|o| o.name.clone())
                            .unwrap_or_default(),
                        options,
                    },
                );

                // Read configurable timeout from settings (default 120s)
                // Settings are stored in global scope with key "acp_permission_timeout_<projectId>"
                let timeout_secs = {
                    let db_state: tauri::State<'_, DbState> = self.app_handle.state();
                    let key = format!("acp_permission_timeout_{}", self.project_id);
                    db_state.lock().ok()
                        .and_then(|conn| {
                            crate::db::settings::get_value(&conn, "global", None, &key).ok()
                        })
                        .flatten()
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(120)
                };

                // Add a grace period so the backend timeout doesn't race with
                // the frontend countdown. The frontend shows the exact timeout
                // to the user; the backend waits a few extra seconds to allow
                // for IPC latency and lock contention.
                const GRACE_PERIOD_SECS: u64 = 5;

                // Wait for user response (with timeout + grace period)
                let approved = match tokio::time::timeout(
                    std::time::Duration::from_secs(timeout_secs + GRACE_PERIOD_SECS),
                    rx,
                ).await {
                    Ok(Ok(approved)) => approved,
                    Ok(Err(_)) => {
                        // Channel was dropped (session ended)
                        warn!(session_id = %self.session_id, request_id = %request_id, "Permission channel dropped");
                        false
                    }
                    Err(_) => {
                        // Timeout — auto-deny
                        warn!(session_id = %self.session_id, request_id = %request_id, "Permission request timed out, auto-denying");
                        // Clean up pending request
                        let mut pending = self.pending_permissions.lock().await;
                        pending.remove(&request_id);

                        // Emit timeout event
                        self.emit(
                            EVENT_ACP_PERMISSION_RESPONSE,
                            AcpPermissionResponsePayload {
                                session_id: self.session_id.clone(),
                                request_id: request_id.clone(),
                                approved: false,
                                timed_out: true,
                            },
                        );
                        false
                    }
                };

                if approved {
                    self.log_permission(&capability_str, &detail, &PermissionDecision::Approved);
                    let selected = allow_option
                        .or(args.options.first())
                        .map(|o| o.option_id.clone());

                    match selected {
                        Some(option_id) => Ok(acp::RequestPermissionResponse::new(
                            acp::RequestPermissionOutcome::Selected(
                                acp::SelectedPermissionOutcome::new(option_id),
                            ),
                        )),
                        None => Ok(acp::RequestPermissionResponse::new(
                            acp::RequestPermissionOutcome::Cancelled,
                        )),
                    }
                } else {
                    self.log_permission(&capability_str, &detail, &PermissionDecision::Denied);
                    let selected = deny_option.map(|o| o.option_id.clone());

                    match selected {
                        Some(option_id) => Ok(acp::RequestPermissionResponse::new(
                            acp::RequestPermissionOutcome::Selected(
                                acp::SelectedPermissionOutcome::new(option_id),
                            ),
                        )),
                        None => Ok(acp::RequestPermissionResponse::new(
                            acp::RequestPermissionOutcome::Cancelled,
                        )),
                    }
                }
            }
        }
    }

    async fn session_notification(
        &self,
        args: acp::SessionNotification,
    ) -> acp::Result<()> {
        debug!(
            session_id = %self.session_id,
            acp_session = %args.session_id,
            "ACP session_notification received"
        );
        self.route_session_update(&args.session_id, args.update);
        Ok(())
    }

    // ── Filesystem Capabilities ──

    async fn read_text_file(
        &self,
        args: acp::ReadTextFileRequest,
    ) -> acp::Result<acp::ReadTextFileResponse> {
        let path_str = args.path.to_string_lossy().to_string();
        debug!(session_id = %self.session_id, path = %path_str, "ACP read_text_file");

        match capabilities::read_text_file(&self.cwd, &path_str).await {
            Ok(content) => Ok(acp::ReadTextFileResponse::new(content)),
            Err(e) => {
                warn!(session_id = %self.session_id, path = %path_str, error = %e, "ACP read_text_file failed");
                Err(acp::Error::internal_error().data(e))
            }
        }
    }

    async fn write_text_file(
        &self,
        args: acp::WriteTextFileRequest,
    ) -> acp::Result<acp::WriteTextFileResponse> {
        let path_str = args.path.to_string_lossy().to_string();
        debug!(session_id = %self.session_id, path = %path_str, "ACP write_text_file");

        match capabilities::write_text_file(&self.cwd, &path_str, &args.content).await {
            Ok(()) => Ok(acp::WriteTextFileResponse::new()),
            Err(e) => {
                warn!(session_id = %self.session_id, path = %path_str, error = %e, "ACP write_text_file failed");
                Err(acp::Error::internal_error().data(e))
            }
        }
    }

    // ── Terminal Capabilities ──

    async fn create_terminal(
        &self,
        args: acp::CreateTerminalRequest,
    ) -> acp::Result<acp::CreateTerminalResponse> {
        let command = &args.command;
        let cmd_args: Vec<String> = args.args.clone();
        let env: std::collections::HashMap<String, String> = args
            .env
            .iter()
            .map(|e| (e.name.clone(), e.value.clone()))
            .collect();

        debug!(
            session_id = %self.session_id,
            command = %command,
            args = ?cmd_args,
            "ACP create_terminal"
        );

        // Use agent's cwd if provided, otherwise fall back to our cwd
        let terminal_cwd = args.cwd.as_deref().unwrap_or(&self.cwd);

        match capabilities::create_terminal(&self.terminals, terminal_cwd, command, &cmd_args, &env)
            .await
        {
            Ok(terminal_id) => {
                Ok(acp::CreateTerminalResponse::new(acp::TerminalId::new(terminal_id)))
            }
            Err(e) => {
                error!(session_id = %self.session_id, error = %e, "ACP create_terminal failed");
                Err(acp::Error::internal_error().data(e))
            }
        }
    }

    async fn terminal_output(
        &self,
        args: acp::TerminalOutputRequest,
    ) -> acp::Result<acp::TerminalOutputResponse> {
        let terminal_id = args.terminal_id.to_string();

        match capabilities::terminal_output(&self.terminals, &terminal_id).await {
            Ok((stdout, _stderr)) => {
                // ACP TerminalOutputResponse takes combined output + truncated flag
                Ok(acp::TerminalOutputResponse::new(stdout, false))
            }
            Err(e) => Err(acp::Error::internal_error().data(e)),
        }
    }

    async fn wait_for_terminal_exit(
        &self,
        args: acp::WaitForTerminalExitRequest,
    ) -> acp::Result<acp::WaitForTerminalExitResponse> {
        let terminal_id = args.terminal_id.to_string();
        debug!(session_id = %self.session_id, terminal_id = %terminal_id, "ACP wait_for_terminal_exit");

        match capabilities::wait_for_terminal_exit(&self.terminals, &terminal_id).await {
            Ok(code) => {
                let exit_status =
                    acp::TerminalExitStatus::new().exit_code(code as u32);
                Ok(acp::WaitForTerminalExitResponse::new(exit_status))
            }
            Err(e) => Err(acp::Error::internal_error().data(e)),
        }
    }

    async fn kill_terminal(
        &self,
        args: acp::KillTerminalRequest,
    ) -> acp::Result<acp::KillTerminalResponse> {
        let terminal_id = args.terminal_id.to_string();
        debug!(session_id = %self.session_id, terminal_id = %terminal_id, "ACP kill_terminal");

        match capabilities::kill_terminal(&self.terminals, &terminal_id).await {
            Ok(()) => Ok(acp::KillTerminalResponse::new()),
            Err(e) => Err(acp::Error::internal_error().data(e)),
        }
    }

    async fn release_terminal(
        &self,
        args: acp::ReleaseTerminalRequest,
    ) -> acp::Result<acp::ReleaseTerminalResponse> {
        let terminal_id = args.terminal_id.to_string();
        debug!(session_id = %self.session_id, terminal_id = %terminal_id, "ACP release_terminal");

        match capabilities::release_terminal(&self.terminals, &terminal_id).await {
            Ok(()) => Ok(acp::ReleaseTerminalResponse::new()),
            Err(e) => Err(acp::Error::internal_error().data(e)),
        }
    }
}

// ── Helpers ──

/// Normalize Rust Debug-formatted enum names to snake_case for the frontend.
/// E.g., "InProgress" → "in_progress", "Completed" → "completed", "Read" → "read".
fn normalize_acp_enum(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + 4);
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            result.push('_');
        }
        result.push(c.to_ascii_lowercase());
    }
    result
}

/// Truncate a string for log output, adding "…" if truncated.
fn truncate_for_log(s: &str, max_len: usize) -> String {
    let trimmed = s.replace('\n', "\\n");
    if trimmed.len() <= max_len {
        trimmed
    } else {
        format!("{}…", &trimmed[..max_len])
    }
}

/// Extract text from a `ContentBlock`, handling the various content types.
///
/// ACP 0.10.2 supports: Text, Image, Audio, ResourceLink, and EmbeddedResource.
/// We extract meaningful text from each; non-text types get a descriptive placeholder.
fn extract_text_from_content_block(block: &acp::ContentBlock) -> String {
    match block {
        acp::ContentBlock::Text(text) => text.text.clone(),
        acp::ContentBlock::Image(_) => "[image content]".to_string(),
        acp::ContentBlock::Audio(_) => "[audio content]".to_string(),
        acp::ContentBlock::ResourceLink(link) => {
            format!("[resource link: {}]", link.uri)
        }
        acp::ContentBlock::Resource(resource) => {
            match &resource.resource {
                acp::EmbeddedResourceResource::TextResourceContents(t) => t.text.clone(),
                acp::EmbeddedResourceResource::BlobResourceContents(_) => "[embedded binary resource]".to_string(),
                // non_exhaustive
                _ => "[embedded resource]".to_string(),
            }
        }
        // non_exhaustive — future variants
        _ => "[unknown content type]".to_string(),
    }
}

/// Convert ACP `ToolCallContent` items to our simplified frontend-friendly format.
fn convert_tool_call_content(content: &[acp::ToolCallContent]) -> Vec<ToolCallContentItem> {
    content
        .iter()
        .filter_map(|item| match item {
            acp::ToolCallContent::Content(c) => {
                let text = extract_text_from_content_block(&c.content);
                if text.is_empty() {
                    None
                } else {
                    Some(ToolCallContentItem::Text { text })
                }
            }
            acp::ToolCallContent::Diff(diff) => Some(ToolCallContentItem::Diff {
                path: diff.path.to_string_lossy().to_string(),
                old_text: diff.old_text.clone(),
                new_text: diff.new_text.clone(),
            }),
            acp::ToolCallContent::Terminal(terminal) => Some(ToolCallContentItem::Terminal {
                terminal_id: terminal.terminal_id.to_string(),
            }),
            // non_exhaustive — skip unknown variants
            _ => None,
        })
        .collect()
}

/// Convert an ACP `SessionConfigOption` to our simplified frontend-friendly format.
/// Public alias for use from IPC commands.
pub fn convert_config_option_public(opt: &acp::SessionConfigOption) -> AcpConfigOption {
    convert_config_option(opt)
}

/// Convert an ACP `SessionConfigOption` to our simplified frontend-friendly format.
fn convert_config_option(opt: &acp::SessionConfigOption) -> AcpConfigOption {
    let category = opt.category.as_ref().map(|c| match c {
        acp::SessionConfigOptionCategory::Mode => "mode".to_string(),
        acp::SessionConfigOptionCategory::Model => "model".to_string(),
        acp::SessionConfigOptionCategory::ThoughtLevel => "thought_level".to_string(),
        _ => format!("{:?}", c),
    });

    let (current_value, options, groups) = match &opt.kind {
        acp::SessionConfigKind::Select(select) => {
            let cv = select.current_value.to_string();
            match &select.options {
                acp::SessionConfigSelectOptions::Ungrouped(opts) => {
                    let flat: Vec<AcpConfigSelectOption> = opts
                        .iter()
                        .map(|o| AcpConfigSelectOption {
                            value: o.value.to_string(),
                            name: o.name.clone(),
                            description: o.description.clone(),
                        })
                        .collect();
                    (cv, flat, vec![])
                }
                acp::SessionConfigSelectOptions::Grouped(grps) => {
                    let grouped: Vec<AcpConfigSelectGroup> = grps
                        .iter()
                        .map(|g| AcpConfigSelectGroup {
                            name: g.name.clone(),
                            options: g
                                .options
                                .iter()
                                .map(|o| AcpConfigSelectOption {
                                    value: o.value.to_string(),
                                    name: o.name.clone(),
                                    description: o.description.clone(),
                                })
                                .collect(),
                        })
                        .collect();
                    (cv, vec![], grouped)
                }
                _ => (cv, vec![], vec![]),
            }
        }
        _ => ("".to_string(), vec![], vec![]),
    };

    AcpConfigOption {
        id: opt.id.to_string(),
        name: opt.name.clone(),
        description: opt.description.clone(),
        category,
        current_value,
        options,
        groups,
    }
}

/// Try to extract a file path from a permission description string.
fn extract_path_from_description(description: &str) -> String {
    // Common patterns: "Read file: /path/to/file", "Write to /path/to/file"
    // Fall back to the entire description if no path found
    if let Some(pos) = description.find(": ") {
        return description[pos + 2..].trim().to_string();
    }
    if let Some(pos) = description.find(" to ") {
        return description[pos + 4..].trim().to_string();
    }
    description.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_text_from_text_block() {
        let block = acp::ContentBlock::Text(acp::TextContent::new("Hello world"));
        assert_eq!(extract_text_from_content_block(&block), "Hello world");
    }

    #[test]
    fn extract_text_from_image_block() {
        let block = acp::ContentBlock::Image(acp::ImageContent::new("base64data", "image/png"));
        assert_eq!(extract_text_from_content_block(&block), "[image content]");
    }

    #[test]
    fn extract_path_with_colon() {
        assert_eq!(extract_path_from_description("Read file: src/main.rs"), "src/main.rs");
    }

    #[test]
    fn extract_path_with_to() {
        assert_eq!(extract_path_from_description("Write to src/lib.rs"), "src/lib.rs");
    }

    #[test]
    fn extract_path_fallback() {
        assert_eq!(extract_path_from_description("something else"), "something else");
    }
}
