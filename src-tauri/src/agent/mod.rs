pub mod claude;
pub mod codex;
pub mod copilot;
pub mod cursor;
pub mod gemini;
pub mod opencode;
pub mod registry;

use std::collections::HashMap;

use serde::Serialize;

use crate::cmd_no_window;

// ── Types ──

/// Configuration for launching an agent session.
pub struct AgentLaunchConfig {
    /// System prompt (IDE instructions, MCP setup, task context).
    /// Passed via agent-specific flag (e.g. `--system-prompt` for Claude Code).
    pub system_prompt: Option<String>,
    /// User prompt (the initial message/task for the agent).
    /// Passed as a positional argument.
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub extra_flags: Vec<String>,
    pub extra_env: HashMap<String, String>,
}

/// The resolved command + args + env for spawning via PTY.
#[derive(Debug, Clone)]
pub struct AgentLaunchSpec {
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

/// Serializable agent info for IPC.
#[derive(Debug, Clone, Serialize)]
pub struct AgentInfo {
    pub name: String,
    pub display_name: String,
    pub command: String,
    pub installed: bool,
    pub default_model: Option<String>,
    pub supported_models: Vec<String>,
    /// Whether this agent supports ACP (natively or via an external adapter).
    pub supports_acp: bool,
    /// Whether the ACP adapter/binary is actually installed and available.
    /// For native ACP agents, this matches `installed`. For agents using
    /// external adapters (e.g. Claude Code via `claude-agent-acp`), this
    /// checks whether the adapter binary is in PATH.
    pub acp_installed: bool,
    /// The ACP launch command (if different from the PTY command).
    pub acp_command: Option<String>,
    /// Additional args needed to launch in ACP mode (e.g., ["--acp"]).
    pub acp_args: Vec<String>,
    /// The shell command to install the ACP adapter (e.g., "npm install -g @zed-industries/claude-agent-acp").
    /// `None` for agents with native ACP support.
    pub acp_install_command: Option<String>,
    /// The npm package name for the ACP adapter (e.g., "@zed-industries/claude-agent-acp").
    /// `None` for agents with native ACP support.
    pub acp_adapter_package: Option<String>,
    /// URL to the official install/download page for this agent's CLI tool.
    pub cli_install_url: Option<String>,
    /// A short shell command hint for installing the CLI (e.g., "npm install -g ...").
    pub cli_install_hint: Option<String>,
}

// ── Trait ──

pub trait AgentAdapter: Send + Sync {
    /// Internal identifier (e.g., `"claude-code"`).
    fn name(&self) -> &str;

    /// Human-readable name (e.g., `"Claude Code"`).
    fn display_name(&self) -> &str;

    /// CLI command name (e.g., `"claude"`).
    fn command(&self) -> &str;

    /// Build the full launch spec from a launch config.
    fn build_launch_spec(&self, config: &AgentLaunchConfig) -> AgentLaunchSpec;

    /// Check if the CLI tool is installed and accessible in PATH.
    fn detect_installation(&self) -> bool {
        is_command_in_path(self.command())
    }

    /// Whether this agent supports a CLI flag for passing a system prompt.
    /// Agents that return `true` (e.g. Claude Code, OpenCode) will receive MCP
    /// instructions via the system prompt flag. Agents that return `false` rely
    /// on their instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, etc.).
    fn supports_system_prompt_flag(&self) -> bool {
        false
    }

    /// Default model for this agent (if any).
    fn default_model(&self) -> Option<&str>;

    /// List of known supported models.
    fn supported_models(&self) -> &[&str];

    /// Dynamically detect available models by running the agent's CLI.
    /// Returns model IDs discovered at runtime. Falls back to `supported_models()`
    /// if the CLI query fails or is not supported.
    fn detect_models(&self) -> Vec<String> {
        self.supported_models().iter().map(|s| s.to_string()).collect()
    }

    /// Detect ACP config options that the agent doesn't advertise via ACP.
    ///
    /// Returns synthesized `AcpConfigOption`s for model, thought_level, etc.
    /// by querying the agent's CLI. Called when the ACP session doesn't provide
    /// its own config options. Default: builds a model option from `detect_models()`.
    fn detect_config_options(&self) -> Vec<crate::acp::types::AcpConfigOption> {
        use crate::acp::types::{AcpConfigOption, AcpConfigSelectOption};

        let models = self.detect_models();
        if models.is_empty() {
            return vec![];
        }

        let default = self.default_model()
            .map(String::from)
            .unwrap_or_else(|| models[0].clone());
        let options: Vec<AcpConfigSelectOption> = models
            .iter()
            .map(|m| AcpConfigSelectOption {
                value: m.clone(),
                name: m.clone(),
                description: None,
            })
            .collect();

        vec![AcpConfigOption {
            id: "model".to_string(),
            name: "Model".to_string(),
            description: None,
            category: Some("model".to_string()),
            current_value: default,
            options,
            groups: vec![],
        }]
    }

