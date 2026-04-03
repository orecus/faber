use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::error::AppError;

// ── Prompt template data model ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptTemplate {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub prompt: String,
    pub category: PromptCategory,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_mode: Option<String>,
    pub quick_action: bool,
    pub builtin: bool,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PromptCategory {
    Session,
    Action,
}

// ── Settings key ──

const SETTINGS_KEY: &str = "prompt_templates";

// ── Built-in defaults ──

fn builtin_templates() -> Vec<PromptTemplate> {
    vec![
        // Session prompts (protected — cannot be deleted)
        PromptTemplate {
            id: "task-launch".into(),
            label: "Task Launch".into(),
            icon: "play".into(),
            prompt: "Start working on task {{task_id}}. \
                     Use the `get_instructions` MCP tool to get your session instructions and task details, \
                     then begin implementing immediately. \
                     {{worktree_hint}}"
                .into(),
            category: PromptCategory::Session,
            session_mode: Some("task".into()),
            quick_action: false,
            builtin: true,
            sort_order: 0,
        },
        PromptTemplate {
            id: "task-continue".into(),
            label: "Task Continue".into(),
            icon: "rotate-cw".into(),
            prompt: "Continue working on task {{task_id}}. \
                     Use the `get_instructions` MCP tool to get your session instructions and task details, \
                     then continue where you left off. \
                     {{worktree_hint}}"
                .into(),
            category: PromptCategory::Session,
            session_mode: Some("task-continue".into()),
            quick_action: false,
            builtin: true,
            sort_order: 1,
        },
        PromptTemplate {
            id: "research".into(),
            label: "Research".into(),
            icon: "search".into(),
            prompt: "Task {{task_id}} needs to be analyzed and researched together with the user. \
                     Start by calling the `get_instructions` MCP tool to get your session instructions and task details. \
                     The goal is to research the codebase, explore approaches, \
                     and then update the task file with a concrete implementation plan \
                     using the `update_task_plan` MCP tool. Ask the user for next steps."
                .into(),
            category: PromptCategory::Session,
            session_mode: Some("research".into()),
            quick_action: false,
            builtin: true,
            sort_order: 2,
        },
        PromptTemplate {
            id: "queue".into(),
            label: "Queue Mode".into(),
            icon: "zap".into(),
            prompt: "You are running in queue mode ({{mode}}). \
                     Use the `get_instructions` MCP tool to get your session instructions and task details, \
                     then begin working on task {{task_id}} autonomously."
                .into(),
            category: PromptCategory::Session,
            session_mode: Some("queue".into()),
            quick_action: false,
            builtin: true,
            sort_order: 3,
        },
        PromptTemplate {
            id: "epic-breakdown".into(),
            label: "Epic Breakdown".into(),
            icon: "ungroup".into(),
            prompt: "Epic {{task_id}} needs to be broken down into concrete child tasks. \
                     Start by calling the `get_instructions` MCP tool to get your session instructions and epic details. \
                     Analyze the epic's scope and body, then decompose it into smaller, \
                     actionable child tasks using the `create_task` MCP tool — \
                     make sure to set `epic_id` to \"{{task_id}}\" for each child task. \
                     Present the breakdown plan to the user before creating tasks."
                .into(),
            category: PromptCategory::Session,
            session_mode: Some("breakdown".into()),
            quick_action: false,
            builtin: true,
            sort_order: 4,
        },
        // Action prompts (deletable, restorable via reset)
        PromptTemplate {
            id: "commit".into(),
            label: "Commit".into(),
            icon: "git-commit".into(),
            prompt: "Commit all changes with a descriptive commit message based on the changes made."
                .into(),
            category: PromptCategory::Action,
            session_mode: None,
            quick_action: true,
            builtin: true,
            sort_order: 100,
        },
        PromptTemplate {
            id: "fix-errors".into(),
            label: "Fix Errors".into(),
            icon: "bug".into(),
            prompt: "Check for and fix any errors, type issues, or failing tests in the codebase."
                .into(),
            category: PromptCategory::Action,
            session_mode: None,
            quick_action: true,
            builtin: true,
            sort_order: 101,
        },
        PromptTemplate {
            id: "lint-format".into(),
            label: "Lint & Format".into(),
            icon: "sparkles".into(),
            prompt: "Run the project's linter and formatter, then fix any issues found.".into(),
            category: PromptCategory::Action,
            session_mode: None,
            quick_action: true,
            builtin: true,
            sort_order: 102,
        },
    ]
}

