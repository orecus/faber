//! Project-scoped configuration file (`.agents/faber.json`).
//!
//! This file is the **source of truth** for project settings. The DB `settings`
//! table (project scope) acts as a fast-read cache that is kept in sync.
//!
//! ## Sync rules
//! 1. File is source of truth — all writes go through the file first.
//! 2. UI writes → update file → sync to DB.
//! 3. File missing → auto-created from current DB values on project open.
//! 4. File watcher detects external edits and re-syncs to DB.
//! 5. Missing keys use defaults; unknown keys are preserved (forward compat).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::acp::permissions as acp_perms;
use crate::db;

/// Directory inside the project root that holds Faber config and task files.
const AGENTS_DIR: &str = ".agents";
/// Name of the project config file.
const CONFIG_FILE: &str = "faber.json";

// ── Config structs ──
//
// All fields are always serialized (no skip_serializing_if) so the config file
// is always complete — users can see and edit every setting even if they haven't
// changed it from the default.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    #[serde(default = "default_agent")]
    pub default_agent: String,

    /// Model override. When null/empty, the agent CLI uses its own default.
    #[serde(default)]
    pub default_model: Option<String>,

    #[serde(default = "default_transport")]
    pub default_transport: String,

    #[serde(default = "default_branch_pattern")]
    pub branch_naming_pattern: String,

    /// Relative path from project root (e.g. "CLAUDE.md"). Null means auto-detect.
    #[serde(default)]
    pub instruction_file_path: Option<String>,

    #[serde(default = "default_true")]
    pub worktree_auto_cleanup: bool,

    #[serde(default = "default_true")]
    pub task_files_to_disk: bool,

    #[serde(default)]
    pub github: GitHubConfig,

    #[serde(default)]
    pub acp: AcpConfig,

        #[serde(default = "default_priorities")]
    pub priorities: Vec<PriorityLevel>,

    /// Catch-all for unknown keys (forward compatibility).
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// A user-configurable priority level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PriorityLevel {
    /// Unique ID stored in task frontmatter/DB (e.g. "P0", "P1").
    pub id: String,
    /// Human-readable display name (e.g. "Critical", "High").
    pub label: String,
    /// Theme color name (e.g. "red", "amber", "blue", "gray"). Matches the project accent color palette.
    pub color: String,
    /// Sort order (lower = higher priority).
    pub order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubConfig {
    #[serde(default)]
    pub sync_enabled: bool,

    #[serde(default = "default_true")]
    pub auto_close: bool,

    #[serde(default = "default_true")]
    pub auto_reopen: bool,

    #[serde(default = "default_true")]
    pub pr_closes_ref: bool,

    #[serde(default)]
    pub label_sync: bool,

    #[serde(default)]
    pub label_mapping: HashMap<String, String>,

    #[serde(default = "default_true")]
    pub merge_detection: bool,

    #[serde(default)]
    pub sync_defaults: GitHubSyncDefaults,
}

