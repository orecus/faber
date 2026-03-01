use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{self, DbState};
use crate::db::models::SessionStatus;
use crate::error::AppError;
use crate::session::SessionStatusChanged;

// ── Types ──

pub(crate) struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub type PtyState = Mutex<HashMap<String, PtySession>>;

pub fn new_state() -> PtyState {
    Mutex::new(HashMap::new())
}

#[derive(Clone, Serialize)]
struct PtyOutputPayload {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExitPayload {
    session_id: String,
    success: bool,
}

// ── Operations ──

/// Spawn a new PTY process and begin streaming its output via Tauri events.
///
/// When `wrap_in_login_shell` is true (Unix only), the command is executed via
/// the user's login shell (`$SHELL -l -c "<command> <args>"`), which sources
/// login profiles for PATH and locale. This is needed for agent sessions
/// launched from a GUI app that lacks shell environment.
#[allow(clippy::too_many_arguments)]
pub fn spawn(
    state: &PtyState,
    app: &AppHandle,
    session_id: String,
    command: &str,
    args: &[String],
    cwd: Option<&str>,
    env: Option<&HashMap<String, String>>,
    cols: u16,
    rows: u16,
    wrap_in_login_shell: bool,
) -> Result<(), AppError> {
    {
        let sessions = state.lock().map_err(|e| AppError::Io(e.to_string()))?;
        if sessions.contains_key(&session_id) {
            return Err(AppError::Validation(format!(
                "PTY session already exists: {session_id}"
            )));
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Io(format!("Failed to open PTY: {e}")))?;

    // Build the command, handling three cases:
    // 1. Windows + needs wrapper: cmd.exe /c <command> <args>
    // 2. Unix + wrap_in_login_shell: $SHELL -l -c '<escaped command string>'
    // 3. Otherwise: direct command with args
    #[cfg(unix)]
    let mut cmd = if wrap_in_login_shell {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let wrapped = build_shell_wrapped_command(command, args);
        let mut c = CommandBuilder::new(&shell);
        c.arg("-l");
        c.arg("-c");
        c.arg(&wrapped);
        c
    } else {
        let mut c = CommandBuilder::new(command);
        for arg in args {
            c.arg(arg);
        }
        c
    };

    #[cfg(not(unix))]
    let mut cmd = {
        let _ = wrap_in_login_shell; // suppress unused warning on Windows
        if needs_cmd_wrapper(command) {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/c");
            c.arg(command);
            for arg in args {
                c.arg(arg);
            }
            c
        } else {
            let mut c = CommandBuilder::new(command);
            for arg in args {
                c.arg(arg);
            }
            c
        }
    };
    if let Some(dir) = cwd {
        // On Windows, canonicalized paths may have a \\?\ prefix that cmd.exe
        // doesn't understand — strip it.
        let clean_dir = crate::git::strip_unc_prefix(dir);
        cmd.cwd(&*clean_dir);
    }
    // Ensure TERM is set so commands like `clear` work in the PTY
    cmd.env("TERM", "xterm-256color");

    // On macOS, GUI apps launched from Finder/Dock may be missing locale
    // environment variables. Without LANG, CLI tools can mishandle UTF-8
    // output, causing cursor positioning issues and visual artifacts.
    #[cfg(target_os = "macos")]
    {
        if std::env::var("LANG").is_err() {
            cmd.env("LANG", "en_US.UTF-8");
        }
    }

    if let Some(vars) = env {
        for (k, v) in vars {
            cmd.env(k, v);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::Io(format!("Failed to spawn: {e}")))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Io(format!("Failed to clone reader: {e}")))?;
    let writer = Arc::new(Mutex::new(
        pair.master
            .take_writer()
            .map_err(|e| AppError::Io(format!("Failed to take writer: {e}")))?,
    ));

    // Clone writer handle for DSR responses on Windows
    let writer_for_reader = Arc::clone(&writer);

    {
        let mut sessions = state.lock().map_err(|e| AppError::Io(e.to_string()))?;
        sessions.insert(
            session_id.clone(),
            PtySession {
                master: pair.master,
                writer,
                child,
            },
        );
    }

    // Reader thread: streams PTY output as Tauri events
    let sid = session_id.clone();
    let app_clone = app.clone();
    std::thread::Builder::new()
        .name(format!("pty-reader-{sid}"))
        .spawn(move || {
            output_reader(reader, sid, app_clone, writer_for_reader);
        })
        .map_err(|e| AppError::Io(format!("Failed to spawn reader thread: {e}")))?;

    Ok(())
}

/// Background reader that streams PTY output to the frontend via events.
///
/// Handles multi-byte UTF-8 characters that may be split across read boundaries
/// by carrying over incomplete trailing bytes to the next iteration.
fn output_reader(
    mut reader: Box<dyn Read + Send>,
    session_id: String,
    app: AppHandle,
    _writer: Arc<Mutex<Box<dyn Write + Send>>>,
) {
    let mut buf = [0u8; 4096];
    let mut leftover: Vec<u8> = Vec::with_capacity(4);
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let chunk = &buf[..n];

                // On Windows, ConPTY sends DSR (Device Status Report) requests
                // (ESC[6n) to query cursor position. If unanswered, the terminal
                // can appear stuck with no visible output.
                #[cfg(windows)]
                handle_dsr(chunk, &_writer);

                // Combine leftover bytes from previous read with current chunk
                let combined: Vec<u8>;
                let bytes: &[u8] = if leftover.is_empty() {
                    chunk
                } else {
                    combined = [leftover.as_slice(), chunk].concat();
                    leftover.clear();
                    &combined
                };

                let (valid, trailing) = split_at_utf8_boundary(bytes);

                let data = if valid.is_empty() && !trailing.is_empty() {
                    // Mid-stream invalid bytes — fall back to lossy conversion
                    String::from_utf8_lossy(bytes).into_owned()
                } else {
                    // Save incomplete trailing bytes for next iteration
                    if !trailing.is_empty() {
                        leftover.extend_from_slice(trailing);
                    }
                    // SAFETY: split_at_utf8_boundary guarantees valid is valid UTF-8
                    if valid.is_empty() {
                        continue;
                    }
                    unsafe { std::str::from_utf8_unchecked(valid) }.to_string()
                };

                let _ = app.emit(
                    "pty-output",
                    PtyOutputPayload {
                        session_id: session_id.clone(),
                        data,
                    },
                );
            }
            Err(e) => {
                // EAGAIN/EINTR are retriable on Unix; anything else is fatal
                #[cfg(unix)]
                {
                    let raw = e.raw_os_error().unwrap_or(0);
                    if raw == libc::EAGAIN || raw == libc::EINTR {
                        continue;
                    }
                }
                let _ = e; // suppress unused warning on Windows
                break;
            }
        }
    }

    // Flush any remaining leftover bytes (stream ended, can't wait for more)
    if !leftover.is_empty() {
        let data = String::from_utf8_lossy(&leftover).into_owned();
        let _ = app.emit(
            "pty-output",
            PtyOutputPayload {
                session_id: session_id.clone(),
                data,
            },
        );
    }
    // Check for continuous mode crash (PTY exit without report_complete)
    crate::continuous::handle_pty_exit(&app, &session_id);

    // Update DB status to "finished" for natural PTY exit.
    // Guard: only update if session is still in an active state to avoid
    // overwriting a status already set by stop_session or continuous mode.
    if let Some(db_state) = app.try_state::<DbState>() {
        if let Ok(conn) = db_state.inner().lock() {
            if let Ok(Some(session)) = db::sessions::get(&conn, &session_id) {
                if matches!(
                    session.status,
                    SessionStatus::Starting | SessionStatus::Running | SessionStatus::Paused
                ) {
                    let new_status = SessionStatus::Finished;
                    let _ = db::sessions::update_status(&conn, &session_id, new_status);

                    // Emit session-status-changed so the frontend updates immediately
                    let _ = app.emit(
                        "session-status-changed",
                        SessionStatusChanged {
                            session_id: session_id.clone(),
                            old_status: session.status,
                            new_status,
                        },
                    );

                    tracing::info!(
                        session_id = session_id.as_str(),
                        old_status = session.status.as_str(),
                        "Natural PTY exit: updated session status to finished"
                    );
                }
            }
        }
    }

    tracing::info!(session_id = session_id.as_str(), "PTY process exited, emitting pty-exit");

    let _ = app.emit(
        "pty-exit",
        PtyExitPayload {
            session_id,
            success: true,
        },
    );
}

