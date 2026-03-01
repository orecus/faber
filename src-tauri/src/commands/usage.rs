use std::sync::Arc;

use tauri::State;
use tokio::sync::Mutex as TokioMutex;

use crate::error::AppError;
use crate::usage::registry::UsageRegistry;
use crate::usage::AgentUsageData;

#[tauri::command]
pub async fn get_agent_usage(
    usage: State<'_, Arc<TokioMutex<UsageRegistry>>>,
) -> Result<Vec<AgentUsageData>, AppError> {
    let registry = usage.lock().await;
    Ok(registry.fetch_all().await)
}
