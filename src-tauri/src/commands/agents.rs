use tauri::{AppHandle, Emitter, State};

use crate::agent::{self, registry::AcpRegistryInfo, AgentInfo};
use crate::db;
use crate::db::models::{AgentConfig, NewAgentConfig};
use crate::db::DbState;
use crate::error::AppError;

#[tauri::command]
pub fn list_agents() -> Vec<AgentInfo> {
    agent::list_agent_info()
}

#[tauri::command]
pub async fn install_acp_adapter(
    app: AppHandle,
    agent_name: String,
    target_version: Option<String>,
) -> Result<Vec<AgentInfo>, AppError> {
    let adapter = agent::get_adapter(&agent_name)
        .ok_or_else(|| AppError::NotFound(format!("Agent {agent_name}")))?;

    if !adapter.supports_acp() {
        return Err(AppError::Validation(format!(
            "{} does not support ACP",
            adapter.display_name()
        )));
    }

    let base_install_cmd = adapter.acp_install_command().ok_or_else(|| {
        AppError::Validation(format!(
            "{} has native ACP support — no adapter to install",
            adapter.display_name()
        ))
    })?;

    let display_name = adapter.display_name().to_string();
    let package = adapter
        .acp_adapter_package()
        .unwrap_or("unknown")
        .to_string();

    // When a target version is specified (update), pin the install to that exact version.
    // e.g. "npm install -g @zed-industries/claude-agent-acp" → "npm install -g @zed-industries/claude-agent-acp@0.24.1"
    let install_cmd = if let Some(ref version) = target_version {
        if !package.is_empty() && package != "unknown" {
            base_install_cmd.replace(&package, &format!("{package}@{version}"))
        } else {
            base_install_cmd.to_string()
        }
    } else {
        base_install_cmd.to_string()
    };

    tracing::info!(
        agent = %agent_name,
        command = %install_cmd,
        package = %package,
        target_version = ?target_version,
        "Starting ACP adapter installation"
    );

    // Emit start event
    let _ = app.emit(
        "acp-adapter-install-progress",
        serde_json::json!({
            "agent_name": agent_name,
            "status": "installing",
            "message": format!("Installing ACP adapter for {}…", display_name),
        }),
    );

    // Run the install command (hide console window on Windows)
    let output = {
        let mut cmd = if cfg!(windows) {
            let mut c = tokio::process::Command::new("cmd");
            c.args(["/C", &install_cmd]);
            c
        } else {
            let mut c = tokio::process::Command::new("sh");
            c.args(["-c", &install_cmd]);
            c
        };
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd.output().await
    };

    match output {
        Ok(result) if result.status.success() => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            tracing::info!(
                agent = %agent_name,
                package = %package,
                stdout = %stdout.trim(),
                "ACP adapter installed successfully"
            );

            // Invalidate caches so the next registry fetch picks up the new version
            agent::registry::invalidate_npm_cache();
            agent::registry::invalidate_registry_cache();

            // Re-detect all agents to pick up the new adapter
            let agents = agent::list_agent_info();

            let _ = app.emit(
                "acp-adapter-install-progress",
                serde_json::json!({
                    "agent_name": agent_name,
                    "status": "completed",
                    "message": format!("ACP adapter for {} installed successfully", display_name),
                }),
            );

            Ok(agents)
        }
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr).to_string();
            let stdout = String::from_utf8_lossy(&result.stdout).to_string();
            tracing::error!(
                agent = %agent_name,
                package = %package,
                exit_code = ?result.status.code(),
                stderr = %stderr.trim(),
                stdout = %stdout.trim(),
                "ACP adapter installation failed"
            );

            // Extract a clean, user-friendly message from npm's verbose stderr.
            // Prioritise "npm error notarget ..." lines, then any "npm error ..." line,
            // falling back to a generic message.  Full output is already in the logs.
            let user_message = extract_npm_error(&stderr)
                .unwrap_or_else(|| format!("Installation failed (exit code {}). Check logs for details.", result.status.code().unwrap_or(-1)));

            let _ = app.emit(
                "acp-adapter-install-progress",
                serde_json::json!({
                    "agent_name": agent_name,
                    "status": "failed",
                    "message": user_message,
                }),
            );
            Err(AppError::Io(user_message))
        }
        Err(e) => {
            let msg = if e.kind() == std::io::ErrorKind::NotFound {
                "npm is not installed or not on PATH. Install Node.js/npm first.".to_string()
            } else {
                e.to_string()
            };
            tracing::error!(
                agent = %agent_name,
                package = %package,
                error = %e,
                error_kind = ?e.kind(),
                "Failed to spawn ACP adapter install process"
            );

            let _ = app.emit(
                "acp-adapter-install-progress",
                serde_json::json!({
                    "agent_name": agent_name,
                    "status": "failed",
                    "message": msg,
                }),
            );
            Err(AppError::Io(msg))
        }
    }
}

