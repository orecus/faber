use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex as TokioMutex;

use crate::error::AppError;
use crate::mcp::McpState;

#[derive(Serialize)]
pub struct McpInfo {
    pub port: u16,
    pub active_sessions: usize,
    pub sidecar_path: Option<String>,
}

#[tauri::command]
pub fn get_mcp_info(
    mcp: State<'_, Arc<TokioMutex<McpState>>>,
) -> Result<McpInfo, AppError> {
    let guard = mcp.blocking_lock();
    Ok(McpInfo {
        port: guard.port,
        active_sessions: guard.sessions.len(),
        sidecar_path: crate::mcp::server::resolve_sidecar_path()
            .map(|p: std::path::PathBuf| p.to_string_lossy().into_owned()),
    })
}