impl Default for GitHubConfig {
    fn default() -> Self {
        Self {
            sync_enabled: false,
            auto_close: true,
            auto_reopen: true,
            pr_closes_ref: true,
            label_sync: false,
            label_mapping: HashMap::new(),
            merge_detection: true,
            sync_defaults: GitHubSyncDefaults::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSyncDefaults {
    #[serde(default)]
    pub title: bool,

    #[serde(default)]
    pub body: bool,

    #[serde(default)]
    pub status: bool,

    #[serde(default)]
    pub labels: bool,
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AcpConfig {
    /// Trust mode for autonomous operation (e.g. continuous mode).
    /// Values: "auto_approve", "normal", "deny_writes"
    #[serde(default = "default_normal")]
    pub trust_mode_policy: String,

    /// Default action when no permission rule matches.
    /// Values: "ask", "auto_approve", "deny"
    #[serde(default = "default_ask")]
    pub default_policy: String,

    /// Seconds to wait for user response before auto-denying (10–600).
    #[serde(default = "default_permission_timeout")]
    pub permission_timeout: u32,

    /// Permission rules — portable across machines when checked into git.
    #[serde(default)]
    pub rules: Vec<AcpPermissionRule>,
}

/// A permission rule stored in the config file.
/// DB-only fields (id, project_id, created_at) are not included.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AcpPermissionRule {
    pub capability: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_pattern: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_pattern: Option<String>,
    /// Values: "auto_approve", "ask", "deny"
    pub action: String,
}

impl Default for AcpConfig {
    fn default() -> Self {
        Self {
            trust_mode_policy: "normal".to_string(),
            default_policy: "ask".to_string(),
            permission_timeout: 120,
            rules: Vec::new(),
        }
    }
}

impl Default for ProjectConfig {
    fn default() -> Self {
        Self {
            default_agent: default_agent(),
            default_model: None,
            default_transport: default_transport(),
            branch_naming_pattern: default_branch_pattern(),
            instruction_file_path: None,
            worktree_auto_cleanup: true,
            task_files_to_disk: true,
            github: GitHubConfig::default(),
            acp: AcpConfig::default(),
            priorities: default_priorities(),
            extra: serde_json::Map::new(),
        }
    }
}

fn default_true() -> bool {
    true
}
fn default_ask() -> String {
    "ask".to_string()
}
fn default_normal() -> String {
    "normal".to_string()
}
fn default_permission_timeout() -> u32 {
    120
}
fn default_agent() -> String {
    "claude-code".to_string()
}
fn default_transport() -> String {
    "pty".to_string()
}
fn default_branch_pattern() -> String {
    crate::git::DEFAULT_BRANCH_PATTERN.to_string()
}
fn default_priorities() -> Vec<PriorityLevel> {
    vec![
        PriorityLevel { id: "P0".into(), label: "Critical".into(), color: "red".into(), order: 0 },
        PriorityLevel { id: "P1".into(), label: "High".into(), color: "amber".into(), order: 1 },
        PriorityLevel { id: "P2".into(), label: "Normal".into(), color: "gray".into(), order: 2 },
    ]
}

// ── File helpers ──

/// Returns `<project_root>/.agents/faber.json`.
pub fn config_path(project_root: &Path) -> PathBuf {
    project_root.join(AGENTS_DIR).join(CONFIG_FILE)
}

/// Load config from disk. Returns `Default` if the file is missing.
/// On parse errors, logs a warning and returns `Default` (never overwrites a
/// corrupt file — let the user fix it).
pub fn load(project_root: &Path) -> ProjectConfig {
    let path = config_path(project_root);
    if !path.is_file() {
        return ProjectConfig::default();
    }

    match std::fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<ProjectConfig>(&content) {
            Ok(cfg) => cfg,
            Err(e) => {
                warn!(path = %path.display(), %e, "Corrupt faber.json — using defaults");
                ProjectConfig::default()
            }
        },
        Err(e) => {
            warn!(path = %path.display(), %e, "Cannot read faber.json — using defaults");
            ProjectConfig::default()
        }
    }
}

/// Save config to disk (pretty-printed JSON). Creates `.agents/` if needed.
/// Uses atomic write (write to temp, rename) to avoid partial writes.
pub fn save(project_root: &Path, config: &ProjectConfig) -> Result<(), String> {
    let path = config_path(project_root);
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;

    let json =
        serde_json::to_string_pretty(config).map_err(|e| format!("Serialization error: {e}"))?;

    // Atomic write: write to temp file, then rename
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, json.as_bytes())
        .map_err(|e| format!("Cannot write {}: {e}", tmp_path.display()))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Cannot rename to {}: {e}", path.display()))?;

    debug!(path = %path.display(), "Saved faber.json");
    Ok(())
}

// ── Path conversion helpers ──

/// Convert an absolute path to relative (for storing in config file).
/// If the path is already relative or None, returns as-is.
fn to_relative_path(abs_path: Option<&str>, project_root: &str) -> Option<String> {
    let abs = abs_path?;
    let root = project_root.replace('\\', "/");
    let normalized = abs.replace('\\', "/");

    if let Some(rel) = normalized.strip_prefix(&root) {
        let rel = rel.trim_start_matches('/');
        if rel.is_empty() {
            None
        } else {
            Some(rel.to_string())
        }
    } else {
        // Already relative or different root — store as-is
        Some(abs.to_string())
    }
}

/// Convert a relative path to absolute (for storing in DB).
/// If None, returns None. If already absolute, returns as-is.
fn to_absolute_path(rel_path: Option<&str>, project_root: &Path) -> Option<String> {
    let rel = rel_path?;
    let p = Path::new(rel);
    if p.is_absolute() {
        Some(rel.to_string())
    } else {
        let abs = project_root.join(rel);
        Some(crate::git::strip_unc_prefix(&abs.to_string_lossy()).into_owned())
    }
}

// ── DB ↔ File sync ──

/// Helper to read a bool setting from DB ("true"/"false" strings).
fn db_bool(
    conn: &Connection,
    project_id: &str,
    key: &str,
    default: bool,
) -> bool {
    match db::settings::get_value(conn, "project", Some(project_id), key) {
        Ok(Some(v)) => v != "false",
        _ => default,
    }
}

/// Helper to read a string setting from DB.
fn db_string(conn: &Connection, project_id: &str, key: &str) -> Option<String> {
    db::settings::get_value(conn, "project", Some(project_id), key)
        .ok()
        .flatten()
}

/// Build a `ProjectConfig` from the current DB state (project columns + settings).
/// Used for the initial migration when no faber.json exists yet.
pub fn from_db(conn: &Connection, project_id: &str) -> ProjectConfig {
    let mut cfg = ProjectConfig::default();

    // Project columns
    if let Ok(Some(project)) = db::projects::get(conn, project_id) {
        if let Some(agent) = project.default_agent {
            cfg.default_agent = agent;
        }
        cfg.default_model = project.default_model;
        if let Some(pattern) = project.branch_naming_pattern {
            cfg.branch_naming_pattern = pattern;
        }
        // Convert absolute instruction path → relative for the config file
        cfg.instruction_file_path =
            to_relative_path(project.instruction_file_path.as_deref(), &project.path);
    }

    // Settings table (project scope)
    cfg.task_files_to_disk = db_bool(conn, project_id, "task_files_to_disk", true);
    cfg.worktree_auto_cleanup = db_bool(conn, project_id, "worktree_auto_cleanup", true);
    if let Some(transport) = db_string(conn, project_id, "default_transport") {
        cfg.default_transport = transport;
    }

    // ACP
    if let Some(v) = db_string(conn, project_id, "acp_trust_mode_policy") {
        cfg.acp.trust_mode_policy = v;
    }
    if let Some(v) = db_string(conn, project_id, "acp_default_policy") {
        cfg.acp.default_policy = v;
    }
    if let Some(v) = db_string(conn, project_id, "acp_permission_timeout") {
        if let Ok(n) = v.parse::<u32>() {
            cfg.acp.permission_timeout = n;
        }
    }

    // ACP permission rules
    if let Ok(rules) = acp_perms::list_rules(conn, project_id) {
        cfg.acp.rules = rules
            .into_iter()
            .map(|r| AcpPermissionRule {
                capability: r.capability,
                path_pattern: r.path_pattern,
                command_pattern: r.command_pattern,
                action: r.action.as_str().to_string(),
            })
            .collect();
    }

    // GitHub
    cfg.github.sync_enabled = db_bool(conn, project_id, "github_sync_enabled", false);
    cfg.github.auto_close = db_bool(conn, project_id, "github_auto_close", true);
    cfg.github.auto_reopen = db_bool(conn, project_id, "github_auto_reopen", true);
    cfg.github.pr_closes_ref = db_bool(conn, project_id, "github_pr_closes_ref", true);
    cfg.github.label_sync = db_bool(conn, project_id, "github_label_sync", false);
    cfg.github.merge_detection = db_bool(conn, project_id, "github_merge_detection", true);

    // GitHub label mapping (stored as JSON string in DB)
    if let Some(v) = db_string(conn, project_id, "github_label_mapping") {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&v) {
            cfg.github.label_mapping = map;
        }
    }

