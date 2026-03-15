pub mod claude;
pub mod codex;
pub mod copilot;
pub mod cursor;
pub mod gemini;
pub mod opencode;

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
        .map(|a| AgentInfo {
            name: a.name().to_string(),
            display_name: a.display_name().to_string(),
            command: a.command().to_string(),
            installed: false, // not checked
            default_model: a.default_model().map(String::from),
            supported_models: a.supported_models().iter().map(|s| s.to_string()).collect(),
        })
        .collect()
}

/// Get info for all built-in adapters (runs installation detection).
pub fn list_agent_info() -> Vec<AgentInfo> {
    let agents: Vec<AgentInfo> = builtin_adapters()
        .iter()
        .map(|a| AgentInfo {
            name: a.name().to_string(),
            display_name: a.display_name().to_string(),
            command: a.command().to_string(),
            installed: a.detect_installation(),
            default_model: a.default_model().map(String::from),
            supported_models: a.supported_models().iter().map(|s| s.to_string()).collect(),
        })
        .collect();

    let installed: Vec<&str> = agents.iter().filter(|a| a.installed).map(|a| a.name.as_str()).collect();
    let missing: Vec<&str> = agents.iter().filter(|a| !a.installed).map(|a| a.name.as_str()).collect();
    tracing::info!(
        installed = %installed.join(", "),
        missing = %missing.join(", "),
        "Agent detection complete"
    );

    agents
}

// ── Helpers ──

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