/// Write data (user input) to a PTY session.
pub fn write(state: &PtyState, session_id: &str, data: &str) -> Result<(), AppError> {
    // Clone the writer Arc out of the HashMap so we release the outer PtyState lock
    // before performing I/O. This prevents writes to one session from blocking
    // all other PTY operations across sessions.
    let writer = {
        let sessions = state.lock().map_err(|e| AppError::Io(e.to_string()))?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::NotFound(format!("PTY session {session_id}")))?;
        Arc::clone(&session.writer)
    };
    let mut writer = writer
        .lock()
        .map_err(|e| AppError::Io(format!("Writer lock poisoned: {e}")))?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| AppError::Io(format!("Write failed: {e}")))?;
    writer
        .flush()
        .map_err(|e| AppError::Io(format!("Flush failed: {e}")))?;
    Ok(())
}

/// Resize a PTY session.
pub fn resize(state: &PtyState, session_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
    let sessions = state.lock().map_err(|e| AppError::Io(e.to_string()))?;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| AppError::NotFound(format!("PTY session {session_id}")))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Io(format!("Resize failed: {e}")))?;
    Ok(())
}

/// Kill a PTY session and clean it up.
pub fn kill(state: &PtyState, session_id: &str) -> Result<(), AppError> {
    let mut sessions = state.lock().map_err(|e| AppError::Io(e.to_string()))?;
    if let Some(mut session) = sessions.remove(session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

/// List active PTY session IDs.
pub fn list_sessions(state: &PtyState) -> Result<Vec<String>, AppError> {
    let sessions = state.lock().map_err(|e| AppError::Io(e.to_string()))?;
    Ok(sessions.keys().cloned().collect())
}

// ── UTF-8 boundary helpers ──

/// Split a byte slice at the last valid UTF-8 boundary.
///
/// Returns `(valid_prefix, trailing_bytes)` where `valid_prefix` is guaranteed
/// to be valid UTF-8 and `trailing_bytes` contains an incomplete multi-byte
/// sequence at the end (0–3 bytes).
///
/// If a genuinely invalid byte is encountered mid-stream (not just an incomplete
/// trailing sequence), returns `(&[], &[])` to signal the caller should fall
/// back to lossy conversion.
fn split_at_utf8_boundary(bytes: &[u8]) -> (&[u8], &[u8]) {
    match std::str::from_utf8(bytes) {
        Ok(_) => (bytes, &[]),
        Err(e) => {
            let valid_up_to = e.valid_up_to();
            if e.error_len().is_none() {
                // Incomplete sequence at the end — split there
                (&bytes[..valid_up_to], &bytes[valid_up_to..])
            } else {
                // Genuinely invalid byte mid-stream — signal fallback
                (&[], &[])
            }
        }
    }
}

// ── Login shell wrapping (Unix) ──

/// POSIX single-quote escape: wraps in `'...'`, escapes inner `'` as `'\''`.
#[cfg(unix)]
fn shell_escape_arg(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    let mut result = String::with_capacity(s.len() + 2);
    result.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            result.push_str("'\\''");
        } else {
            result.push(ch);
        }
    }
    result.push('\'');
    result
}