// ── Internal helpers ──

/// Load templates from the settings DB, seeding defaults if missing.
fn load_templates(conn: &Connection) -> Result<Vec<PromptTemplate>, AppError> {
    let raw = db::settings::get_value(conn, "global", None, SETTINGS_KEY)?;

    match raw {
        Some(json) if !json.is_empty() => {
            let templates: Vec<PromptTemplate> = serde_json::from_str(&json)
                .map_err(|e| {
                    tracing::warn!(%e, "Corrupt prompt_templates JSON, resetting to defaults");
                    e
                })
                .unwrap_or_else(|_| builtin_templates());

            let mut result = templates;
            let builtins = builtin_templates();
            let mut dirty = false;

            // Remove legacy "continuous" templates (renamed to "queue")
            let before_len = result.len();
            result.retain(|t| t.session_mode.as_deref() != Some("continuous"));
            if result.len() != before_len {
                tracing::info!("Removed legacy 'continuous' prompt template(s)");
                dirty = true;
            }

            // Ensure all builtin session templates exist and stay up-to-date
            for builtin in &builtins {
                if builtin.category != PromptCategory::Session {
                    continue;
                }
                if let Some(existing) = result.iter_mut().find(|t| t.id == builtin.id) {
                    // Upgrade stale builtin prompts that are missing get_instructions
                    if !existing.prompt.contains("get_instructions") {
                        tracing::info!(id = %builtin.id, "Upgrading session prompt to include get_instructions");
                        existing.prompt = builtin.prompt.clone();
                        dirty = true;
                    }
                } else {
                    // New session template added in an update — backfill
                    result.push(builtin.clone());
                    dirty = true;
                }
            }

            // Persist fixes so we don't re-apply every load
            if dirty {
                let _ = save_templates(conn, &result);
            }

            Ok(result)
        }
        _ => {
            // First run — seed defaults
            let defaults = builtin_templates();
            save_templates(conn, &defaults)?;
            Ok(defaults)
        }
    }
}

/// Save templates to the settings DB.
fn save_templates(conn: &Connection, templates: &[PromptTemplate]) -> Result<(), AppError> {
    let json = serde_json::to_string(templates)
        .map_err(|e| AppError::Validation(format!("Failed to serialize templates: {e}")))?;
    db::settings::set_value(conn, "global", None, SETTINGS_KEY, &json)?;
    Ok(())
}

/// Validate that all required session templates are present.
fn validate_templates(templates: &[PromptTemplate]) -> Result<(), AppError> {
    let required_session_modes = ["task", "task-continue", "research", "queue", "breakdown"];
    for mode in &required_session_modes {
        let found = templates.iter().any(|t| {
            t.category == PromptCategory::Session
                && t.session_mode.as_deref() == Some(mode)
        });
        if !found {
            return Err(AppError::Validation(format!(
                "Missing required session template for mode: {mode}"
            )));
        }
    }
    Ok(())
}

// ── Public helpers (for use by session.rs, queue.rs) ──

/// Get the prompt template for a specific session mode.
/// Falls back to the built-in default if not found in the DB.
pub fn get_session_prompt(conn: &Connection, session_mode: &str) -> PromptTemplate {
    let templates = load_templates(conn).unwrap_or_else(|_| builtin_templates());
    templates
        .into_iter()
        .find(|t| {
            t.category == PromptCategory::Session
                && t.session_mode.as_deref() == Some(session_mode)
        })
        .unwrap_or_else(|| {
            // Ultimate fallback — find in builtins
            builtin_templates()
                .into_iter()
                .find(|t| t.session_mode.as_deref() == Some(session_mode))
                .expect("Built-in template must exist for all session modes")
        })
}

