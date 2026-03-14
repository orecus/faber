use super::{AgentAdapter, AgentLaunchConfig, AgentLaunchSpec};

pub struct CopilotCliAdapter;

impl AgentAdapter for CopilotCliAdapter {
    fn name(&self) -> &str {
        "copilot"
    }

    fn display_name(&self) -> &str {
        "Copilot CLI"
    }

    fn command(&self) -> &str {
        "copilot"
    }

    fn build_launch_spec(&self, config: &AgentLaunchConfig) -> AgentLaunchSpec {
        let mut args = Vec::new();

        // Model selection
        if let Some(ref model) = config.model {
            args.push(format!("--model={}", model));
        }

        // Extra flags from agent config
        args.extend(config.extra_flags.iter().cloned());

        // Copilot CLI has no --system-prompt flag. Instructions are written
        // to AGENTS.md in the working directory by the session layer.

        // Use -i (interactive with initial prompt) for sessions — this keeps
        // the session alive and ensures MCP works (MCP doesn't work with -p).
        if let Some(ref prompt) = config.prompt {
            args.push("-i".to_string());
            args.push(prompt.clone());
        }

        AgentLaunchSpec {
            command: self.command().to_string(),
            args,
            env: config.extra_env.clone(),
        }
    }

    fn default_model(&self) -> Option<&str> {
        None // Uses Copilot's own default
    }

    fn supported_models(&self) -> &[&str] {
        &[
            "claude-sonnet-4-5",
            "claude-opus-4-6",
            "gpt-5.3-codex",
            "gemini-3-pro",
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn basic_properties() {
        let a = CopilotCliAdapter;
        assert_eq!(a.name(), "copilot");
        assert_eq!(a.display_name(), "Copilot CLI");
        assert_eq!(a.command(), "copilot");
        assert_eq!(a.default_model(), None);
        assert!(!a.supports_system_prompt_flag());
        assert!(!a.supported_models().is_empty());
    }

    #[test]
    fn build_spec_minimal() {
        let spec = CopilotCliAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: None,
            model: None,
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.command, "copilot");
        assert!(spec.args.is_empty());
    }

    #[test]
    fn build_spec_with_model_and_prompt() {
        let spec = CopilotCliAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: Some("Fix the auth bug".into()),
            model: Some("claude-sonnet-4-5".into()),
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(
            spec.args,
            vec!["--model=claude-sonnet-4-5", "-i", "Fix the auth bug"]
        );
    }

    #[test]
    fn build_spec_ignores_system_prompt() {
        let spec = CopilotCliAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: Some("You are an IDE agent".into()),
            prompt: Some("Fix the bug".into()),
            model: None,
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        // System prompt should NOT appear in args
        assert_eq!(spec.args, vec!["-i", "Fix the bug"]);
    }

    #[test]
    fn build_spec_with_extra_flags_and_env() {
        let mut env = HashMap::new();
        env.insert("GITHUB_TOKEN".into(), "ghp_test".into());

        let spec = CopilotCliAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: None,
            model: None,
            extra_flags: vec!["--autopilot".into(), "--allow-all-tools".into()],
            extra_env: env,
        });
        assert!(spec.args.contains(&"--autopilot".to_string()));
        assert!(spec.args.contains(&"--allow-all-tools".to_string()));
        assert_eq!(spec.env.get("GITHUB_TOKEN").unwrap(), "ghp_test");
    }
}
