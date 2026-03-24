//! Faber-specific ACP types and event payloads.
//!
//! These types are serialized and emitted as Tauri events so the frontend
//! can render ACP session updates (message chunks, tool calls, plans, etc.).

use serde::Serialize;

/// A chunk of text content from the agent.
#[derive(Debug, Clone, Serialize)]
pub struct AcpMessageChunkPayload {
    pub session_id: String,
    pub text: String,
}

/// A tool call initiated by the agent.
#[derive(Debug, Clone, Serialize)]
pub struct AcpToolCallPayload {
    pub session_id: String,
    pub tool_call_id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    /// Serialized content produced by the tool call (code, diffs, terminal output).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<ToolCallContentItem>,
}

/// An update to an existing tool call.
#[derive(Debug, Clone, Serialize)]
pub struct AcpToolCallUpdatePayload {
    pub session_id: String,
    pub tool_call_id: String,
    pub status: String,
    pub title: Option<String>,
    /// Updated content (replaces previous content if present).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<ToolCallContentItem>>,
}

/// Simplified tool call content for frontend consumption.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolCallContentItem {
    /// Plain text content (e.g. file contents, command output).
    Text {
        text: String,
    },
    /// File diff with before/after content.
    Diff {
        path: String,
        old_text: Option<String>,
        new_text: String,
    },
    /// Terminal reference (by terminal ID).
    Terminal {
        terminal_id: String,
    },
}

/// A plan entry from the agent.
#[derive(Debug, Clone, Serialize)]
pub struct AcpPlanEntry {
    pub id: String,
    pub title: String,
    pub status: String,
}

/// A full plan update from the agent.
#[derive(Debug, Clone, Serialize)]
pub struct AcpPlanUpdatePayload {
    pub session_id: String,
    pub entries: Vec<AcpPlanEntry>,
}

/// Agent mode change notification.
#[derive(Debug, Clone, Serialize)]
pub struct AcpModeUpdatePayload {
    pub session_id: String,
    pub mode: String,
}

/// Session info update (title/metadata changed).
#[derive(Debug, Clone, Serialize)]
pub struct AcpSessionInfoPayload {
    pub session_id: String,
    pub title: Option<String>,
}

/// Prompt completed.
#[derive(Debug, Clone, Serialize)]
pub struct AcpPromptCompletePayload {
    pub session_id: String,
    pub stop_reason: String,
}

/// ACP session error.
#[derive(Debug, Clone, Serialize)]
pub struct AcpErrorPayload {
    pub session_id: String,
    pub error: String,
}

/// Permission request from agent — emitted when policy says "ask".
#[derive(Debug, Clone, Serialize)]
pub struct AcpPermissionRequestPayload {
    pub session_id: String,
    pub request_id: String,
    pub capability: String,
    pub detail: String,
    pub description: String,
    pub options: Vec<AcpPermissionOption>,
}

/// An option from the ACP permission request.
#[derive(Debug, Clone, Serialize)]
pub struct AcpPermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
    pub description: Option<String>,
}

/// Permission response sent back to the frontend after resolution.
#[derive(Debug, Clone, Serialize)]
pub struct AcpPermissionResponsePayload {
    pub session_id: String,
    pub request_id: String,
    pub approved: bool,
    pub timed_out: bool,
}

/// An available command advertised by the agent.
#[derive(Debug, Clone, Serialize)]
pub struct AcpAvailableCommand {
    pub name: String,
    pub description: String,
    /// Input hint for the command (if it accepts unstructured input).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_hint: Option<String>,
}

/// Available commands update from the agent.
#[derive(Debug, Clone, Serialize)]
pub struct AcpAvailableCommandsPayload {
    pub session_id: String,
    pub commands: Vec<AcpAvailableCommand>,
}

