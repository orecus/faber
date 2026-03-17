//! Filesystem and terminal capability implementations for ACP.
//!
//! When an ACP agent requests file reads/writes or terminal operations,
//! these functions execute the actual work on behalf of the agent.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tracing::{debug, error, warn};

/// A terminal process spawned on behalf of an ACP agent.
///
/// Agents can request the client to run shell commands via the `terminal`
/// capability. Each managed terminal tracks its subprocess and buffered output.
pub struct ManagedTerminal {
    pub child: Child,
    pub stdout_buf: Arc<Mutex<Vec<u8>>>,
    pub stderr_buf: Arc<Mutex<Vec<u8>>>,
    pub exit_status: Arc<Mutex<Option<i32>>>,
}

/// Thread-safe map of terminal IDs to managed terminals.
pub type ManagedTerminals = Arc<Mutex<HashMap<String, ManagedTerminal>>>;

/// Create a new empty managed terminals map.
pub fn new_managed_terminals() -> ManagedTerminals {
    Arc::new(Mutex::new(HashMap::new()))
}

// ── Filesystem Capabilities ──

/// Read a text file relative to the working directory.
///
/// Returns the file contents as a string, or an error if the file
/// doesn't exist or isn't valid UTF-8.
pub async fn read_text_file(cwd: &Path, path: &str) -> Result<String, String> {
    let resolved = resolve_path(cwd, path);

    // Security: ensure the resolved path is within the working directory
    if !is_within_directory(&resolved, cwd) {
        return Err(format!(
            "Path '{}' resolves outside the working directory",
            path
        ));
    }

    tokio::fs::read_to_string(&resolved)
        .await
        .map_err(|e| format!("Failed to read '{}': {}", path, e))
}

/// Write a text file relative to the working directory.
///
/// Creates parent directories if needed. Returns an error if the path
/// resolves outside the working directory.
pub async fn write_text_file(cwd: &Path, path: &str, content: &str) -> Result<(), String> {
    let resolved = resolve_path(cwd, path);

    // Security: ensure the resolved path is within the working directory
    if !is_within_directory(&resolved, cwd) {
        return Err(format!(
            "Path '{}' resolves outside the working directory",
            path
        ));
    }

    // Create parent directories if needed
    if let Some(parent) = resolved.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directories for '{}': {}", path, e))?;
    }

    tokio::fs::write(&resolved, content)
        .await
        .map_err(|e| format!("Failed to write '{}': {}", path, e))
}

// ── Terminal Capabilities ──

/// Create a new terminal process.
///
/// Spawns a shell subprocess with the given command, returning a unique
/// terminal ID for future operations.
pub async fn create_terminal(
    terminals: &ManagedTerminals,
    cwd: &Path,
    command: &str,
    args: &[String],
    env: &HashMap<String, String>,
) -> Result<String, String> {
    let terminal_id = format!("term_{}", hex::encode(rand::random::<[u8; 8]>()));

    let mut cmd = Command::new(command);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Apply custom environment variables
    for (k, v) in env {
        cmd.env(k, v);
    }

    // On Windows, prevent console window from flashing
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn terminal '{}': {}", command, e))?;

    let stdout_buf = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf = Arc::new(Mutex::new(Vec::new()));
    let exit_status: Arc<Mutex<Option<i32>>> = Arc::new(Mutex::new(None));

    // Spawn background tasks to read stdout/stderr into buffers
    if let Some(stdout) = child.stdout.take() {
        let buf = stdout_buf.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut reader = stdout;
            let mut tmp = [0u8; 4096];
            loop {
                match reader.read(&mut tmp).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let mut b = buf.lock().await;
                        b.extend_from_slice(&tmp[..n]);
                        // Cap buffer at 1MB to prevent memory issues
                        if b.len() > 1_048_576 {
                            let drain_to = b.len() - 1_048_576;
                            b.drain(..drain_to);
                        }
                    }
                    Err(e) => {
                        debug!("Terminal stdout read error: {}", e);
                        break;
                    }
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let buf = stderr_buf.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut reader = stderr;
            let mut tmp = [0u8; 4096];
            loop {
                match reader.read(&mut tmp).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let mut b = buf.lock().await;
                        b.extend_from_slice(&tmp[..n]);
                        if b.len() > 1_048_576 {
                            let drain_to = b.len() - 1_048_576;
                            b.drain(..drain_to);
                        }
                    }
                    Err(e) => {
                        debug!("Terminal stderr read error: {}", e);
                        break;
                    }
                }
            }
        });
    }

    // Log the tracked process (exit status captured when `wait_for_exit` or `kill` is called)
    debug!("Tracking terminal process {:?}", child.id());

    let managed = ManagedTerminal {
        child,
        stdout_buf,
        stderr_buf,
        exit_status,
    };

    terminals.lock().await.insert(terminal_id.clone(), managed);
    debug!(terminal_id = %terminal_id, command = %command, "Created managed terminal");

    Ok(terminal_id)
}

