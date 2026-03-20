//! ACP client wrapper with lifecycle management.
//!
//! `AcpClient` wraps the `agent-client-protocol` crate's `ClientSideConnection`
//! with higher-level lifecycle management: subprocess spawning, initialization
//! handshake, session creation, prompting, and clean shutdown.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use agent_client_protocol as acp;
use tauri::AppHandle;
use tokio::process::Child;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use super::capabilities::{self, ManagedTerminals};
use super::handler::{FaberAcpHandler, PendingPermissions};

/// High-level ACP client managing an agent subprocess and connection.
///
/// Owns the agent child process, the ACP connection, and the background
/// I/O task that drives the connection. Provides methods matching the
/// ACP protocol lifecycle: initialize → new_session → prompt → shutdown.
pub struct AcpClient {
    /// The ACP connection (implements the `Agent` trait for sending requests).
    connection: acp::ClientSideConnection,
    /// Background task driving the connection I/O.
    io_task: Option<JoinHandle<()>>,
    /// The agent subprocess.
    child: Child,
    /// The handler's managed terminals (for cleanup on shutdown).
    terminals: ManagedTerminals,
    /// Agent capabilities reported during initialization.
    pub agent_capabilities: Option<acp::AgentCapabilities>,
    /// Agent info reported during initialization.
    pub agent_info: Option<acp::Implementation>,
}

/// Configuration for spawning an ACP client.
pub struct AcpSpawnConfig {
    /// The agent command to execute (e.g., "gemini", "copilot").
    pub command: String,
    /// Command-line arguments (e.g., ["--acp"]).
    pub args: Vec<String>,
    /// Working directory for the agent process.
    pub cwd: PathBuf,
    /// Additional environment variables.
    pub env: HashMap<String, String>,
    /// Faber session ID (for event routing).
    pub session_id: String,
    /// Project ID (for permission rule lookups).
    pub project_id: String,
    /// Whether this session is running in trust mode (autonomous permission handling).
    pub is_trust_mode: bool,
    /// Shared pending permissions map for resolving user responses.
    pub pending_permissions: PendingPermissions,
}