    // GitHub sync defaults
    cfg.github.sync_defaults.title =
        db_bool(conn, project_id, "github_sync_default_title", false);
    cfg.github.sync_defaults.body =
        db_bool(conn, project_id, "github_sync_default_body", false);
    cfg.github.sync_defaults.status =
        db_bool(conn, project_id, "github_sync_default_status", false);
    cfg.github.sync_defaults.labels =
        db_bool(conn, project_id, "github_sync_default_labels", false);

    cfg
}

/// Helper to write a bool setting to DB.
fn set_bool(
    conn: &Connection,
    project_id: &str,
    key: &str,
    value: bool,
) -> Result<(), String> {
    db::settings::set_value(
        conn,
        "project",
        Some(project_id),
        key,
        if value { "true" } else { "false" },
    )
    .map_err(|e| format!("Setting {key}: {e}"))
}

/// Helper to write a string setting to DB.
fn set_string(
    conn: &Connection,
    project_id: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    db::settings::set_value(conn, "project", Some(project_id), key, value)
        .map_err(|e| format!("Setting {key}: {e}"))
}

/// Sync a `ProjectConfig` into the DB (project columns + settings).
/// This is called after loading from file to keep the DB cache up-to-date.
/// `project_root` is needed to convert relative instruction paths back to absolute.
pub fn sync_to_db(
    conn: &Connection,
    project_id: &str,
    project_root: &Path,
    cfg: &ProjectConfig,
) -> Result<(), String> {
    // Convert relative instruction path → absolute for DB storage
    let abs_instruction_path = to_absolute_path(cfg.instruction_file_path.as_deref(), project_root);

    // Update project columns
    let upd = db::models::UpdateProject {
        name: None,
        default_agent: Some(Some(cfg.default_agent.clone())),
        default_model: Some(cfg.default_model.clone()),
        branch_naming_pattern: Some(Some(cfg.branch_naming_pattern.clone())),
        instruction_file_path: Some(abs_instruction_path),
        icon_path: None,
        color: None,
    };
    db::projects::update(conn, project_id, &upd).map_err(|e| format!("DB update failed: {e}"))?;

    // Core settings
    set_bool(conn, project_id, "task_files_to_disk", cfg.task_files_to_disk)?;
    set_bool(conn, project_id, "worktree_auto_cleanup", cfg.worktree_auto_cleanup)?;
    set_string(conn, project_id, "default_transport", &cfg.default_transport)?;

    // ACP
    set_string(conn, project_id, "acp_trust_mode_policy", &cfg.acp.trust_mode_policy)?;
    set_string(conn, project_id, "acp_default_policy", &cfg.acp.default_policy)?;
    set_string(
        conn,
        project_id,
        "acp_permission_timeout",
        &cfg.acp.permission_timeout.to_string(),
    )?;

    // ACP permission rules — replace all DB rules with what's in the config file
    acp_perms::delete_all_rules(conn, project_id)
        .map_err(|e| format!("Delete ACP rules: {e}"))?;
    for rule in &cfg.acp.rules {
        let action = acp_perms::PermissionAction::from_str(&rule.action)
            .unwrap_or(acp_perms::PermissionAction::Ask);
        acp_perms::create_rule(
            conn,
            project_id,
            &rule.capability,
            rule.path_pattern.as_deref(),
            rule.command_pattern.as_deref(),
            action,
        )
        .map_err(|e| format!("Create ACP rule: {e}"))?;
    }

    // GitHub
    set_bool(conn, project_id, "github_sync_enabled", cfg.github.sync_enabled)?;
    set_bool(conn, project_id, "github_auto_close", cfg.github.auto_close)?;
    set_bool(conn, project_id, "github_auto_reopen", cfg.github.auto_reopen)?;
    set_bool(conn, project_id, "github_pr_closes_ref", cfg.github.pr_closes_ref)?;
    set_bool(conn, project_id, "github_label_sync", cfg.github.label_sync)?;
    set_bool(conn, project_id, "github_merge_detection", cfg.github.merge_detection)?;

    // GitHub label mapping (stored as JSON string)
    let label_json = serde_json::to_string(&cfg.github.label_mapping)
        .unwrap_or_else(|_| "{}".to_string());
    set_string(conn, project_id, "github_label_mapping", &label_json)?;

    // GitHub sync defaults
    set_bool(conn, project_id, "github_sync_default_title", cfg.github.sync_defaults.title)?;
    set_bool(conn, project_id, "github_sync_default_body", cfg.github.sync_defaults.body)?;
    set_bool(conn, project_id, "github_sync_default_status", cfg.github.sync_defaults.status)?;
    set_bool(conn, project_id, "github_sync_default_labels", cfg.github.sync_defaults.labels)?;

    debug!(project_id, "Synced faber.json → DB");
    Ok(())
}