/// Read buffered output from a terminal.
///
/// Returns stdout and stderr accumulated since the last read, then clears
/// the buffers (non-blocking).
pub async fn terminal_output(
    terminals: &ManagedTerminals,
    terminal_id: &str,
) -> Result<(String, String), String> {
    let map = terminals.lock().await;
    let terminal = map
        .get(terminal_id)
        .ok_or_else(|| format!("Terminal '{}' not found", terminal_id))?;

    // Drain stdout buffer
    let stdout = {
        let mut buf = terminal.stdout_buf.lock().await;
        let data = String::from_utf8_lossy(&buf).to_string();
        buf.clear();
        data
    };

    // Drain stderr buffer
    let stderr = {
        let mut buf = terminal.stderr_buf.lock().await;
        let data = String::from_utf8_lossy(&buf).to_string();
        buf.clear();
        data
    };

    Ok((stdout, stderr))
}

/// Wait for a terminal process to exit.
///
/// Blocks until the process exits and returns the exit code.
pub async fn wait_for_terminal_exit(
    terminals: &ManagedTerminals,
    terminal_id: &str,
) -> Result<i32, String> {
    // Take the child out of the map temporarily to call wait()
    let mut child = {
        let mut map = terminals.lock().await;
        match map.remove(terminal_id) {
            Some(t) => t,
            None => return Err(format!("Terminal '{}' not found", terminal_id)),
        }
    };

    let status = child
        .child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for terminal '{}': {}", terminal_id, e))?;

    let code = status.code().unwrap_or(-1);
    *child.exit_status.lock().await = Some(code);

    // Put it back with the exit status recorded
    terminals.lock().await.insert(terminal_id.to_string(), child);

    Ok(code)
}

/// Kill a terminal process and its entire process tree.
///
/// Uses process tree killing to ensure any child processes spawned by
/// the terminal command are also terminated.
pub async fn kill_terminal(
    terminals: &ManagedTerminals,
    terminal_id: &str,
) -> Result<(), String> {
    let mut map = terminals.lock().await;
    if let Some(terminal) = map.get_mut(terminal_id) {
        // Kill the process tree first, then the direct child as fallback
        if let Some(pid) = terminal.child.id() {
            crate::pty::kill_process_tree(pid, terminal_id);
        }
        if let Err(e) = terminal.child.kill().await {
            if e.kind() != std::io::ErrorKind::InvalidInput {
                warn!(terminal_id = %terminal_id, error = %e, "Failed to kill terminal");
            }
        }
        Ok(())
    } else {
        Err(format!("Terminal '{}' not found", terminal_id))
    }
}

/// Release (cleanup) a terminal, removing it from the managed map.
///
/// Kills the process tree before removing to prevent orphaned descendants.
pub async fn release_terminal(
    terminals: &ManagedTerminals,
    terminal_id: &str,
) -> Result<(), String> {
    let mut map = terminals.lock().await;
    if let Some(mut terminal) = map.remove(terminal_id) {
        // Best-effort kill — process tree first, then direct child
        if let Some(pid) = terminal.child.id() {
            crate::pty::kill_process_tree(pid, terminal_id);
        }
        let _ = terminal.child.kill().await;
        debug!(terminal_id = %terminal_id, "Released managed terminal");
        Ok(())
    } else {
        // Already released — not an error
        Ok(())
    }
}