/// Build a single shell command string from a command and its arguments,
/// with each part properly escaped for POSIX shell.
#[cfg(unix)]
fn build_shell_wrapped_command(command: &str, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(1 + args.len());
    parts.push(shell_escape_arg(command));
    for arg in args {
        parts.push(shell_escape_arg(arg));
    }
    parts.join(" ")
}

// ── Helpers ──

/// On Windows, detect DSR (Device Status Report) escape sequence ESC[6n in the
/// PTY output and respond with a cursor position report (ESC[1;1R).
/// Without this, Windows ConPTY can stall waiting for a response.
#[cfg(windows)]
fn handle_dsr(bytes: &[u8], writer: &Arc<Mutex<Box<dyn Write + Send>>>) {
    // DSR sequence: ESC [ 6 n  →  0x1b 0x5b 0x36 0x6e
    if bytes.len() < 4 {
        return;
    }
    for i in 0..bytes.len().saturating_sub(3) {
        if bytes[i] == 0x1b && bytes[i + 1] == 0x5b && bytes[i + 2] == 0x36 && bytes[i + 3] == 0x6e
        {
            if let Ok(mut w) = writer.lock() {
                let _ = w.write_all(b"\x1b[1;1R");
                let _ = w.flush();
            }
            break;
        }
    }
}