#[tauri::command]
pub async fn fetch_acp_registry(
    force_refresh: bool,
) -> Result<Vec<AcpRegistryInfo>, AppError> {
    agent::registry::fetch_registry(force_refresh)
        .await
        .map_err(AppError::Io)
}

#[tauri::command]
pub fn check_agent_installed(agent_name: String) -> Result<bool, AppError> {
    let adapter = agent::get_adapter(&agent_name)
        .ok_or_else(|| AppError::NotFound(format!("Agent {agent_name}")))?;
    Ok(adapter.detect_installation())
}

#[tauri::command]
pub fn get_agent_config(
    state: State<'_, DbState>,
    agent_name: String,
    project_id: String,
    task_id: Option<String>,
) -> Result<Option<AgentConfig>, AppError> {
    let conn = state
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    db::agent_configs::resolve(&conn, task_id.as_deref(), &project_id, &agent_name)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn upsert_agent_config(
    state: State<'_, DbState>,
    scope: String,
    scope_id: Option<String>,
    agent_name: String,
    model: Option<String>,
    flags: Vec<String>,
) -> Result<AgentConfig, AppError> {
    let conn = state
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    let new = NewAgentConfig {
        scope,
        scope_id,
        agent_name,
        model,
        flags,
    };
    db::agent_configs::upsert(&conn, &new).map_err(AppError::from)
}

#[tauri::command]
pub fn delete_agent_config(
    state: State<'_, DbState>,
    scope: String,
    scope_id: Option<String>,
    agent_name: String,
) -> Result<bool, AppError> {
    let conn = state
        .lock()
        .map_err(|e| AppError::Database(e.to_string()))?;
    db::agent_configs::delete(&conn, &scope, scope_id.as_deref(), &agent_name)
        .map_err(AppError::from)
}

// ── Helpers ──

/// Extract a clean, user-facing error message from npm's stderr output.
///
/// npm stderr contains warnings, error codes, and multi-line explanations.
/// This extracts the most relevant line for display in the UI — the full
/// output is already captured in the structured log.
fn extract_npm_error(stderr: &str) -> Option<String> {
    let mut best: Option<&str> = None;

    for line in stderr.lines() {
        let trimmed = line.trim();

        // "npm error notarget No matching version found for ..." — most specific
        if trimmed.starts_with("npm error notarget") || trimmed.starts_with("npm ERR! notarget") {
            let msg = trimmed
                .trim_start_matches("npm error notarget")
                .trim_start_matches("npm ERR! notarget")
                .trim();
            if !msg.is_empty() {
                // Return the first meaningful notarget line
                return Some(msg.to_string());
            }
        }

        // Any "npm error <text>" / "npm ERR! <text>" that isn't a code/log path
        if (trimmed.starts_with("npm error") || trimmed.starts_with("npm ERR!"))
            && !trimmed.contains("A complete log of this run")
            && !trimmed.starts_with("npm error code")
            && !trimmed.starts_with("npm ERR! code")
        {
            let msg = trimmed
                .trim_start_matches("npm error")
                .trim_start_matches("npm ERR!")
                .trim();
            if !msg.is_empty() && best.is_none() {
                best = Some(msg);
            }
        }
    }

    best.map(|s| s.to_string())
}
