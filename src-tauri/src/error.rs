use serde::Serialize;
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Database(String),
    Git(String),
    Io(String),
    Validation(String),
    NotFound(String),
    Keyring(String),
}

impl AppError {
    /// Returns a user-friendly message suitable for display in the UI.
    /// Technical details are mapped to actionable, plain-language messages.
    /// The original `Display` impl is preserved for logging.
    pub fn user_message(&self) -> String {
        match self {
            Self::Database(msg) => map_database_error(msg),
            Self::Git(msg) => map_git_error(msg),
            Self::Io(msg) => map_io_error(msg),
            Self::Validation(msg) => format!("{msg}"),
            Self::NotFound(msg) => format!("{msg} not found"),
            Self::Keyring(msg) => map_keyring_error(msg),
        }
    }
}

/// Map raw database/SQLite error strings to user-friendly messages.
fn map_database_error(msg: &str) -> String {
    let lower = msg.to_lowercase();

    if lower.contains("database is locked") {
        return "Database is temporarily busy. Please try again in a moment.".into();
    }
    if lower.contains("poison") {
        return "Database connection encountered an internal error. Please restart the app.".into();
    }
    if lower.contains("disk i/o error") || lower.contains("disk full") {
        return "Database write failed — your disk may be full or write-protected.".into();
    }
    if lower.contains("corrupt") || lower.contains("malformed") {
        return "Database file appears corrupted. Try restarting the app or restoring from a backup.".into();
    }
    if lower.contains("readonly") || lower.contains("read-only") || lower.contains("attempt to write a readonly database") {
        return "Database is read-only. Check file permissions on the app data directory.".into();
    }

    format!("Database error: {msg}")
}

/// Map raw git2 and `gh` CLI error strings to user-friendly messages.
fn map_git_error(msg: &str) -> String {
    let lower = msg.to_lowercase();

    // Branch/ref conflicts
    if lower.contains("already exists") {
        return "A branch or worktree with this name already exists. Choose a different name or delete the existing one.".into();
    }
    if lower.contains("reference is not a tree") || lower.contains("not a valid object name") {
        return "The specified branch or commit could not be found. It may have been deleted or renamed.".into();
    }

    // Working tree state
    if lower.contains("uncommitted changes") || lower.contains("dirty") || lower.contains("overwritten by checkout") {
        return "Working tree has uncommitted changes. Commit or stash them first.".into();
    }
    if lower.contains("merge conflict") || lower.contains("unresolved conflict") {
        return "There are unresolved merge conflicts. Resolve them before continuing.".into();
    }
    if lower.contains("diverged") || lower.contains("cannot fast-forward") {
        return "Local branch has diverged from remote. Pull or rebase to reconcile changes.".into();
    }

    // Lock / concurrency
    if lower.contains("lock") && (lower.contains("index") || lower.contains(".lock")) {
        return "Git is busy — another operation may be in progress. Wait a moment or remove stale lock files.".into();
    }

    // Auth / remote
    if lower.contains("authentication") || lower.contains("could not read username") || lower.contains("401") || lower.contains("403") {
        return "Git authentication failed. Check your credentials or SSH key configuration.".into();
    }
    if lower.contains("could not resolve host") || lower.contains("connection refused") || lower.contains("timed out") {
        return "Could not connect to the remote repository. Check your network connection.".into();
    }

    // GitHub CLI errors — pass through as they're already descriptive
    if lower.starts_with("gh ") && lower.contains("failed:") {
        // e.g. "gh pr create failed: ..." — extract the tool's stderr which is usually helpful
        return format!("GitHub CLI error: {msg}");
    }

    // git2 class/code pattern: "failed to resolve path '...'; class=Reference (4); code=NotFound (-3)"
    if lower.contains("class=") && lower.contains("code=") {
        // Extract just the meaningful prefix before the class= noise
        if let Some(pos) = msg.find("; class=") {
            let clean = msg[..pos].trim();
            if !clean.is_empty() {
                return format!("Git error: {clean}");
            }
        }
    }

    format!("Git error: {msg}")
}