/// Ensure `.agents/faber.json` exists for a project.
/// - If the file exists: load it and sync to DB.
/// - If the file is missing: build from DB and write it.
///
/// Returns the loaded/created config.
pub fn ensure_config(
    conn: &Connection,
    project_id: &str,
    project_root: &Path,
) -> Result<ProjectConfig, String> {
    let path = config_path(project_root);

    if path.is_file() {
        // File exists — load and sync to DB
        let cfg = load(project_root);
        sync_to_db(conn, project_id, project_root, &cfg)?;
        debug!(project_id, "Loaded faber.json → synced to DB");
        Ok(cfg)
    } else {
        // File missing — build from DB and write
        let cfg = from_db(conn, project_id);
        save(project_root, &cfg)?;
        debug!(project_id, "Created faber.json from DB defaults");
        Ok(cfg)
    }
}

/// Update a single setting in the config file and sync to DB.
/// This is the write path for UI changes.
pub fn update_setting(
    conn: &Connection,
    project_id: &str,
    project_root: &Path,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let mut cfg = load(project_root);

    match key {
        // Core
        "task_files_to_disk" => cfg.task_files_to_disk = value != "false",
        "worktree_auto_cleanup" => cfg.worktree_auto_cleanup = value != "false",
        "default_transport" => cfg.default_transport = value.to_string(),

        // ACP
        "acp_trust_mode_policy" => cfg.acp.trust_mode_policy = value.to_string(),
        "acp_default_policy" => cfg.acp.default_policy = value.to_string(),
        "acp_permission_timeout" => {
            if let Ok(n) = value.parse::<u32>() {
                cfg.acp.permission_timeout = n;
            }
        }

        // GitHub
        "github_sync_enabled" => cfg.github.sync_enabled = value != "false",
        "github_auto_close" => cfg.github.auto_close = value != "false",
        "github_auto_reopen" => cfg.github.auto_reopen = value != "false",
        "github_pr_closes_ref" => cfg.github.pr_closes_ref = value != "false",
        "github_label_sync" => cfg.github.label_sync = value != "false",
        "github_merge_detection" => cfg.github.merge_detection = value != "false",
        "github_label_mapping" => {
            if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(value) {
                cfg.github.label_mapping = map;
            }
        }

        // Priorities
        "priorities" => {
            if let Ok(priorities) = serde_json::from_str::<Vec<PriorityLevel>>(value) {
                cfg.priorities = priorities;
            }
        }

        // GitHub sync defaults
        "github_sync_default_title" => cfg.github.sync_defaults.title = value != "false",
        "github_sync_default_body" => cfg.github.sync_defaults.body = value != "false",
        "github_sync_default_status" => cfg.github.sync_defaults.status = value != "false",
        "github_sync_default_labels" => cfg.github.sync_defaults.labels = value != "false",

        _ => {
            // Store unknown keys in the settings DB only (don't put them in the file)
            db::settings::set_value(conn, "project", Some(project_id), key, value)
                .map_err(|e| format!("Setting {key}: {e}"))?;
            return Ok(());
        }
    }

    save(project_root, &cfg)?;
    sync_to_db(conn, project_id, project_root, &cfg)?;
    Ok(())
}

