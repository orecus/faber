//! ACP Permission Policy Engine.
//!
//! Evaluates permission requests from ACP agents against per-project rules
//! stored in the settings database. Rules are checked most-specific-first
//! and fall back to a configurable default policy.
//!
//! Rule resolution order:
//! 1. Exact capability + path/command pattern match
//! 2. Capability-only match (no path/command filter)
//! 3. Project default policy
//! 4. Global default policy (ask)

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::db;

// ── Types ──

/// The action to take for a permission request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionAction {
    /// Automatically approve without prompting the user.
    AutoApprove,
    /// Show a dialog asking the user to approve or deny.
    Ask,
    /// Automatically deny without prompting the user.
    Deny,
}

impl PermissionAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AutoApprove => "auto_approve",
            Self::Ask => "ask",
            Self::Deny => "deny",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "auto_approve" => Some(Self::AutoApprove),
            "ask" => Some(Self::Ask),
            "deny" => Some(Self::Deny),
            _ => None,
        }
    }
}

/// A capability type that an agent might request permission for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityType {
    FsRead,
    FsWrite,
    Terminal,
    /// Catch-all for unknown or future capability types.
    Other(String),
}

impl CapabilityType {
    pub fn as_str(&self) -> &str {
        match self {
            Self::FsRead => "fs_read",
            Self::FsWrite => "fs_write",
            Self::Terminal => "terminal",
            Self::Other(s) => s,
        }
    }

    #[allow(dead_code)]
    pub fn parse(s: &str) -> Self {
        match s {
            "fs_read" => Self::FsRead,
            "fs_write" => Self::FsWrite,
            "terminal" => Self::Terminal,
            other => Self::Other(other.to_string()),
        }
    }
}

/// A single permission rule stored in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRule {
    pub id: String,
    pub project_id: String,
    pub capability: String,
    pub path_pattern: Option<String>,
    pub command_pattern: Option<String>,
    pub action: PermissionAction,
    pub created_at: String,
}

/// A permission decision to be logged.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    Approved,
    Denied,
    AutoApproved,
    AutoDenied,
}

impl PermissionDecision {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Approved => "approved",
            Self::Denied => "denied",
            Self::AutoApproved => "auto_approved",
            Self::AutoDenied => "auto_denied",
        }
    }
}

/// A logged permission decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionLogEntry {
    pub id: String,
    pub session_id: String,
    pub project_id: String,
    pub capability: String,
    pub detail: String,
    pub decision: String,
    pub decided_at: String,
}

/// Context for evaluating a permission request.
#[derive(Debug, Clone)]
pub struct PermissionContext {
    pub project_id: String,
    #[allow(dead_code)]
    pub session_id: String,
    pub capability: CapabilityType,
    /// File path (for fs_read/fs_write) or command string (for terminal).
    pub detail: String,
    /// Whether the session is running in trust mode (e.g. continuous mode auto-launch).
    /// When true, the trust mode policy overrides normal rule evaluation.
    pub is_trust_mode: bool,
}

// ── Policy Engine ──

