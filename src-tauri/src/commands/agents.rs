use tauri::State;

use crate::agent::{self, AgentInfo};
use crate::db;
use crate::db::models::{AgentConfig, NewAgentConfig};
use crate::db::DbState;
use crate::error::AppError;

#[tauri::command]
pub fn list_agents() -> Vec<AgentInfo> {
    agent::list_agent_info()
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
