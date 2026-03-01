use super::{AgentAdapter, AgentLaunchConfig, AgentLaunchSpec};

pub struct ClaudeCodeAdapter;

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
