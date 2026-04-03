//! Global ACP state management.
//!
//! Maintains per-session ACP client state, mirroring how `McpState` tracks
//! per-session MCP data. Registered as Tauri managed state.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};

use agent_client_protocol as acp;

use super::client::AcpClient;
use super::handler::PendingPermissions;

/// Per-session ACP state.
pub struct AcpSessionState {
    /// The ACP client managing the agent subprocess and connection.
    ///
    /// Wrapped in `Arc` so that `cancel()` can be called concurrently with an
    /// in-progress `prompt()` — both methods take `&self`. Code that needs to
    /// call prompt/cancel clones the Arc and releases the state-map mutex first.
    pub client: Arc<AcpClient>,
    /// The ACP session ID returned by `session/new`.
    pub acp_session_id: Option<acp::SessionId>,
    /// Pending permission requests for this session (shared with handler).
    #[allow(dead_code)]
    pub pending_permissions: PendingPermissions,
    /// Signal to stop the keepalive thread for sessions without an initial prompt.
    /// Notified by `shutdown_acp_client` to cleanly exit the spawn thread.
    pub shutdown_signal: Arc<Notify>,
}

/// Global ACP state — maps Faber session IDs to ACP session state.
///
/// Wrapped in `Arc<Mutex<_>>` for thread-safe access from Tauri commands
/// and async handlers, matching the pattern used by `McpState` and
/// `QueueState`.
pub type AcpState = Arc<Mutex<HashMap<String, AcpSessionState>>>;

/// Create a new empty ACP state for Tauri managed state registration.
pub fn new_state() -> AcpState {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Registry of pending permission maps keyed by Faber session ID.
///
/// This is a **separate** piece of managed state from `AcpState` so that
/// permission responses can be resolved without needing to lock `AcpState`.
/// Keeping them separate avoids potential lock ordering issues between the
/// permission handler and prompt code paths.
pub type PendingPermissionsRegistry = Arc<Mutex<HashMap<String, PendingPermissions>>>;

/// Create a new empty pending permissions registry.
pub fn new_pending_permissions_registry() -> PendingPermissionsRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_state_is_empty() {
        let state = new_state();
        let map = state.try_lock().unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn new_registry_is_empty() {
        let registry = new_pending_permissions_registry();
        let map = registry.try_lock().unwrap();
        assert!(map.is_empty());
    }
}