impl AcpClient {
    /// Spawn an agent subprocess and establish an ACP connection.
    ///
    /// This creates the child process with piped stdin/stdout, wraps them
    /// in a `ClientSideConnection`, and spawns the I/O driver task.
    ///
    /// **Important:** This must be called within a `tokio::task::LocalSet`
    /// because `ClientSideConnection` uses `!Send` futures internally.
    pub fn spawn(
        config: AcpSpawnConfig,
        app_handle: AppHandle,
    ) -> Result<Self, String> {
        use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

        // On Windows, CLI tools installed via npm/pip are .cmd/.bat batch files.
        // `Command::new("gemini")` can't execute .cmd files directly. Instead of
        // wrapping with `cmd.exe /C` (which adds ~15s overhead due to shell startup),
        // we resolve the actual binary path via `where.exe` and spawn it directly.
        let resolved_command = resolve_command_path(&config.command);

        let mut cmd = {
            let mut c = tokio::process::Command::new(&resolved_command);
            c.args(&config.args);
            c
        };

        cmd.current_dir(&config.cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        // Apply custom environment variables
        for (k, v) in &config.env {
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
            .map_err(|e| format!("Failed to spawn ACP agent '{}': {}", config.command, e))?;

        info!(
            command = %config.command,
            resolved = %resolved_command,
            args = ?config.args,
            cwd = %config.cwd.display(),
            session_id = %config.session_id,
            pid = ?child.id(),
            "Spawned ACP agent subprocess"
        );

        // Take stdin/stdout and convert via tokio_util::compat for futures::io traits
        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to capture agent stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture agent stdout")?;

        let outgoing = stdin.compat_write();
        let incoming = stdout.compat();

        // Create the handler for this session
        let handler = FaberAcpHandler::new(
            app_handle,
            config.session_id.clone(),
            config.project_id.clone(),
            config.cwd.clone(),
            config.is_trust_mode,
            config.pending_permissions,
        );
        let terminals = handler.terminals.clone();

        // Create the ACP connection
        let (connection, io_future) = acp::ClientSideConnection::new(
            handler,
            outgoing,
            incoming,
            |fut| {
                tokio::task::spawn_local(fut);
            },
        );

        // Spawn the I/O driver as a local task
        let session_id = config.session_id.clone();
        let io_task = tokio::task::spawn_local(async move {
            if let Err(e) = io_future.await {
                warn!(
                    session_id = %session_id,
                    error = %e,
                    "ACP connection I/O ended with error"
                );
            } else {
                debug!(session_id = %session_id, "ACP connection I/O completed cleanly");
            }
        });

        Ok(Self {
            connection,
            io_task: Some(io_task),
            child,
            terminals,
            agent_capabilities: None,
            agent_info: None,
        })
    }

    /// Perform the ACP initialization handshake.
    ///
    /// Sends an `initialize` request to the agent, negotiating protocol
    /// version and capabilities. If the agent advertises authentication
    /// methods, performs the `authenticate` handshake as well.
    /// Must be called before `new_session`.
    pub async fn initialize(&mut self) -> Result<acp::InitializeResponse, String> {
        use acp::Agent; // Import the Agent trait for .initialize() method

        let request = acp::InitializeRequest::new(acp::ProtocolVersion::LATEST)
            .client_info(
                acp::Implementation::new("faber", env!("CARGO_PKG_VERSION"))
                    .title("Faber IDE".to_string()),
            )
            .client_capabilities(
                acp::ClientCapabilities::new()
                    .fs(
                        acp::FileSystemCapabilities::new()
                            .read_text_file(true)
                            .write_text_file(true),
                    )
                    .terminal(true),
            );

        info!("ACP → initialize (sending handshake)");

        let response = self
            .connection
            .initialize(request)
            .await
            .map_err(|e| format!("ACP initialize failed: {}", e))?;

        info!(
            protocol_version = ?response.protocol_version,
            agent_info = ?response.agent_info,
            agent_capabilities = ?response.agent_capabilities,
            auth_methods = response.auth_methods.len(),
            "ACP ← initialize response"
        );

        self.agent_capabilities = Some(response.agent_capabilities.clone());
        self.agent_info = response.agent_info.clone();

        // If the agent advertises authentication methods, perform the
        // authenticate handshake. Currently only AuthMethod::Agent exists
        // (agent handles auth itself), so we just select the first method.
        if let Some(method) = response.auth_methods.first() {
            let method_id = method.id().clone();
            info!(
                method_id = %method_id,
                method_name = %method.name(),
                "ACP → authenticate (agent requires authentication)"
            );

            let auth_request = acp::AuthenticateRequest::new(method_id);
            let auth_response = self
                .connection
                .authenticate(auth_request)
                .await
                .map_err(|e| format!("ACP authenticate failed: {}", e))?;

            info!(
                "ACP ← authenticate response: {:?}",
                auth_response
            );
        }

        Ok(response)
    }

    /// Create a new ACP session.
    ///
    /// Sends a `session/new` request with the working directory and any
    /// MCP servers to pass through to the agent.
    pub async fn new_session(
        &self,
        cwd: &Path,
        mcp_servers: Vec<acp::McpServer>,
    ) -> Result<acp::NewSessionResponse, String> {
        use acp::Agent;

        let mcp_count = mcp_servers.len();
        let mut request = acp::NewSessionRequest::new(cwd.to_path_buf());
        if !mcp_servers.is_empty() {
            request = request.mcp_servers(mcp_servers);
        }

        info!(
            cwd = %cwd.display(),
            mcp_servers = mcp_count,
            "ACP → session/new"
        );

        let response = self
            .connection
            .new_session(request)
            .await
            .map_err(|e| format!("ACP session/new failed: {}", e))?;

        info!(
            acp_session_id = %response.session_id,
            "ACP ← session/new response"
        );

        Ok(response)
    }

    /// Send a prompt to the agent.
    ///
    /// Blocks until the agent responds with a `stop_reason`. During
    /// execution, the agent will send `session/update` notifications
    /// which are routed by the `FaberAcpHandler`.
    pub async fn prompt(
        &self,
        session_id: acp::SessionId,
        content: Vec<acp::ContentBlock>,
    ) -> Result<acp::PromptResponse, String> {
        use acp::Agent;

        let content_summary: Vec<String> = content.iter().map(|c| match c {
            acp::ContentBlock::Text(t) => {
                let preview = if t.text.len() > 100 { format!("{}…", &t.text[..100]) } else { t.text.clone() };
                format!("Text({}ch): {}", t.text.len(), preview.replace('\n', "\\n"))
            }
            other => format!("{:?}", std::mem::discriminant(other)),
        }).collect();

        info!(
            acp_session = %session_id,
            content_blocks = content_summary.len(),
            content = ?content_summary,
            "ACP → prompt"
        );

        let request = acp::PromptRequest::new(session_id, content);

        let response = self
            .connection
            .prompt(request)
            .await
            .map_err(|e| format!("ACP prompt failed: {}", e))?;

        info!(
            stop_reason = ?response.stop_reason,
            "ACP ← prompt response"
        );

        Ok(response)
    }

    /// Set the session mode (e.g., "code", "architect", "ask").
    pub async fn set_mode(
        &self,
        session_id: acp::SessionId,
        mode_id: String,
    ) -> Result<acp::SetSessionModeResponse, String> {
        use acp::Agent;

        info!(acp_session = %session_id, mode = %mode_id, "ACP → session/set_mode");

        let request = acp::SetSessionModeRequest::new(session_id, mode_id);
        self.connection
            .set_session_mode(request)
            .await
            .map_err(|e| format!("ACP set_mode failed: {}", e))
    }

    /// Set a session configuration option value.
    pub async fn set_config_option(
        &self,
        session_id: acp::SessionId,
        config_id: String,
        value: String,
    ) -> Result<acp::SetSessionConfigOptionResponse, String> {
        use acp::Agent;

        info!(
            acp_session = %session_id,
            config_id = %config_id,
            value = %value,
            "ACP → session/set_config_option"
        );

        let request = acp::SetSessionConfigOptionRequest::new(session_id, config_id, value);
        self.connection
            .set_session_config_option(request)
            .await
            .map_err(|e| format!("ACP set_config_option failed: {}", e))
    }

    /// List existing sessions known to the agent.
    ///
    /// Sends a `session/list` request. Only available if the agent advertises
    /// `session_capabilities.list`. Handles cursor-based pagination automatically.
    pub async fn list_sessions(
        &self,
        cwd: Option<&Path>,
    ) -> Result<acp::ListSessionsResponse, String> {
        use acp::Agent;

        let mut all_sessions = Vec::new();
        let mut cursor: Option<String> = None;
        const MAX_PAGES: usize = 10;

        for page in 0..MAX_PAGES {
            let mut request = acp::ListSessionsRequest::new();
            if let Some(cwd) = cwd {
                request = request.cwd(cwd.to_path_buf());
            }
            if let Some(ref c) = cursor {
                request = request.cursor(c.clone());
            }

            info!(page, cursor = ?cursor, "ACP → session/list");

            let response = self
                .connection
                .list_sessions(request)
                .await
                .map_err(|e| format!("ACP session/list failed: {}", e))?;

            info!(
                sessions = response.sessions.len(),
                next_cursor = ?response.next_cursor,
                "ACP ← session/list response"
            );

            all_sessions.extend(response.sessions);

            match response.next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }

        Ok(acp::ListSessionsResponse::new(all_sessions))
    }

    /// Load an existing session to resume a previous conversation.
    ///
    /// Sends a `session/load` request. The agent will replay conversation history
    /// via `SessionUpdate` notifications routed through `FaberAcpHandler`.
    pub async fn load_session(
        &self,
        session_id: acp::SessionId,
        cwd: &Path,
        mcp_servers: Vec<acp::McpServer>,
    ) -> Result<acp::LoadSessionResponse, String> {
        use acp::Agent;

        info!(
            acp_session = %session_id,
            cwd = %cwd.display(),
            mcp_servers = mcp_servers.len(),
            "ACP → session/load"
        );

        let mut request = acp::LoadSessionRequest::new(session_id, cwd.to_path_buf());
        if !mcp_servers.is_empty() {
            request = request.mcp_servers(mcp_servers);
        }

        let response = self
            .connection
            .load_session(request)
            .await
            .map_err(|e| format!("ACP session/load failed: {}", e))?;

        info!("ACP ← session/load response");

        Ok(response)
    }

    /// Send a cancellation notification for an active prompt.
    pub async fn cancel(&self, session_id: acp::SessionId) -> Result<(), String> {
        use acp::Agent;

        self.connection
            .cancel(acp::CancelNotification::new(session_id))
            .await
            .map_err(|e| format!("ACP cancel failed: {}", e))?;

        debug!("ACP cancel notification sent");
        Ok(())
    }

    /// Cleanly shut down the ACP client.
    ///
    /// Kills the agent subprocess and its entire process tree, aborts the
    /// I/O task, and cleans up all managed terminals.
    pub async fn shutdown(&mut self) {
        // Clean up managed terminals (with process tree killing)
        capabilities::cleanup_all_terminals(&self.terminals).await;

        // Kill the entire process tree first, then the direct child as fallback.
        // Without tree killing, grandchild processes (like faber-mcp sidecars)
        // can survive as orphans.
        if let Some(pid) = self.child.id() {
            crate::pty::kill_process_tree(pid, "acp-agent");
        }
        if let Err(e) = self.child.kill().await {
            // NotFound is expected after tree kill already terminated the process
            if e.kind() != std::io::ErrorKind::InvalidInput {
                warn!(error = %e, "Failed to kill ACP agent subprocess");
            }
        }

        // Abort the I/O driver task
        if let Some(task) = self.io_task.take() {
            task.abort();
        }

        info!("ACP client shut down");
    }

    /// Get the PID of the agent subprocess (if still running).
    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }

    /// Get a reference to the managed terminals.
    pub fn terminals(&self) -> &ManagedTerminals {
        &self.terminals
    }
}

impl Drop for AcpClient {
    fn drop(&mut self) {
        // Kill the entire process tree (synchronous, best-effort).
        // `kill_on_drop(true)` only kills the direct child — grandchildren
        // (like faber-mcp sidecars) would survive without tree killing.
        if let Some(pid) = self.child.id() {
            crate::pty::kill_process_tree(pid, "acp-agent-drop");
        }

        // Abort the I/O task on drop (best-effort cleanup).
        if let Some(task) = self.io_task.take() {
            task.abort();
        }
    }
}

/// Resolve a command name to its full path on the current platform.
///
/// On Windows, CLI tools installed via npm/pip are `.cmd` batch files.
/// `Command::new("gemini")` can't execute `.cmd` directly, but if we resolve
/// the full path (e.g., `C:\Users\...\gemini.cmd`), Windows will use the
/// correct handler. Falls back to the original command if resolution fails.
fn resolve_command_path(command: &str) -> String {
    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        // Use `where.exe` to find the full path
        let output = std::process::Command::new("where.exe")
            .arg(command)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let lines: Vec<&str> = stdout.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();

                // `where.exe` may return multiple results (e.g. `gemini` and `gemini.cmd`).
                // Prefer .cmd/.bat/.exe — these are valid Win32 executables that Windows
                // can spawn directly. The extensionless file is often a POSIX shell shim
                // that can't be executed as a Win32 process.
                let preferred = lines.iter().find(|l| {
                    let lower = l.to_lowercase();
                    lower.ends_with(".cmd") || lower.ends_with(".bat") || lower.ends_with(".exe")
                });
                let resolved = preferred.or(lines.first()).map(|s| s.to_string());

                if let Some(resolved) = resolved {
                    info!(command = %command, resolved = %resolved, candidates = ?lines, "Resolved ACP command path");
                    return resolved;
                }
            }
        }
        warn!(command = %command, "Could not resolve command path via where.exe, using as-is");
        command.to_string()
    }
    #[cfg(not(windows))]
    {
        command.to_string()
    }
}
