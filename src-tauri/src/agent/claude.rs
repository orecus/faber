use super::{is_command_in_path, AgentAdapter, AgentLaunchConfig, AgentLaunchSpec};
use crate::acp::types::{AcpConfigOption, AcpConfigSelectOption};

pub struct ClaudeCodeAdapter;

/// The external ACP adapter binary from Zed.
/// Install via: `npm install -g @agentclientprotocol/claude-agent-acp`
/// Or download from: https://github.com/agentclientprotocol/claude-agent-acp/releases
pub const CLAUDE_ACP_ADAPTER_COMMAND: &str = "claude-agent-acp";

impl AgentAdapter for ClaudeCodeAdapter {
    fn name(&self) -> &str {
        "claude-code"
    }

    fn display_name(&self) -> &str {
        "Claude Code"
    }

    fn command(&self) -> &str {
        "claude"
    }

    fn build_launch_spec(&self, config: &AgentLaunchConfig) -> AgentLaunchSpec {
        let mut args = Vec::new();

        // Model selection
        if let Some(ref model) = config.model {
            args.push("--model".to_string());
            args.push(model.clone());
        }

        // System prompt via dedicated flag
        if let Some(ref sp) = config.system_prompt {
            args.push("--system-prompt".to_string());
            args.push(sp.clone());
        }

        // Extra flags from config
        args.extend(config.extra_flags.iter().cloned());

        // User prompt as positional argument
        if let Some(ref prompt) = config.prompt {
            args.push(prompt.clone());
        }

        AgentLaunchSpec {
            command: self.command().to_string(),
            args,
            env: config.extra_env.clone(),
        }
    }

    fn supports_system_prompt_flag(&self) -> bool {
        true
    }

    fn default_model(&self) -> Option<&str> {
        Some("sonnet")
    }

    fn supported_models(&self) -> &[&str] {
        &["opus", "sonnet", "haiku", "sonnet[1m]"]
    }

    fn supports_acp(&self) -> bool {
        true
    }

    fn acp_launch_spec(&self) -> Option<(String, Vec<String>)> {
        Some((CLAUDE_ACP_ADAPTER_COMMAND.to_string(), vec![]))
    }

    fn detect_acp_adapter(&self) -> bool {
        is_command_in_path(CLAUDE_ACP_ADAPTER_COMMAND)
    }

    fn acp_install_command(&self) -> Option<&str> {
        Some("npm install -g @agentclientprotocol/claude-agent-acp")
    }

    fn acp_adapter_package(&self) -> Option<&str> {
        Some("@agentclientprotocol/claude-agent-acp")
    }

    fn detect_config_options(&self) -> Vec<AcpConfigOption> {
        // Start with the default model options from the trait
        let mut options = self.default_detect_config_options();

        // Add thought_level (Claude's extended thinking budget levels)
        let levels = [
            ("low", "Low", "Minimal reasoning — fast responses"),
            ("medium", "Medium", "Balanced reasoning depth"),
            ("high", "High", "Deep reasoning for complex tasks"),
            ("max", "Max", "Maximum reasoning budget"),
        ];
        options.push(AcpConfigOption {
            id: "thought_level".to_string(),
            name: "Thinking Level".to_string(),
            description: Some("Controls extended thinking budget".to_string()),
            category: Some("thought_level".to_string()),
            current_value: "medium".to_string(),
            options: levels
                .iter()
                .map(|(value, name, desc)| AcpConfigSelectOption {
                    value: value.to_string(),
                    name: name.to_string(),
                    description: Some(desc.to_string()),
                })
                .collect(),
            groups: vec![],
        });

        options
    }

    fn cli_install_url(&self) -> Option<&str> {
        Some("https://docs.anthropic.com/en/docs/claude-code")
    }

    fn cli_install_hint(&self) -> Option<&str> {
        Some("npm install -g @anthropic-ai/claude-code")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn adapter() -> ClaudeCodeAdapter {
        ClaudeCodeAdapter
    }

    #[test]
    fn basic_properties() {
        let a = adapter();
        assert_eq!(a.name(), "claude-code");
        assert_eq!(a.command(), "claude");
        assert_eq!(a.default_model(), Some("sonnet"));
        assert!(!a.supported_models().is_empty());
    }

    #[test]
    fn supports_acp_via_adapter() {
        let a = adapter();
        assert!(a.supports_acp());
        let (cmd, args) = a.acp_launch_spec().expect("should have ACP launch spec");
        assert_eq!(cmd, CLAUDE_ACP_ADAPTER_COMMAND);
        assert!(args.is_empty());
    }

    #[test]
    fn build_spec_minimal() {
        let spec = adapter().build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: None,
            model: None,
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.command, "claude");
        assert!(spec.args.is_empty());
    }

    #[test]
    fn build_spec_with_model_and_prompt() {
        let spec = adapter().build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: Some("Fix the auth bug".into()),
            model: Some("opus".into()),
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.command, "claude");
        assert_eq!(spec.args, vec!["--model", "opus", "Fix the auth bug"]);
    }

    #[test]
    fn build_spec_with_system_prompt() {
        let spec = adapter().build_launch_spec(&AgentLaunchConfig {
            system_prompt: Some("You are an IDE agent".into()),
            prompt: Some("Fix the bug".into()),
            model: None,
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.args, vec![
            "--system-prompt", "You are an IDE agent",
            "Fix the bug",
        ]);
    }

    #[test]
    fn build_spec_with_extra_flags_and_env() {
        let mut env = HashMap::new();
        env.insert("ANTHROPIC_API_KEY".into(), "sk-test".into());

        let spec = adapter().build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: None,
            model: None,
            extra_flags: vec!["--verbose".into()],
            extra_env: env,
        });
        assert!(spec.args.contains(&"--verbose".to_string()));
        assert_eq!(spec.env.get("ANTHROPIC_API_KEY").unwrap(), "sk-test");
    }
}