// ── Tauri IPC commands ──

#[tauri::command]
pub fn get_prompt_templates(
    state: State<'_, DbState>,
) -> Result<Vec<PromptTemplate>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    load_templates(&conn)
}

#[tauri::command]
pub fn set_prompt_templates(
    state: State<'_, DbState>,
    templates: Vec<PromptTemplate>,
) -> Result<(), AppError> {
    validate_templates(&templates)?;
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    save_templates(&conn, &templates)
}

#[tauri::command]
pub fn reset_prompt_templates(
    state: State<'_, DbState>,
) -> Result<Vec<PromptTemplate>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let defaults = builtin_templates();
    save_templates(&conn, &defaults)?;
    Ok(defaults)
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_templates_has_all_session_modes() {
        let templates = builtin_templates();
        let modes = ["task", "task-continue", "research", "queue", "breakdown"];
        for mode in &modes {
            assert!(
                templates.iter().any(|t| t.session_mode.as_deref() == Some(mode)),
                "Missing built-in template for session mode: {mode}"
            );
        }
    }

    #[test]
    fn builtin_templates_has_action_templates() {
        let templates = builtin_templates();
        let actions: Vec<_> = templates
            .iter()
            .filter(|t| t.category == PromptCategory::Action)
            .collect();
        assert_eq!(actions.len(), 3);
        assert!(actions.iter().all(|a| a.quick_action));
    }

    #[test]
    fn validate_templates_rejects_missing_session() {
        let templates = vec![]; // No session templates
        assert!(validate_templates(&templates).is_err());
    }

    #[test]
    fn validate_templates_accepts_complete_set() {
        let templates = builtin_templates();
        assert!(validate_templates(&templates).is_ok());
    }

    #[test]
    fn load_and_save_roundtrip() {
        let state = db::init_memory().unwrap();
        let conn = state.lock().unwrap();

        // First load should seed defaults
        let templates = load_templates(&conn).unwrap();
        assert_eq!(templates.len(), 8);

        // Modify and save
        let mut modified = templates.clone();
        modified[0].label = "Custom Label".into();
        save_templates(&conn, &modified).unwrap();

        // Reload should reflect changes
        let reloaded = load_templates(&conn).unwrap();
        assert_eq!(reloaded[0].label, "Custom Label");
    }

    #[test]
    fn get_session_prompt_returns_correct_template() {
        let state = db::init_memory().unwrap();
        let conn = state.lock().unwrap();

        let template = get_session_prompt(&conn, "task");
        assert_eq!(template.id, "task-launch");
        assert!(template.prompt.contains("{{task_id}}"));

        let research = get_session_prompt(&conn, "research");
        assert_eq!(research.id, "research");
        assert!(research.prompt.contains("update_task_plan"));
    }

    #[test]
    fn load_templates_fills_missing_session_templates() {
        let state = db::init_memory().unwrap();
        let conn = state.lock().unwrap();

        // Save only action templates (missing all session ones)
        let actions: Vec<_> = builtin_templates()
            .into_iter()
            .filter(|t| t.category == PromptCategory::Action)
            .collect();
        save_templates(&conn, &actions).unwrap();

        // Load should fill in the missing session templates
        let loaded = load_templates(&conn).unwrap();
        let session_count = loaded
            .iter()
            .filter(|t| t.category == PromptCategory::Session)
            .count();
        assert_eq!(session_count, 5);
    }

    #[test]
    fn serialization_roundtrip() {
        let templates = builtin_templates();
        let json = serde_json::to_string(&templates).unwrap();
        let deserialized: Vec<PromptTemplate> = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.len(), templates.len());
        assert_eq!(deserialized[0].id, templates[0].id);
    }
}