/// Clean up all managed terminals (called during ACP client shutdown).
///
/// Kills each terminal's entire process tree before killing the direct
/// child as a fallback, ensuring no grandchild processes linger.
pub async fn cleanup_all_terminals(terminals: &ManagedTerminals) {
    let mut map = terminals.lock().await;
    for (id, mut terminal) in map.drain() {
        // Kill the process tree first
        if let Some(pid) = terminal.child.id() {
            crate::pty::kill_process_tree(pid, &id);
        }
        // Fallback: kill the direct child
        if let Err(e) = terminal.child.kill().await {
            if e.kind() != std::io::ErrorKind::InvalidInput {
                error!(terminal_id = %id, error = %e, "Failed to kill terminal during cleanup");
            }
        }
    }
}

// ── Path Helpers ──

/// Resolve a potentially relative path against a working directory.
fn resolve_path(cwd: &Path, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        cwd.join(p)
    }
}

/// Check if a path is within a given directory (basic security check).
fn is_within_directory(path: &Path, dir: &Path) -> bool {
    // Canonicalize both paths to resolve symlinks and ..
    // If canonicalization fails (file doesn't exist yet), fall back to
    // checking the string prefix
    match (path.canonicalize(), dir.canonicalize()) {
        (Ok(resolved), Ok(base)) => resolved.starts_with(&base),
        _ => {
            // For files that don't exist yet, do a best-effort prefix check
            // after normalizing the path components
            let normalized = normalize_path(path);
            let base_normalized = normalize_path(dir);
            normalized.starts_with(&base_normalized)
        }
    }
}

/// Simple path normalization (removes `.` and resolves `..` where possible).
fn normalize_path(path: &Path) -> PathBuf {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {} // skip `.`
            std::path::Component::ParentDir => {
                components.pop(); // resolve `..`
            }
            other => components.push(other),
        }
    }
    components.iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_relative_path() {
        let cwd = Path::new("/project/src");
        let resolved = resolve_path(cwd, "main.rs");
        assert_eq!(resolved, PathBuf::from("/project/src/main.rs"));
    }

    #[test]
    fn resolve_absolute_path() {
        let cwd = Path::new("/project/src");
        let resolved = resolve_path(cwd, "/etc/hosts");
        assert_eq!(resolved, PathBuf::from("/etc/hosts"));
    }

    #[test]
    fn normalize_removes_dots() {
        let path = Path::new("/a/b/./c/../d");
        let normalized = normalize_path(path);
        assert_eq!(normalized, PathBuf::from("/a/b/d"));
    }

    #[test]
    fn is_within_directory_relative() {
        let dir = std::env::temp_dir();
        let file = dir.join("test.txt");
        assert!(is_within_directory(&file, &dir));
    }

    #[tokio::test]
    async fn read_nonexistent_file_errors() {
        let cwd = std::env::temp_dir();
        let result = read_text_file(&cwd, "definitely_nonexistent_file_xyz.txt").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn write_and_read_file() {
        let dir = std::env::temp_dir().join("faber_acp_test");
        let _ = tokio::fs::create_dir_all(&dir).await;

        let test_file = "acp_cap_test.txt";
        let content = "Hello from ACP capability test";

        write_text_file(&dir, test_file, content).await.unwrap();
        let read_back = read_text_file(&dir, test_file).await.unwrap();
        assert_eq!(read_back, content);

        // Cleanup
        let _ = tokio::fs::remove_file(dir.join(test_file)).await;
        let _ = tokio::fs::remove_dir(&dir).await;
    }

    #[test]
    fn managed_terminals_starts_empty() {
        let terminals = new_managed_terminals();
        let map = terminals.try_lock().unwrap();
        assert!(map.is_empty());
    }
}
