use serde::Serialize;
use tauri::State;

use crate::agent;
use crate::credentials;
use crate::db;
use crate::db::models::Setting;
use crate::db::DbState;
use crate::error::AppError;

#[tauri::command]
pub fn get_setting(state: State<'_, DbState>, key: String) -> Result<Option<String>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let value = db::settings::get_value(&conn, "global", None, &key)?;
    Ok(value)
}

#[tauri::command]
pub fn set_setting(
    state: State<'_, DbState>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::settings::set_value(&conn, "global", None, &key, &value)?;
    Ok(())
}

#[tauri::command]
pub fn get_all_settings(state: State<'_, DbState>) -> Result<Vec<Setting>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let settings = db::settings::get_all(&conn, "global", None)?;
    Ok(settings)
}

#[tauri::command]
pub fn store_api_key(provider: String, key: String) -> Result<(), AppError> {
    credentials::store(&provider, &key)?;
    Ok(())
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<bool, AppError> {
    let deleted = credentials::delete(&provider)?;
    Ok(deleted)
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyStatus {
    pub provider: String,
    pub exists: bool,
}

#[tauri::command]
pub fn get_api_key_status(provider: String) -> Result<ApiKeyStatus, AppError> {
    let secret = credentials::get(&provider)?;
    Ok(ApiKeyStatus {
        provider,
        exists: secret.is_some(),
    })
}

#[tauri::command]
pub fn list_installed_agents() -> Vec<agent::AgentInfo> {
    agent::list_agent_info()
}

#[derive(Debug, Clone, Serialize)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn list_available_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();

    #[cfg(windows)]
    {
        let candidates: &[(&str, &str)] = &[
            ("PowerShell 7", "pwsh.exe"),
            ("Windows PowerShell", "powershell.exe"),
            ("Command Prompt", "cmd.exe"),
            ("Git Bash", "bash.exe"),
            ("WSL", "wsl.exe"),
            ("Nushell", "nu.exe"),
        ];
        for &(name, cmd) in candidates {
            if agent::is_command_in_path(cmd) {
                shells.push(ShellInfo {
                    name: name.to_string(),
                    path: cmd.to_string(),
                });
            }
        }
    }

    #[cfg(not(windows))]
    {
        let candidates: &[(&str, &str)] = &[
            ("Zsh", "/bin/zsh"),
            ("Bash", "/bin/bash"),
            ("Sh", "/bin/sh"),
            ("Fish", "/usr/bin/fish"),
            ("Nushell", "nu"),
        ];
        for &(name, path) in candidates {
            if std::path::Path::new(path).exists() || agent::is_command_in_path(path) {
                shells.push(ShellInfo {
                    name: name.to_string(),
                    path: path.to_string(),
                });
            }
        }
    }

    shells
}

#[cfg(test)]
mod tests {
    use crate::db;

    #[test]
    fn get_setting_missing_returns_none() {
        let state = db::init_memory().unwrap();
        let conn = state.lock().unwrap();
        let result = db::settings::get_value(&conn, "global", None, "nonexistent").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn set_and_get_setting_roundtrip() {
        let state = db::init_memory().unwrap();
        let conn = state.lock().unwrap();
        db::settings::set_value(&conn, "global", None, "theme", "dark-glass").unwrap();
        let result = db::settings::get_value(&conn, "global", None, "theme").unwrap();
        assert_eq!(result, Some("dark-glass".into()));
    }
}