/// A select option value for a config option.
#[derive(Debug, Clone, Serialize)]
pub struct AcpConfigSelectOption {
    pub value: String,
    pub name: String,
    /// Optional description for this option value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A group of select options.
#[derive(Debug, Clone, Serialize)]
pub struct AcpConfigSelectGroup {
    pub name: String,
    pub options: Vec<AcpConfigSelectOption>,
}

/// A session configuration option advertised by the agent.
#[derive(Debug, Clone, Serialize)]
pub struct AcpConfigOption {
    /// Unique identifier for this option.
    pub id: String,
    /// Human-readable label.
    pub name: String,
    /// Optional description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Semantic category: "mode", "model", "thought_level", or custom.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// The currently selected value ID.
    pub current_value: String,
    /// Flat list of options (when ungrouped).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<AcpConfigSelectOption>,
    /// Grouped options (when grouped).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<AcpConfigSelectGroup>,
}

/// Config options update from the agent.
#[derive(Debug, Clone, Serialize)]
pub struct AcpConfigOptionUpdatePayload {
    pub session_id: String,
    pub config_options: Vec<AcpConfigOption>,
}

/// Context window usage and cost update for a session.
#[derive(Debug, Clone, Serialize)]
pub struct AcpUsageUpdatePayload {
    pub session_id: String,
    /// Tokens currently in context.
    pub used: u64,
    /// Total context window size in tokens.
    pub size: u64,
    /// Cumulative session cost amount (if provided by agent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_amount: Option<f64>,
    /// ISO 4217 currency code (e.g. "USD").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_currency: Option<String>,
}

// ── Tauri Event Names ──

pub const EVENT_ACP_THOUGHT_CHUNK: &str = "acp-thought-chunk";
pub const EVENT_ACP_MESSAGE_CHUNK: &str = "acp-message-chunk";
pub const EVENT_ACP_USER_MESSAGE_CHUNK: &str = "acp-user-message-chunk";
pub const EVENT_ACP_TOOL_CALL: &str = "acp-tool-call";
pub const EVENT_ACP_TOOL_CALL_UPDATE: &str = "acp-tool-call-update";
pub const EVENT_ACP_PLAN_UPDATE: &str = "acp-plan-update";
pub const EVENT_ACP_MODE_UPDATE: &str = "acp-mode-update";
pub const EVENT_ACP_SESSION_INFO: &str = "acp-session-info";
pub const EVENT_ACP_PROMPT_COMPLETE: &str = "acp-prompt-complete";
pub const EVENT_ACP_ERROR: &str = "acp-error";
pub const EVENT_ACP_PERMISSION_REQUEST: &str = "acp-permission-request";
pub const EVENT_ACP_PERMISSION_RESPONSE: &str = "acp-permission-response";
pub const EVENT_ACP_AVAILABLE_COMMANDS: &str = "acp-available-commands";
pub const EVENT_ACP_CONFIG_OPTION_UPDATE: &str = "acp-config-option-update";
pub const EVENT_ACP_USAGE_UPDATE: &str = "acp-usage-update";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_chunk_serializes() {
        let payload = AcpMessageChunkPayload {
            session_id: "sess_123".into(),
            text: "Hello world".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("sess_123"));
        assert!(json.contains("Hello world"));
    }

    #[test]
    fn tool_call_serializes() {
        let payload = AcpToolCallPayload {
            session_id: "sess_123".into(),
            tool_call_id: "tc_1".into(),
            title: "Read file".into(),
            kind: "read".into(),
            status: "in_progress".into(),
            content: vec![],
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("tc_1"));
        assert!(json.contains("Read file"));
    }

    #[test]
    fn plan_update_serializes() {
        let payload = AcpPlanUpdatePayload {
            session_id: "sess_123".into(),
            entries: vec![
                AcpPlanEntry {
                    id: "1".into(),
                    title: "Step one".into(),
                    status: "completed".into(),
                },
                AcpPlanEntry {
                    id: "2".into(),
                    title: "Step two".into(),
                    status: "pending".into(),
                },
            ],
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("Step one"));
        assert!(json.contains("Step two"));
    }

    #[test]
    fn error_payload_serializes() {
        let payload = AcpErrorPayload {
            session_id: "sess_err".into(),
            error: "Connection lost".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("Connection lost"));
    }
}