/// Update project-level fields (agent, model, branch pattern, instruction file)
/// in the config file and sync to DB.
///
/// The `instruction_file_path` from the frontend may be absolute — we convert
/// it to relative before storing in the config file.
pub fn update_project_fields(
    conn: &Connection,
    project_id: &str,
    project_root: &Path,
    default_agent: Option<Option<String>>,
    default_model: Option<Option<String>>,
    branch_naming_pattern: Option<Option<String>>,
    instruction_file_path: Option<Option<String>>,
) -> Result<(), String> {
    let path = config_path(project_root);
    if !path.is_file() {
        // No config file yet — just update DB directly (will be created on next project open)
        return Ok(());
    }

    let mut cfg = load(project_root);
    let root_str = crate::git::strip_unc_prefix(&project_root.to_string_lossy()).into_owned();

    if let Some(v) = default_agent {
        cfg.default_agent = v.unwrap_or_else(self::default_agent);
    }
    if let Some(v) = default_model {
        cfg.default_model = v;
    }
    if let Some(v) = branch_naming_pattern {
        cfg.branch_naming_pattern = v.unwrap_or_else(self::default_branch_pattern);
    }
    if let Some(v) = instruction_file_path {
        // Convert absolute → relative for config file
        cfg.instruction_file_path = to_relative_path(v.as_deref(), &root_str);
    }

    save(project_root, &cfg)?;
    sync_to_db(conn, project_id, project_root, &cfg)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn default_config_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let cfg = ProjectConfig::default();
        save(tmp.path(), &cfg).unwrap();

        let loaded = load(tmp.path());
        assert_eq!(loaded.task_files_to_disk, true);
        assert_eq!(loaded.worktree_auto_cleanup, true);
        assert_eq!(loaded.acp.trust_mode_policy, "normal");
        assert_eq!(loaded.default_agent, "claude-code");
        assert_eq!(loaded.default_transport, "pty");
        assert_eq!(loaded.branch_naming_pattern, crate::git::DEFAULT_BRANCH_PATTERN);
        assert!(loaded.default_model.is_none());
        // GitHub defaults
        assert_eq!(loaded.github.sync_enabled, false);
        assert_eq!(loaded.github.auto_close, true);
        assert_eq!(loaded.github.auto_reopen, true);
        assert_eq!(loaded.github.pr_closes_ref, true);
        assert_eq!(loaded.github.label_sync, false);
        assert_eq!(loaded.github.merge_detection, true);
        assert!(loaded.github.label_mapping.is_empty());
        assert_eq!(loaded.github.sync_defaults.title, false);
    }

    #[test]
    fn default_config_writes_all_fields() {
        let tmp = TempDir::new().unwrap();
        let cfg = ProjectConfig::default();
        save(tmp.path(), &cfg).unwrap();

        // Read the raw JSON and verify all top-level keys are present
        let raw = std::fs::read_to_string(config_path(tmp.path())).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let obj = json.as_object().unwrap();

        // All expected top-level keys should be present
        assert!(obj.contains_key("defaultAgent"), "missing defaultAgent");
        assert!(obj.contains_key("defaultModel"), "missing defaultModel");
        assert!(obj.contains_key("defaultTransport"), "missing defaultTransport");
        assert!(obj.contains_key("branchNamingPattern"), "missing branchNamingPattern");
        assert!(obj.contains_key("instructionFilePath"), "missing instructionFilePath");
        assert!(obj.contains_key("worktreeAutoCleanup"), "missing worktreeAutoCleanup");
        assert!(obj.contains_key("taskFilesToDisk"), "missing taskFilesToDisk");
        assert!(obj.contains_key("github"), "missing github");
        assert!(obj.contains_key("acp"), "missing acp");
        assert!(obj.contains_key("priorities"), "missing priorities");

        // GitHub nested keys
        let gh = obj["github"].as_object().unwrap();
        assert!(gh.contains_key("syncEnabled"), "missing github.syncEnabled");
        assert!(gh.contains_key("autoClose"), "missing github.autoClose");
        assert!(gh.contains_key("autoReopen"), "missing github.autoReopen");
        assert!(gh.contains_key("prClosesRef"), "missing github.prClosesRef");
        assert!(gh.contains_key("labelSync"), "missing github.labelSync");
        assert!(gh.contains_key("labelMapping"), "missing github.labelMapping");
        assert!(gh.contains_key("mergeDetection"), "missing github.mergeDetection");
        assert!(gh.contains_key("syncDefaults"), "missing github.syncDefaults");
    }

    #[test]
    fn custom_config_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let mut cfg = ProjectConfig::default();
        cfg.default_agent = "gemini".to_string();
        cfg.default_model = Some("sonnet".to_string());
        cfg.default_transport = "acp".to_string();
        cfg.branch_naming_pattern = "fix/{{task_id}}".to_string();
        cfg.task_files_to_disk = false;
        cfg.acp.trust_mode_policy = "auto_approve".to_string();
        cfg.github.sync_enabled = true;
        cfg.github.auto_close = false;
        cfg.github.label_mapping.insert("done".to_string(), "completed".to_string());
        cfg.github.sync_defaults.title = true;

        save(tmp.path(), &cfg).unwrap();
        let loaded = load(tmp.path());

        assert_eq!(loaded.default_agent.as_str(), "gemini");
        assert_eq!(loaded.default_model.as_deref(), Some("sonnet"));
        assert_eq!(loaded.default_transport.as_str(), "acp");
        assert_eq!(loaded.branch_naming_pattern.as_str(), "fix/{{task_id}}");
        assert_eq!(loaded.task_files_to_disk, false);
        assert_eq!(loaded.acp.trust_mode_policy, "auto_approve");
        assert_eq!(loaded.github.sync_enabled, true);
        assert_eq!(loaded.github.auto_close, false);
        assert_eq!(loaded.github.label_mapping.get("done").unwrap(), "completed");
        assert_eq!(loaded.github.sync_defaults.title, true);
    }

    #[test]
    fn missing_file_returns_default() {
        let tmp = TempDir::new().unwrap();
        let cfg = load(tmp.path());
        assert_eq!(cfg.task_files_to_disk, true);
        assert_eq!(cfg.default_agent, "claude-code");
    }

    #[test]
    fn corrupt_json_returns_default() {
        let tmp = TempDir::new().unwrap();
        let agents_dir = tmp.path().join(AGENTS_DIR);
        std::fs::create_dir_all(&agents_dir).unwrap();
        std::fs::write(agents_dir.join(CONFIG_FILE), "not valid json{{{").unwrap();

        let cfg = load(tmp.path());
        assert_eq!(cfg.task_files_to_disk, true);
    }

    #[test]
    fn partial_json_uses_defaults_for_missing_keys() {
        let tmp = TempDir::new().unwrap();
        let agents_dir = tmp.path().join(AGENTS_DIR);
        std::fs::create_dir_all(&agents_dir).unwrap();
        std::fs::write(
            agents_dir.join(CONFIG_FILE),
            r#"{ "defaultAgent": "gemini" }"#,
        )
        .unwrap();

        let cfg = load(tmp.path());
        assert_eq!(cfg.default_agent.as_str(), "gemini");
        assert_eq!(cfg.task_files_to_disk, true);
        assert_eq!(cfg.acp.trust_mode_policy, "normal");
        assert_eq!(cfg.github.auto_close, true); // nested default works
    }

    #[test]
    fn unknown_keys_preserved() {
        let tmp = TempDir::new().unwrap();
        let agents_dir = tmp.path().join(AGENTS_DIR);
        std::fs::create_dir_all(&agents_dir).unwrap();
        std::fs::write(
            agents_dir.join(CONFIG_FILE),
            r#"{ "defaultAgent": "claude", "futureKey": 42 }"#,
        )
        .unwrap();

        let cfg = load(tmp.path());
        assert_eq!(cfg.default_agent.as_str(), "claude");
        assert_eq!(cfg.extra.get("futureKey").unwrap(), &serde_json::json!(42));

        // Save and reload — unknown key should survive
        save(tmp.path(), &cfg).unwrap();
        let reloaded = load(tmp.path());
        assert_eq!(
            reloaded.extra.get("futureKey").unwrap(),
            &serde_json::json!(42)
        );
    }

    #[test]
    fn config_path_correct() {
        let root = Path::new("/projects/myapp");
        let path = config_path(root);
        assert!(path.to_string_lossy().contains(".agents"));
        assert!(path.to_string_lossy().ends_with("faber.json"));
    }

    #[test]
    fn from_db_builds_from_settings() {
        let state = crate::db::init_memory().unwrap();
        let conn = state.lock().unwrap();

        // Create a project
        let project = db::projects::create(
            &conn,
            &db::models::NewProject {
                name: "test".to_string(),
                path: "/tmp/test".to_string(),
                default_agent: Some("claude".to_string()),
                default_model: Some("opus".to_string()),
                branch_naming_pattern: None,
                instruction_file_path: None,
            },
        )
        .unwrap();

        // Set some project settings
        db::settings::set_value(&conn, "project", Some(&project.id), "task_files_to_disk", "false")
            .unwrap();
        // ACP settings (project scope)
        db::settings::set_value(
            &conn, "project", Some(&project.id), "acp_trust_mode_policy", "auto_approve",
        ).unwrap();
        db::settings::set_value(
            &conn, "project", Some(&project.id), "acp_default_policy", "deny",
        ).unwrap();
        db::settings::set_value(
            &conn, "project", Some(&project.id), "acp_permission_timeout", "60",
        ).unwrap();

        db::settings::set_value(
            &conn,
            "project",
            Some(&project.id),
            "github_sync_enabled",
            "true",
        )
        .unwrap();
        db::settings::set_value(
            &conn,
            "project",
            Some(&project.id),
            "github_auto_close",
            "false",
        )
        .unwrap();
        db::settings::set_value(
            &conn,
            "project",
            Some(&project.id),
            "github_label_mapping",
            r#"{"done":"completed"}"#,
        )
        .unwrap();

        let cfg = from_db(&conn, &project.id);
        assert_eq!(cfg.default_agent.as_str(), "claude");
        assert_eq!(cfg.default_model.as_deref(), Some("opus"));
        assert_eq!(cfg.task_files_to_disk, false);
        assert_eq!(cfg.acp.trust_mode_policy, "auto_approve");
        assert_eq!(cfg.acp.default_policy, "deny");
        assert_eq!(cfg.acp.permission_timeout, 60);
        assert_eq!(cfg.github.sync_enabled, true);
        assert_eq!(cfg.github.auto_close, false);
        assert_eq!(cfg.github.label_mapping.get("done").unwrap(), "completed");
    }

    #[test]
    fn sync_to_db_writes_github_settings() {
        let state = crate::db::init_memory().unwrap();
        let conn = state.lock().unwrap();

        let project = db::projects::create(
            &conn,
            &db::models::NewProject {
                name: "test".to_string(),
                path: "/tmp/test".to_string(),
                default_agent: None,
                default_model: None,
                branch_naming_pattern: None,
                instruction_file_path: None,
            },
        )
        .unwrap();

        let mut cfg = ProjectConfig::default();
        cfg.github.sync_enabled = true;
        cfg.github.auto_close = false;
        cfg.github.sync_defaults.title = true;

        sync_to_db(&conn, &project.id, Path::new("/tmp/test"), &cfg).unwrap();

        // Verify values in DB
        let v = db::settings::get_value(&conn, "project", Some(&project.id), "github_sync_enabled")
            .unwrap();
        assert_eq!(v, Some("true".to_string()));

        let v = db::settings::get_value(&conn, "project", Some(&project.id), "github_auto_close")
            .unwrap();
        assert_eq!(v, Some("false".to_string()));

        let v = db::settings::get_value(
            &conn,
            "project",
            Some(&project.id),
            "github_sync_default_title",
        )
        .unwrap();
        assert_eq!(v, Some("true".to_string()));
    }

    #[test]
    fn to_relative_path_strips_project_root() {
        assert_eq!(
            to_relative_path(Some("/projects/myapp/CLAUDE.md"), "/projects/myapp"),
            Some("CLAUDE.md".to_string())
        );
        assert_eq!(
            to_relative_path(Some("/projects/myapp/docs/AGENTS.md"), "/projects/myapp"),
            Some("docs/AGENTS.md".to_string())
        );
    }

    #[test]
    fn to_relative_path_handles_windows_paths() {
        assert_eq!(
            to_relative_path(Some("D:\\Projects\\myapp\\CLAUDE.md"), "D:\\Projects\\myapp"),
            Some("CLAUDE.md".to_string())
        );
    }

    #[test]
    fn to_relative_path_preserves_already_relative() {
        assert_eq!(
            to_relative_path(Some("CLAUDE.md"), "/projects/myapp"),
            Some("CLAUDE.md".to_string())
        );
    }

    #[test]
    fn to_relative_path_none_stays_none() {
        assert_eq!(to_relative_path(None, "/projects/myapp"), None);
    }

    #[test]
    fn to_absolute_path_joins_relative() {
        let result = to_absolute_path(Some("CLAUDE.md"), Path::new("/projects/myapp"));
        assert!(result.is_some());
        let abs = result.unwrap();
        assert!(abs.contains("CLAUDE.md"));
        assert!(abs.contains("myapp"));
    }

    #[test]
    fn to_absolute_path_preserves_absolute() {
        let result = to_absolute_path(Some("/other/path/FILE.md"), Path::new("/projects/myapp"));
        assert_eq!(result, Some("/other/path/FILE.md".to_string()));
    }

    #[test]
    fn to_absolute_path_none_stays_none() {
        assert_eq!(to_absolute_path(None, Path::new("/projects/myapp")), None);
    }
}