    /// Whether this agent supports ACP (Agent Client Protocol).
    /// Agents that return `true` can be launched via structured JSON-RPC
    /// over stdio instead of the PTY + MCP approach.
    ///
    /// For agents with native ACP support (e.g. Gemini `--acp`), this is always `true`.
    /// For agents that need an external adapter binary (e.g. Claude Code via
    /// `claude-agent-acp`), this returns `true` to indicate ACP *capability*,
    /// while `detect_acp_adapter()` checks if the adapter is actually installed.
    fn supports_acp(&self) -> bool {
        false
    }

    /// Build the ACP launch command and args (if `supports_acp()` is true).
    /// Returns `(command, args)` for spawning the agent in ACP mode.
    fn acp_launch_spec(&self) -> Option<(String, Vec<String>)> {
        None
    }

    /// Detect whether the ACP adapter/binary is available on this system.
    ///
    /// For agents with native ACP support (e.g. Gemini, Copilot), this returns
    /// the same as `detect_installation()` — if the agent is installed, ACP works.
    /// For agents that require an external adapter binary (e.g. Claude Code via
    /// `claude-agent-acp`), this checks whether the adapter binary is in PATH.
    fn detect_acp_adapter(&self) -> bool {
        // Default: if the agent supports ACP natively, the adapter is the agent itself
        self.supports_acp() && self.detect_installation()
    }

    /// The shell command to install the ACP adapter (for agents that need one).
    /// Returns `None` for agents with native ACP support.
    fn acp_install_command(&self) -> Option<&str> {
        None
    }

    /// The npm package name for the ACP adapter (for agents that need one).
    /// Returns `None` for agents with native ACP support.
    fn acp_adapter_package(&self) -> Option<&str> {
        None
    }

    /// URL to the official install/download page for this agent's CLI tool.
    /// Shown in the UI when the CLI is not detected on `$PATH`.
    fn cli_install_url(&self) -> Option<&str> {
        None
    }