/// Check if a command needs to be wrapped with `cmd.exe /c` on Windows.
///
/// - Shell executables (cmd.exe, powershell, pwsh, bash, wsl) are NOT wrapped
///   since they're interactive and `cmd.exe /c` would exit after the inner
///   command ends.
/// - Real `.exe` binaries in PATH are NOT wrapped — they can be spawned
///   directly by the Windows process creation API, and `cmd.exe /c` can mangle
///   argument quoting (especially for long multi-word arguments).
/// - `.cmd` / `.bat` scripts (e.g. npm shims) DO need `cmd.exe /c` because
///   `CreateProcessW` cannot execute them directly.
#[cfg(windows)]
fn needs_cmd_wrapper(command: &str) -> bool {
    let lower = command.to_lowercase();
    let basename = lower.rsplit(['/', '\\']).next().unwrap_or(&lower);

    // Known shell executables — never wrap
    if matches!(
        basename,
        "cmd" | "cmd.exe" | "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
            | "bash" | "bash.exe" | "wsl" | "wsl.exe"
    ) {
        return false;
    }

    // If the command already has a .exe extension, no wrapper needed
    if basename.ends_with(".exe") {
        return false;
    }

    // Resolve via `where.exe` to check if the first match is a real .exe.
    // If it is, cmd.exe wrapping is unnecessary and can cause quoting issues.
    if let Ok(output) = crate::cmd_no_window("where.exe")
        .arg(command)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    {
        if let Some(first_line) = String::from_utf8_lossy(&output.stdout).lines().next() {
            let path_lower = first_line.to_lowercase();
            if path_lower.ends_with(".exe") {
                return false;
            }
        }
    }

    // Default: wrap (handles .cmd, .bat, and unknown cases)
    true
}


// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_state_is_empty() {
        let state = new_state();
        let sessions = state.lock().unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn write_unknown_session_returns_error() {
        let state = new_state();
        let result = write(&state, "nonexistent", "hello");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("PTY session"));
    }

    #[test]
    fn resize_unknown_session_returns_error() {
        let state = new_state();
        let result = resize(&state, "nonexistent", 80, 24);
        assert!(result.is_err());
    }

    #[test]
    fn kill_unknown_session_is_noop() {
        let state = new_state();
        // Should not error — just a no-op
        assert!(kill(&state, "nonexistent").is_ok());
    }

    #[test]
    fn list_sessions_empty() {
        let state = new_state();
        let ids = list_sessions(&state).unwrap();
        assert!(ids.is_empty());
    }

    #[test]
    fn strip_unc_prefix_works() {
        use crate::git::strip_unc_prefix;
        assert_eq!(strip_unc_prefix(r"\\?\C:\Users\foo"), if cfg!(windows) { "C:\\Users\\foo" } else { r"\\?\C:\Users\foo" });
        assert_eq!(strip_unc_prefix(r"C:\Users\foo"), r"C:\Users\foo");
        assert_eq!(strip_unc_prefix("/home/user"), "/home/user");
    }

    #[cfg(windows)]
    #[test]
    fn needs_cmd_wrapper_shells() {
        assert!(!needs_cmd_wrapper("cmd.exe"));
        assert!(!needs_cmd_wrapper("CMD"));
        assert!(!needs_cmd_wrapper("powershell.exe"));
        assert!(!needs_cmd_wrapper("pwsh"));
        assert!(!needs_cmd_wrapper("bash"));
        assert!(!needs_cmd_wrapper("wsl.exe"));
        // .exe binaries found via PATH resolution should not be wrapped
        assert!(!needs_cmd_wrapper("claude.exe"));
    }

    // ── UTF-8 boundary tests ──

    #[test]
    fn utf8_boundary_all_ascii() {
        let bytes = b"hello world";
        let (valid, trailing) = split_at_utf8_boundary(bytes);
        assert_eq!(valid, b"hello world");
        assert!(trailing.is_empty());
    }

    #[test]
    fn utf8_boundary_complete_emoji() {
        // 🎉 = F0 9F 8E 89 (4 bytes)
        let bytes = "hello 🎉".as_bytes();
        let (valid, trailing) = split_at_utf8_boundary(bytes);
        assert_eq!(valid, bytes);
        assert!(trailing.is_empty());
    }

    #[test]
    fn utf8_boundary_split_2byte_char() {
        // é = C3 A9 (2 bytes) — split after first byte
        let full = "café".as_bytes();
        let split_point = full.len() - 1; // cut off last byte of é
        let partial = &full[..split_point];
        let (valid, trailing) = split_at_utf8_boundary(partial);
        assert_eq!(std::str::from_utf8(valid).unwrap(), "caf");
        assert_eq!(trailing.len(), 1); // incomplete é
    }

    #[test]
    fn utf8_boundary_split_3byte_char() {
        // ★ = E2 98 85 (3 bytes)
        let full = "a★".as_bytes();
        // Keep 'a' + first 2 bytes of ★
        let partial = &full[..3]; // 'a' (1 byte) + E2 98
        let (valid, trailing) = split_at_utf8_boundary(partial);
        assert_eq!(std::str::from_utf8(valid).unwrap(), "a");
        assert_eq!(trailing.len(), 2);
    }

    #[test]
    fn utf8_boundary_split_4byte_char() {
        // 🎉 = F0 9F 8E 89 (4 bytes)
        let full = "x🎉".as_bytes();
        // Keep 'x' + first 3 bytes of 🎉
        let partial = &full[..4]; // 'x' (1 byte) + F0 9F 8E
        let (valid, trailing) = split_at_utf8_boundary(partial);
        assert_eq!(std::str::from_utf8(valid).unwrap(), "x");
        assert_eq!(trailing.len(), 3);
    }

    #[test]
    fn utf8_boundary_empty_input() {
        let (valid, trailing) = split_at_utf8_boundary(b"");
        assert!(valid.is_empty());
        assert!(trailing.is_empty());
    }

    #[test]
    fn utf8_boundary_invalid_byte_midstream() {
        // 0xFF is never valid in UTF-8
        let bytes = &[b'h', b'e', 0xFF, b'l', b'o'];
        let (valid, trailing) = split_at_utf8_boundary(bytes);
        // Should signal fallback (both empty)
        assert!(valid.is_empty());
        assert!(trailing.is_empty());
    }

    // ── Shell escaping tests (Unix only) ──

    #[cfg(unix)]
    #[test]
    fn shell_escape_simple() {
        assert_eq!(shell_escape_arg("hello"), "'hello'");
    }

    #[cfg(unix)]
    #[test]
    fn shell_escape_with_spaces() {
        assert_eq!(shell_escape_arg("hello world"), "'hello world'");
    }

    #[cfg(unix)]
    #[test]
    fn shell_escape_with_single_quotes() {
        assert_eq!(shell_escape_arg("it's"), "'it'\\''s'");
    }

    #[cfg(unix)]
    #[test]
    fn shell_escape_empty() {
        assert_eq!(shell_escape_arg(""), "''");
    }

    #[cfg(unix)]
    #[test]
    fn shell_escape_special_chars() {
        assert_eq!(shell_escape_arg("$HOME"), "'$HOME'");
        assert_eq!(shell_escape_arg("a;b"), "'a;b'");
        assert_eq!(shell_escape_arg("a&b"), "'a&b'");
    }

    #[cfg(unix)]
    #[test]
    fn build_shell_wrapped_command_format() {
        let cmd = build_shell_wrapped_command("claude", &["--model".into(), "opus".into()]);
        assert_eq!(cmd, "'claude' '--model' 'opus'");
    }

    #[cfg(unix)]
    #[test]
    fn build_shell_wrapped_command_no_args() {
        let cmd = build_shell_wrapped_command("claude", &[]);
        assert_eq!(cmd, "'claude'");
    }
}