/// Map raw IO / process spawn / PTY error strings to user-friendly messages.
fn map_io_error(msg: &str) -> String {
    let lower = msg.to_lowercase();

    // PTY / agent spawn
    if lower.contains("failed to spawn") {
        return "Could not start the process. Make sure the agent CLI is installed and available on your PATH.".into();
    }
    if lower.contains("failed to open pty") {
        return "Could not open a terminal session. Try restarting the app.".into();
    }
    if lower.contains("lock poisoned") || lower.contains("writer lock poisoned") {
        return "Terminal session encountered an internal error. Try restarting the session.".into();
    }

    // File not found
    if lower.contains("os error 2") || (lower.contains("not found") && lower.contains("file")) || lower.contains("no such file") {
        return "File or directory not found. It may have been moved or deleted.".into();
    }

    // Permission denied
    if lower.contains("os error 5") || lower.contains("permission denied") || lower.contains("access is denied") {
        return "Permission denied. Check that the file or folder is not locked or read-only.".into();
    }

    // Network
    if lower.contains("connection refused") || lower.contains("os error 10061") {
        return "Connection refused. The service may not be running.".into();
    }
    if lower.contains("timed out") || lower.contains("os error 10060") {
        return "Connection timed out. Check your network connection.".into();
    }

    // gh CLI not found
    if lower.contains("failed to run gh") || lower.contains("failed to run `gh") {
        return "Could not run the GitHub CLI (`gh`). Is it installed and on your PATH?".into();
    }

    // Plugin operations
    if lower.contains("plugin install failed") {
        return format!("Plugin installation failed. {}", extract_after_colon(msg));
    }
    if lower.contains("plugin") && lower.contains("failed") {
        return format!("Plugin operation failed. {}", extract_after_colon(msg));
    }

    // Skills / npx
    if lower.contains("is npm/npx installed") || lower.contains("failed to run npx") {
        return "Could not run the skills tool. Make sure npm/npx is installed and on your PATH.".into();
    }

    // MCP server
    if lower.contains("failed to bind mcp server") {
        return "Could not start the MCP server. The port may already be in use.".into();
    }

    // Update errors
    if lower.contains("update failed") || lower.contains("update check failed") {
        return "App update failed. Check your network connection and try again.".into();
    }

    format!("IO error: {msg}")
}

/// Map keyring/credential errors to user-friendly messages.
fn map_keyring_error(msg: &str) -> String {
    let lower = msg.to_lowercase();

    if lower.contains("no entry") || lower.contains("not found") || lower.contains("no password") {
        return "No saved credential found. You may need to set up your API key.".into();
    }
    if lower.contains("access denied") || lower.contains("denied") || lower.contains("locked") {
        return "Could not access secure credential storage. Your system keychain may be locked.".into();
    }
    if lower.contains("platform") || lower.contains("no backend") || lower.contains("unsupported") {
        return "Secure credential storage is not available on this system. Check your system keychain settings.".into();
    }

    "Could not access secure credential storage. Check your system keychain settings.".into()
}