/// Evaluate a permission request against the project's rules.
///
/// Returns the action to take (auto_approve, ask, or deny).
pub fn evaluate(conn: &Connection, ctx: &PermissionContext) -> PermissionAction {
    // 1. Check trust mode override
    if ctx.is_trust_mode {
        let trust_policy = get_trust_mode_policy(conn, &ctx.project_id);
        match trust_policy.as_deref() {
            Some("auto_approve") => {
                debug!(
                    project_id = %ctx.project_id,
                    capability = %ctx.capability.as_str(),
                    "Trust mode: auto-approving"
                );
                return PermissionAction::AutoApprove;
            }
            Some("deny_writes") => {
                // Auto-approve reads, deny writes/terminal
                match ctx.capability {
                    CapabilityType::FsRead => return PermissionAction::AutoApprove,
                    CapabilityType::FsWrite | CapabilityType::Terminal => {
                        return PermissionAction::Deny;
                    }
                    CapabilityType::Other(_) => return PermissionAction::Ask,
                }
            }
            // "normal" or unset → fall through to normal rule evaluation
            _ => {}
        }
    }

    // 2. Load project rules and check against them
    let rules = match list_rules(conn, &ctx.project_id) {
        Ok(rules) => rules,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to load permission rules, defaulting to ask");
            return PermissionAction::Ask;
        }
    };

    let capability_str = ctx.capability.as_str();

    // 2a. Check rules with path/command patterns first (most specific)
    for rule in &rules {
        if rule.capability != capability_str && rule.capability != "*" {
            continue;
        }
        // Check if there's a pattern and if it matches
        if let Some(ref pattern) = rule.path_pattern {
            if matches_glob(pattern, &ctx.detail) {
                debug!(
                    rule_id = %rule.id,
                    capability = %capability_str,
                    pattern = %pattern,
                    detail = %ctx.detail,
                    action = %rule.action.as_str(),
                    "Permission rule matched (path pattern)"
                );
                return rule.action;
            }
        } else if let Some(ref pattern) = rule.command_pattern {
            if matches_glob(pattern, &ctx.detail) {
                debug!(
                    rule_id = %rule.id,
                    capability = %capability_str,
                    pattern = %pattern,
                    detail = %ctx.detail,
                    action = %rule.action.as_str(),
                    "Permission rule matched (command pattern)"
                );
                return rule.action;
            }
        }
    }

    // 2b. Check capability-only rules (no path/command filter)
    for rule in &rules {
        if rule.capability != capability_str && rule.capability != "*" {
            continue;
        }
        if rule.path_pattern.is_none() && rule.command_pattern.is_none() {
            debug!(
                rule_id = %rule.id,
                capability = %capability_str,
                action = %rule.action.as_str(),
                "Permission rule matched (capability-only)"
            );
            return rule.action;
        }
    }

    // 3. Check project default policy
    let project_default = get_project_default_policy(conn, &ctx.project_id);
    if let Some(action) = project_default {
        debug!(
            project_id = %ctx.project_id,
            action = %action.as_str(),
            "Using project default policy"
        );
        return action;
    }

    // 4. Global default: ask
    debug!(
        project_id = %ctx.project_id,
        capability = %capability_str,
        "No matching rule, defaulting to ask"
    );
    PermissionAction::Ask
}

/// Log a permission decision to the database.
pub fn log_decision(
    conn: &Connection,
    session_id: &str,
    project_id: &str,
    capability: &str,
    detail: &str,
    decision: &PermissionDecision,
) {
    let id = db::generate_id("perm");
    if let Err(e) = conn.execute(
        "INSERT INTO acp_permission_log (id, session_id, project_id, capability, detail, decision)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, session_id, project_id, capability, detail, decision.as_str()],
    ) {
        tracing::warn!(error = %e, "Failed to log permission decision");
    } else {
        info!(
            decision = %decision.as_str(),
            capability = %capability,
            detail = %detail,
            "Permission decision logged"
        );
    }
}

// ── Rule CRUD ──

