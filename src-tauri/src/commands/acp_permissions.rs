use tauri::State;

use crate::acp::permissions::{self, PermissionAction, PermissionRule, PermissionLogEntry};
use crate::acp::state::PendingPermissionsRegistry;
use crate::db::DbState;
use crate::error::AppError;

// ── Permission Rule Management ──

#[tauri::command]
pub fn list_permission_rules(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<PermissionRule>, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    Ok(permissions::list_rules(&conn, &project_id)?)
}

#[tauri::command]
pub fn create_permission_rule(
    db: State<'_, DbState>,
    project_id: String,
    capability: String,
    path_pattern: Option<String>,
    command_pattern: Option<String>,
    action: String,
) -> Result<PermissionRule, AppError> {
    let action = PermissionAction::from_str(&action)
        .ok_or_else(|| AppError::Validation(format!("Invalid action: {action}")))?;
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    Ok(permissions::create_rule(
        &conn,
        &project_id,
        &capability,
        path_pattern.as_deref(),
        command_pattern.as_deref(),
        action,
    )?)
}

#[tauri::command]
pub fn delete_permission_rule(
    db: State<'_, DbState>,
    rule_id: String,
) -> Result<bool, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    Ok(permissions::delete_rule(&conn, &rule_id)?)
}

#[tauri::command]
pub fn reset_permission_rules(
    db: State<'_, DbState>,
    project_id: String,
) -> Result<usize, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    Ok(permissions::delete_all_rules(&conn, &project_id)?)
}

// ── Permission Log ──

#[tauri::command]
pub fn get_permission_log(
    db: State<'_, DbState>,
    project_id: String,
    limit: Option<usize>,
) -> Result<Vec<PermissionLogEntry>, AppError> {
    let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
    Ok(permissions::get_log(&conn, &project_id, limit.unwrap_or(50))?)
}

// ── Permission Request Response ──

/// Respond to a pending permission request from the frontend.
///
/// The frontend calls this when the user approves or denies a permission
/// dialog. The response is sent back to the ACP handler via a oneshot channel.
///
/// **Important:** This uses `PendingPermissionsRegistry` instead of `AcpState`
/// because `AcpState` temporarily removes session entries during `prompt()`
/// calls to avoid holding the mutex. If we looked up pending permissions via
/// `AcpState`, the session would not be found during active prompts — which is
/// exactly when permission requests happen. The registry is never modified by
/// `prompt()`, so the lookup always succeeds.
#[tauri::command]
pub async fn respond_permission(
    registry: State<'_, PendingPermissionsRegistry>,
    db: State<'_, DbState>,
    session_id: String,
    request_id: String,
    approved: bool,
    always_allow: Option<bool>,
    capability: Option<String>,
    path_pattern: Option<String>,
    project_id: Option<String>,
) -> Result<(), AppError> {
    // If "always allow" was checked, create an auto-approve rule
    if always_allow.unwrap_or(false) {
        if let (Some(cap), Some(pid)) = (&capability, &project_id) {
            let conn = db.lock().map_err(|e| AppError::Database(e.to_string()))?;
            let _ = permissions::create_rule(
                &conn,
                pid,
                cap,
                path_pattern.as_deref(),
                None,
                PermissionAction::AutoApprove,
            );
            tracing::info!(
                capability = %cap,
                project_id = %pid,
                "Created auto-approve rule from permission dialog"
            );
        }
    }

    // Look up the PendingPermissions for this session from the registry.
    // This registry is separate from AcpState and is never modified during
    // prompt() calls, so it always contains the session's permissions map.
    let registry = registry.inner().clone();
    let reg = registry.lock().await;
    if let Some(pending_perms) = reg.get(&session_id) {
        let pending_perms = pending_perms.clone();
        drop(reg); // Release registry lock before locking pending_perms

        let mut pending = pending_perms.lock().await;
        if let Some(tx) = pending.remove(&request_id) {
            let _ = tx.send(approved);
            tracing::info!(
                session_id = %session_id,
                request_id = %request_id,
                approved = %approved,
                "Permission request resolved via registry"
            );
        } else {
            tracing::warn!(
                session_id = %session_id,
                request_id = %request_id,
                "Permission request not found in pending map (may have timed out)"
            );
        }
    } else {
        tracing::warn!(
            session_id = %session_id,
            "Session not found in PendingPermissionsRegistry"
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn rule_crud_roundtrip() {
        let state = db::init_memory().unwrap();
        let conn = state.lock().unwrap();

        // Create test project for foreign key
        conn.execute(
            "INSERT INTO projects (id, name, path) VALUES ('proj_1', 'test', '/tmp/test')",
            [],
        ).unwrap();

        // Create a rule
        let rule = permissions::create_rule(
            &conn,
            "proj_1",
            "fs_read",
            Some("src/**"),
            None,
            PermissionAction::AutoApprove,
        ).unwrap();

        // List rules
        let rules = permissions::list_rules(&conn, "proj_1").unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, rule.id);

        // Delete rule
        assert!(permissions::delete_rule(&conn, &rule.id).unwrap());
        assert!(permissions::list_rules(&conn, "proj_1").unwrap().is_empty());
    }
}