/// Helper: extract text after the last colon, or return the full message.
fn extract_after_colon(msg: &str) -> String {
    if let Some(pos) = msg.rfind(": ") {
        msg[pos + 2..].trim().to_string()
    } else {
        msg.to_string()
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Database(msg) => write!(f, "Database error: {msg}"),
            Self::Git(msg) => write!(f, "Git error: {msg}"),
            Self::Io(msg) => write!(f, "IO error: {msg}"),
            Self::Validation(msg) => write!(f, "Validation error: {msg}"),
            Self::NotFound(msg) => write!(f, "Not found: {msg}"),
            Self::Keyring(msg) => write!(f, "Keyring error: {msg}"),
        }
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.user_message())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Database(e.to_string())
    }
}

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        Self::Git(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        Self::Keyring(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_locked_gives_friendly_message() {
        let err = AppError::Database("database is locked".into());
        assert_eq!(
            err.user_message(),
            "Database is temporarily busy. Please try again in a moment."
        );
        // Display still has technical details for logging
        assert!(err.to_string().contains("Database error:"));
    }

    #[test]
    fn database_poison_gives_friendly_message() {
        let err = AppError::Database("PoisonError { .. }".into());
        assert_eq!(
            err.user_message(),
            "Database connection encountered an internal error. Please restart the app."
        );
    }

    #[test]
    fn git_already_exists_gives_friendly_message() {
        let err = AppError::Git("a]reference 'refs/heads/feat/my-branch' already exists".into());
        assert!(err.user_message().contains("already exists"));
        assert!(err.user_message().contains("Choose a different name"));
    }

    #[test]
    fn git_class_code_pattern_is_cleaned() {
        let err = AppError::Git(
            "failed to resolve path '/foo'; class=Reference (4); code=NotFound (-3)".into(),
        );
        assert_eq!(
            err.user_message(),
            "Git error: failed to resolve path '/foo'"
        );
        // No class= noise in user message
        assert!(!err.user_message().contains("class="));
    }

    #[test]
    fn pty_spawn_failure_gives_friendly_message() {
        let err = AppError::Io("Failed to spawn: No such file or directory (os error 2)".into());
        assert_eq!(
            err.user_message(),
            "Could not start the process. Make sure the agent CLI is installed and available on your PATH."
        );
    }

    #[test]
    fn io_permission_denied_gives_friendly_message() {
        let err = AppError::Io("Permission denied (os error 5)".into());
        assert_eq!(
            err.user_message(),
            "Permission denied. Check that the file or folder is not locked or read-only."
        );
    }

    #[test]
    fn keyring_no_entry_gives_friendly_message() {
        let err = AppError::Keyring("No entry found for service".into());
        assert_eq!(
            err.user_message(),
            "No saved credential found. You may need to set up your API key."
        );
    }

    #[test]
    fn validation_passes_through() {
        let err = AppError::Validation("Invalid issue ref: #abc".into());
        assert_eq!(err.user_message(), "Invalid issue ref: #abc");
    }

    #[test]
    fn not_found_appends_not_found() {
        let err = AppError::NotFound("Project proj_123".into());
        assert_eq!(err.user_message(), "Project proj_123 not found");
    }

    #[test]
    fn gh_cli_errors_pass_through() {
        let err = AppError::Git("gh pr create failed: no default remote found".into());
        assert!(err.user_message().starts_with("GitHub CLI error:"));
        assert!(err.user_message().contains("no default remote"));
    }

    #[test]
    fn serialization_uses_user_message() {
        let err = AppError::Database("database is locked".into());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("temporarily busy"));
        // Should NOT contain the raw technical message
        assert!(!json.contains("database is locked"));
    }

    #[test]
    fn display_preserves_technical_details() {
        let err = AppError::Database("database is locked".into());
        let display = err.to_string();
        assert_eq!(display, "Database error: database is locked");
    }

    #[test]
    fn unmapped_errors_fall_through_with_prefix() {
        let err = AppError::Io("Some unknown error happened".into());
        assert_eq!(err.user_message(), "IO error: Some unknown error happened");
    }

    #[test]
    fn git_auth_failure_gives_friendly_message() {
        let err = AppError::Git("authentication required but no callback set".into());
        assert_eq!(
            err.user_message(),
            "Git authentication failed. Check your credentials or SSH key configuration."
        );
    }

    #[test]
    fn mcp_server_bind_gives_friendly_message() {
        let err = AppError::Io("Failed to bind MCP server: address already in use".into());
        assert_eq!(
            err.user_message(),
            "Could not start the MCP server. The port may already be in use."
        );
    }
}