    /// A short shell command hint for installing this agent's CLI tool
    /// (e.g., `npm install -g @anthropic-ai/claude-code`).
    /// Shown alongside the install URL for quick reference.
    fn cli_install_hint(&self) -> Option<&str> {
        None
    }
}

// ── Registry ──

/// Return all built-in agent adapters.
pub fn builtin_adapters() -> Vec<Box<dyn AgentAdapter>> {
    vec![
        Box::new(claude::ClaudeCodeAdapter),
        Box::new(codex::CodexAdapter),
        Box::new(copilot::CopilotCliAdapter),
        Box::new(cursor::CursorAgentAdapter),
        Box::new(gemini::GeminiAdapter),
        Box::new(opencode::OpenCodeAdapter),
    ]
}

/// Find a built-in adapter by name.
pub fn get_adapter(name: &str) -> Option<Box<dyn AgentAdapter>> {
    builtin_adapters().into_iter().find(|a| a.name() == name)
}

/// Get basic info for all built-in adapters without running installation detection.
/// Use this when you only need agent names/display names (e.g. listing rule files).
pub fn list_agent_info_no_detect() -> Vec<AgentInfo> {
    builtin_adapters()
        .iter()
        .map(|a| {
            let acp_spec = a.acp_launch_spec();
            AgentInfo {
                name: a.name().to_string(),
                display_name: a.display_name().to_string(),
                command: a.command().to_string(),
                installed: false, // not checked
                default_model: a.default_model().map(String::from),
                supported_models: a.supported_models().iter().map(|s| s.to_string()).collect(),
                supports_acp: a.supports_acp(),
                acp_installed: false, // not checked
                acp_command: acp_spec.as_ref().map(|(cmd, _)| cmd.clone()),
                acp_args: acp_spec.map(|(_, args)| args).unwrap_or_default(),
                acp_install_command: a.acp_install_command().map(String::from),
                acp_adapter_package: a.acp_adapter_package().map(String::from),
                cli_install_url: a.cli_install_url().map(String::from),
                cli_install_hint: a.cli_install_hint().map(String::from),
            }
        })
        .collect()
}

/// Get info for all built-in adapters (runs installation detection).
pub fn list_agent_info() -> Vec<AgentInfo> {
    let agents: Vec<AgentInfo> = builtin_adapters()
        .iter()
        .map(|a| {
            let acp_spec = a.acp_launch_spec();
            AgentInfo {
                name: a.name().to_string(),
                display_name: a.display_name().to_string(),
                command: a.command().to_string(),
                installed: a.detect_installation(),
                default_model: a.default_model().map(String::from),
                supported_models: a.supported_models().iter().map(|s| s.to_string()).collect(),
                supports_acp: a.supports_acp(),
                acp_installed: a.detect_acp_adapter(),
                acp_command: acp_spec.as_ref().map(|(cmd, _)| cmd.clone()),
                acp_args: acp_spec.map(|(_, args)| args).unwrap_or_default(),
                acp_install_command: a.acp_install_command().map(String::from),
                acp_adapter_package: a.acp_adapter_package().map(String::from),
                cli_install_url: a.cli_install_url().map(String::from),
                cli_install_hint: a.cli_install_hint().map(String::from),
            }
        })
        .collect();

    let installed: Vec<&str> = agents.iter().filter(|a| a.installed).map(|a| a.name.as_str()).collect();
    let missing: Vec<&str> = agents.iter().filter(|a| !a.installed).map(|a| a.name.as_str()).collect();
    let acp_available: Vec<&str> = agents.iter().filter(|a| a.acp_installed).map(|a| a.name.as_str()).collect();
    tracing::info!(
        installed = %installed.join(", "),
        missing = %missing.join(", "),
        acp = %acp_available.join(", "),
        "Agent detection complete"
    );

    agents
}

// ── Helpers ──

/// Resolve a command name to its full executable path.
///
/// On Windows, npm-installed CLIs are `.cmd` batch files that can't be spawned
/// directly via `Command::new("opencode")`. This function uses `where.exe` to
/// find the full path (e.g. `C:\Users\...\opencode.cmd`) which Windows can
/// execute directly. On non-Windows platforms, returns the command as-is.
pub(crate) fn resolve_command(command: &str) -> String {
    #[cfg(windows)]
    {
        let output = cmd_no_window("where.exe")
            .arg(command)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let lines: Vec<&str> = stdout.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
                // Prefer .cmd/.bat/.exe — the extensionless file is often a POSIX shim
                let preferred = lines.iter().find(|l| {
                    let lower = l.to_lowercase();
                    lower.ends_with(".cmd") || lower.ends_with(".bat") || lower.ends_with(".exe")
                });
                if let Some(resolved) = preferred.or(lines.first()) {
                    return resolved.to_string();
                }
            }
        }
        command.to_string()
    }
    #[cfg(not(windows))]
    {
        command.to_string()
    }
}

/// Check if a command is available in PATH.
pub(crate) fn is_command_in_path(command: &str) -> bool {
    let check_cmd = if cfg!(windows) { "where.exe" } else { "which" };
    cmd_no_window(check_cmd)
        .arg(command)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_adapters_has_six() {
        let adapters = builtin_adapters();
        assert_eq!(adapters.len(), 6);
    }

    #[test]
    fn adapter_names_are_unique() {
        let adapters = builtin_adapters();
        let names: Vec<&str> = adapters.iter().map(|a| a.name()).collect();
        let mut deduped = names.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(names.len(), deduped.len());
    }

    #[test]
    fn get_adapter_by_name() {
        assert!(get_adapter("claude-code").is_some());
        assert!(get_adapter("codex").is_some());
        assert!(get_adapter("copilot").is_some());
        assert!(get_adapter("cursor-agent").is_some());
        assert!(get_adapter("gemini").is_some());
        assert!(get_adapter("opencode").is_some());
        assert!(get_adapter("nonexistent").is_none());
    }

    #[test]
    fn list_agent_info_returns_all() {
        let info = list_agent_info();
        assert_eq!(info.len(), 6);
        assert!(info.iter().any(|a| a.name == "claude-code"));
        assert!(info.iter().any(|a| a.name == "codex"));
        assert!(info.iter().any(|a| a.name == "copilot"));
        assert!(info.iter().any(|a| a.name == "cursor-agent"));
        assert!(info.iter().any(|a| a.name == "gemini"));
        assert!(info.iter().any(|a| a.name == "opencode"));
    }

    #[test]
    fn is_command_in_path_finds_common_tools() {
        // Use platform-appropriate commands that exist as real executables
        // (not shell builtins like `echo` which `where.exe` won't find on Windows)
        if cfg!(windows) {
            assert!(is_command_in_path("cmd.exe") || is_command_in_path("where.exe"));
        } else {
            assert!(is_command_in_path("ls") || is_command_in_path("echo"));
        }
    }

    #[test]
    fn is_command_in_path_rejects_missing() {
        assert!(!is_command_in_path("definitely_not_a_real_command_xyz_123"));
    }
}
