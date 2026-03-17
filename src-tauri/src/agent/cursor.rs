use super::{is_command_in_path, AgentAdapter, AgentLaunchConfig, AgentLaunchSpec};

pub struct CursorAgentAdapter;

/// Cursor CLI ships as `agent` (current) but older installs use `cursor-agent`.
const CURSOR_COMMANDS: &[&str] = &["agent", "cursor-agent"];

/// Return the first Cursor CLI binary found in PATH, preferring `agent`.
fn detect_cursor_command() -> Option<&'static str> {
    CURSOR_COMMANDS.iter().copied().find(|cmd| is_command_in_path(cmd))
}

impl AgentAdapter for CursorAgentAdapter {
    fn name(&self) -> &str {
        "cursor-agent"
    }

    fn display_name(&self) -> &str {
        "Cursor Agent"
    }

    fn command(&self) -> &str {
        "agent"
    }

    fn detect_installation(&self) -> bool {
        detect_cursor_command().is_some()
    }

    fn build_launch_spec(&self, config: &AgentLaunchConfig) -> AgentLaunchSpec {
        // Use whichever binary is actually installed, falling back to "agent"
        let command = detect_cursor_command().unwrap_or("agent");
        let mut args = Vec::new();

        // Model selection
        if let Some(ref model) = config.model {
            args.push("--model".to_string());
            args.push(model.clone());
        }

        // Cursor Agent has no system prompt CLI flag — instructions are written
        // to AGENTS.md in the working directory by the session layer.

        // Extra flags
        args.extend(config.extra_flags.iter().cloned());

        // User prompt as positional argument
        if let Some(ref prompt) = config.prompt {
            args.push(prompt.clone());
        }

        AgentLaunchSpec {
            command: command.to_string(),
            args,
            env: config.extra_env.clone(),
        }
    }

    fn default_model(&self) -> Option<&str> {
        Some("claude-4-opus")
    }

    fn supported_models(&self) -> &[&str] {
        &[
            "claude-4-opus",
            "claude-4.5-sonnet",
            "gpt-5",
            "gpt-5.1",
            "gemini-3-pro",
            "gemini-3-flash",
        ]
    }

    fn supports_acp(&self) -> bool {
        true
    }

    fn acp_launch_spec(&self) -> Option<(String, Vec<String>)> {
        // Use whichever binary is actually installed
        let command = detect_cursor_command().unwrap_or("agent");
        Some((command.to_string(), vec!["acp".to_string()]))
    }

    fn cli_install_url(&self) -> Option<&str> {
        Some("https://cursor.com")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn basic_properties() {
        let a = CursorAgentAdapter;
        assert_eq!(a.name(), "cursor-agent");
        assert_eq!(a.command(), "agent");
        assert_eq!(a.default_model(), Some("claude-4-opus"));
        assert!(!a.supported_models().is_empty());
    }

    #[test]
    fn build_spec_minimal() {
        let spec = CursorAgentAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: None,
            model: None,
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        // Uses whichever binary is found; falls back to "agent"
        assert!(spec.command == "agent" || spec.command == "cursor-agent");
        assert!(spec.args.is_empty());
    }

    #[test]
    fn build_spec_with_model_and_prompt() {
        let spec = CursorAgentAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: Some("Fix the auth bug".into()),
            model: Some("gpt-5".into()),
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.args, vec!["--model", "gpt-5", "Fix the auth bug"]);
    }

    #[test]
    fn build_spec_ignores_system_prompt() {
        let spec = CursorAgentAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: Some("You are an IDE agent".into()),
            prompt: Some("Fix the bug".into()),
            model: None,
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        // System prompt should NOT appear in args
        assert_eq!(spec.args, vec!["Fix the bug"]);
    }

    #[test]
    fn build_spec_with_extra_flags_and_env() {
        let mut env = HashMap::new();
        env.insert("CURSOR_API_KEY".into(), "sk-test".into());

        let spec = CursorAgentAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: None,
            model: None,
            extra_flags: vec!["--force".into()],
            extra_env: env,
        });
        assert!(spec.args.contains(&"--force".to_string()));
        assert_eq!(spec.env.get("CURSOR_API_KEY").unwrap(), "sk-test");
    }
}