/// List all permission rules for a project, ordered by specificity.
pub fn list_rules(conn: &Connection, project_id: &str) -> Result<Vec<PermissionRule>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, project_id, capability, path_pattern, command_pattern, action, created_at
         FROM acp_permission_rules
         WHERE project_id = ?1
         ORDER BY
            CASE WHEN path_pattern IS NOT NULL OR command_pattern IS NOT NULL THEN 0 ELSE 1 END,
            created_at ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![project_id], |row| {
        let action_str: String = row.get(5)?;
        Ok(PermissionRule {
            id: row.get(0)?,
            project_id: row.get(1)?,
            capability: row.get(2)?,
            path_pattern: row.get(3)?,
            command_pattern: row.get(4)?,
            action: PermissionAction::from_str(&action_str).unwrap_or(PermissionAction::Ask),
            created_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

/// Create a new permission rule.
pub fn create_rule(
    conn: &Connection,
    project_id: &str,
    capability: &str,
    path_pattern: Option<&str>,
    command_pattern: Option<&str>,
    action: PermissionAction,
) -> Result<PermissionRule, rusqlite::Error> {
    let id = db::generate_id("rule");
    conn.execute(
        "INSERT INTO acp_permission_rules (id, project_id, capability, path_pattern, command_pattern, action)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, project_id, capability, path_pattern, command_pattern, action.as_str()],
    )?;

    // Return the created rule
    let mut stmt = conn.prepare_cached(
        "SELECT id, project_id, capability, path_pattern, command_pattern, action, created_at
         FROM acp_permission_rules WHERE id = ?1",
    )?;
    stmt.query_row(rusqlite::params![id], |row| {
        let action_str: String = row.get(5)?;
        Ok(PermissionRule {
            id: row.get(0)?,
            project_id: row.get(1)?,
            capability: row.get(2)?,
            path_pattern: row.get(3)?,
            command_pattern: row.get(4)?,
            action: PermissionAction::from_str(&action_str).unwrap_or(PermissionAction::Ask),
            created_at: row.get(6)?,
        })
    })
}

/// Delete a permission rule by ID.
pub fn delete_rule(conn: &Connection, rule_id: &str) -> Result<bool, rusqlite::Error> {
    let count = conn.execute(
        "DELETE FROM acp_permission_rules WHERE id = ?1",
        rusqlite::params![rule_id],
    )?;
    Ok(count > 0)
}

/// Delete all permission rules for a project (reset to defaults).
pub fn delete_all_rules(conn: &Connection, project_id: &str) -> Result<usize, rusqlite::Error> {
    let count = conn.execute(
        "DELETE FROM acp_permission_rules WHERE project_id = ?1",
        rusqlite::params![project_id],
    )?;
    Ok(count)
}

/// Get permission log entries for a project.
pub fn get_log(
    conn: &Connection,
    project_id: &str,
    limit: usize,
) -> Result<Vec<PermissionLogEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, session_id, project_id, capability, detail, decision, decided_at
         FROM acp_permission_log
         WHERE project_id = ?1
         ORDER BY decided_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![project_id, limit as i64], |row| {
        Ok(PermissionLogEntry {
            id: row.get(0)?,
            session_id: row.get(1)?,
            project_id: row.get(2)?,
            capability: row.get(3)?,
            detail: row.get(4)?,
            decision: row.get(5)?,
            decided_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

// ── Settings helpers ──

/// Get the project default permission policy from settings.
fn get_project_default_policy(conn: &Connection, project_id: &str) -> Option<PermissionAction> {
    db::settings::get_value(conn, "project", Some(project_id), "acp_default_policy")
        .ok()
        .flatten()
        .and_then(|s| PermissionAction::from_str(&s))
}

/// Get the trust mode permission policy for a project.
/// Values: "auto_approve" | "normal" | "deny_writes"
///
/// Trust mode governs permission behavior when sessions run autonomously
/// (e.g. continuous mode auto-launch queue).
fn get_trust_mode_policy(conn: &Connection, project_id: &str) -> Option<String> {
    db::settings::get_resolved(conn, project_id, "acp_trust_mode_policy").ok().flatten()
}

// ── Glob matching ──

/// Simple glob pattern matching supporting `*` and `**`.
///
/// - `*` matches any sequence of non-separator characters
/// - `**` matches any sequence of characters including separators
/// - All other characters match literally (case-sensitive)
fn matches_glob(pattern: &str, text: &str) -> bool {
    // Normalize separators for cross-platform matching
    let pattern = pattern.replace('\\', "/");
    let text = text.replace('\\', "/");
    glob_recursive(pattern.as_bytes(), text.as_bytes())
}

/// Recursive glob matcher with `*` and `**` support.
fn glob_recursive(pattern: &[u8], text: &[u8]) -> bool {
    if pattern.is_empty() {
        return text.is_empty();
    }

    // Check for ** at start of pattern segment
    if pattern.starts_with(b"**/") {
        // ** matches zero or more path segments
        // Try matching the rest of the pattern against the current text (zero segments)
        if glob_recursive(&pattern[3..], text) {
            return true;
        }
        // Try skipping characters in text (including separators)
        for i in 0..text.len() {
            if text[i] == b'/'
                && glob_recursive(&pattern[3..], &text[i + 1..])
            {
                return true;
            }
        }
        return false;
    }

    // ** at end of pattern matches everything
    if pattern == b"**" {
        return true;
    }

    // Single * matches non-separator characters
    if pattern[0] == b'*' {
        // Try matching zero or more non-/ chars
        // First try matching zero chars
        if glob_recursive(&pattern[1..], text) {
            return true;
        }
        // Then try consuming one non-/ char at a time
        for i in 0..text.len() {
            if text[i] == b'/' {
                break;
            }
            if glob_recursive(&pattern[1..], &text[i + 1..]) {
                return true;
            }
        }
        return false;
    }

    // Literal character match
    if !text.is_empty() && pattern[0] == text[0] {
        return glob_recursive(&pattern[1..], &text[1..]);
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const TEST_PROJECT_ID: &str = "proj_1";

    fn setup() -> Connection {
        let state = db::init_memory().unwrap();
        let conn = state.into_inner().unwrap();
        // Create a test project so foreign key constraints are satisfied
        db::projects::create(
            &conn,
            &db::models::NewProject {
                name: "test".into(),
                path: "/tmp/test".into(),
                default_agent: None,
                default_model: None,
                branch_naming_pattern: None,
                instruction_file_path: None,
            },
        ).unwrap();
        // The project gets an auto-generated ID, but our tests use "proj_1".
        // Insert directly with the expected ID.
        conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
            rusqlite::params![TEST_PROJECT_ID, "test-perm", "/tmp/test-perm"],
        ).unwrap();
        conn
    }

    // ── Glob matching tests ──

    #[test]
    fn glob_exact_match() {
        assert!(matches_glob("src/main.rs", "src/main.rs"));
        assert!(!matches_glob("src/main.rs", "src/lib.rs"));
    }

    #[test]
    fn glob_star_matches_within_segment() {
        assert!(matches_glob("src/*.rs", "src/main.rs"));
        assert!(matches_glob("src/*.rs", "src/lib.rs"));
        assert!(!matches_glob("src/*.rs", "src/foo/bar.rs"));
    }

    #[test]
    fn glob_double_star_matches_across_segments() {
        assert!(matches_glob("src/**/*.rs", "src/main.rs"));
        assert!(matches_glob("src/**/*.rs", "src/foo/bar.rs"));
        assert!(matches_glob("src/**/*.rs", "src/a/b/c.rs"));
        assert!(!matches_glob("src/**/*.rs", "test/main.rs"));
    }

    #[test]
    fn glob_double_star_at_start() {
        assert!(matches_glob("**/*.rs", "src/main.rs"));
        assert!(matches_glob("**/*.rs", "a/b/c/d.rs"));
    }

    #[test]
    fn glob_double_star_at_end() {
        assert!(matches_glob("src/**", "src/main.rs"));
        assert!(matches_glob("src/**", "src/foo/bar/baz.rs"));
    }

    // ── Policy engine tests ──

    #[test]
    fn default_policy_is_ask() {
        let conn = setup();
        let ctx = PermissionContext {
            project_id: "proj_1".into(),
            session_id: "sess_1".into(),
            capability: CapabilityType::FsRead,
            detail: "src/main.rs".into(),
            is_trust_mode: false,
        };
        assert_eq!(evaluate(&conn, &ctx), PermissionAction::Ask);
    }

    #[test]
    fn capability_only_rule_matches() {
        let conn = setup();
        create_rule(&conn, "proj_1", "fs_read", None, None, PermissionAction::AutoApprove).unwrap();

        let ctx = PermissionContext {
            project_id: "proj_1".into(),
            session_id: "sess_1".into(),
            capability: CapabilityType::FsRead,
            detail: "any/file.rs".into(),
            is_trust_mode: false,
        };
        assert_eq!(evaluate(&conn, &ctx), PermissionAction::AutoApprove);
    }

    #[test]
    fn path_pattern_rule_takes_priority() {
        let conn = setup();
        // Broad rule: auto-approve all fs_read
        create_rule(&conn, "proj_1", "fs_read", None, None, PermissionAction::AutoApprove).unwrap();
        // Specific rule: deny reads in secrets/
        create_rule(&conn, "proj_1", "fs_read", Some("secrets/**"), None, PermissionAction::Deny).unwrap();

        // Normal file → auto-approve
        let ctx = PermissionContext {
            project_id: "proj_1".into(),
            session_id: "sess_1".into(),
            capability: CapabilityType::FsRead,
            detail: "src/main.rs".into(),
            is_trust_mode: false,
        };
        assert_eq!(evaluate(&conn, &ctx), PermissionAction::AutoApprove);

        // Secrets file → deny (specific pattern beats capability-only)
        let ctx2 = PermissionContext {
            detail: "secrets/api_key.txt".into(),
            ..ctx
        };
        assert_eq!(evaluate(&conn, &ctx2), PermissionAction::Deny);
    }

    #[test]
    fn wildcard_capability_matches_all() {
        let conn = setup();
        create_rule(&conn, "proj_1", "*", None, None, PermissionAction::AutoApprove).unwrap();

        let ctx = PermissionContext {
            project_id: "proj_1".into(),
            session_id: "sess_1".into(),
            capability: CapabilityType::Terminal,
            detail: "npm test".into(),
            is_trust_mode: false,
        };
        assert_eq!(evaluate(&conn, &ctx), PermissionAction::AutoApprove);
    }

    #[test]
    fn trust_mode_auto_approve() {
        let conn = setup();
        db::settings::set_value(&conn, "project", Some("proj_1"), "acp_trust_mode_policy", "auto_approve").unwrap();

        let ctx = PermissionContext {
            project_id: "proj_1".into(),
            session_id: "sess_1".into(),
            capability: CapabilityType::FsWrite,
            detail: "src/main.rs".into(),
            is_trust_mode: true,
        };
        assert_eq!(evaluate(&conn, &ctx), PermissionAction::AutoApprove);
    }

    #[test]
    fn trust_mode_deny_writes() {
        let conn = setup();
        db::settings::set_value(&conn, "project", Some("proj_1"), "acp_trust_mode_policy", "deny_writes").unwrap();

        // Read is auto-approved
        let ctx_read = PermissionContext {
            project_id: "proj_1".into(),
            session_id: "sess_1".into(),
            capability: CapabilityType::FsRead,
            detail: "src/main.rs".into(),
            is_trust_mode: true,
        };
        assert_eq!(evaluate(&conn, &ctx_read), PermissionAction::AutoApprove);

        // Write is denied
        let ctx_write = PermissionContext {
            capability: CapabilityType::FsWrite,
            ..ctx_read.clone()
        };
        assert_eq!(evaluate(&conn, &ctx_write), PermissionAction::Deny);

        // Terminal is denied
        let ctx_term = PermissionContext {
            capability: CapabilityType::Terminal,
            detail: "rm -rf /".into(),
            ..ctx_read
        };
        assert_eq!(evaluate(&conn, &ctx_term), PermissionAction::Deny);
    }

    // ── CRUD tests ──

    #[test]
    fn create_and_list_rules() {
        let conn = setup();
        create_rule(&conn, "proj_1", "fs_read", Some("src/**"), None, PermissionAction::AutoApprove).unwrap();
        create_rule(&conn, "proj_1", "fs_write", None, None, PermissionAction::Ask).unwrap();

        let rules = list_rules(&conn, "proj_1").unwrap();
        assert_eq!(rules.len(), 2);
        // Rules with patterns come first
        assert!(rules[0].path_pattern.is_some());
        assert!(rules[1].path_pattern.is_none());
    }

    #[test]
    fn delete_rule_works() {
        let conn = setup();
        let rule = create_rule(&conn, "proj_1", "fs_read", None, None, PermissionAction::AutoApprove).unwrap();
        assert!(delete_rule(&conn, &rule.id).unwrap());
        assert!(!delete_rule(&conn, &rule.id).unwrap()); // Already deleted
        assert!(list_rules(&conn, "proj_1").unwrap().is_empty());
    }

    #[test]
    fn delete_all_rules_works() {
        let conn = setup();
        create_rule(&conn, "proj_1", "fs_read", None, None, PermissionAction::AutoApprove).unwrap();
        create_rule(&conn, "proj_1", "fs_write", None, None, PermissionAction::Ask).unwrap();
        let count = delete_all_rules(&conn, "proj_1").unwrap();
        assert_eq!(count, 2);
        assert!(list_rules(&conn, "proj_1").unwrap().is_empty());
    }

    #[test]
    fn log_decision_and_retrieve() {
        let conn = setup();
        log_decision(&conn, "sess_1", TEST_PROJECT_ID, "fs_read", "src/main.rs", &PermissionDecision::AutoApproved);
        log_decision(&conn, "sess_1", TEST_PROJECT_ID, "fs_write", "src/lib.rs", &PermissionDecision::Approved);

        let entries = get_log(&conn, TEST_PROJECT_ID, 10).unwrap();
        assert_eq!(entries.len(), 2);
        // Both entries should be present (order may vary for same-second inserts)
        let capabilities: Vec<&str> = entries.iter().map(|e| e.capability.as_str()).collect();
        assert!(capabilities.contains(&"fs_read"));
        assert!(capabilities.contains(&"fs_write"));
    }
}
