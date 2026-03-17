use super::{AgentAdapter, AgentLaunchConfig, AgentLaunchSpec};

pub struct OpenCodeAdapter;

impl AgentAdapter for OpenCodeAdapter {
    fn name(&self) -> &str {
        "opencode"
    }

    fn display_name(&self) -> &str {
        "OpenCode"
    }

    fn command(&self) -> &str {
        "opencode"
    }

    fn build_launch_spec(&self, config: &AgentLaunchConfig) -> AgentLaunchSpec {
        let mut args = Vec::new();

        // Model selection
        if let Some(ref model) = config.model {
            args.push("--model".to_string());
            args.push(model.clone());
        }

        // Extra flags
        args.extend(config.extra_flags.iter().cloned());

        // User prompt via --prompt flag (NOT positional — positional is [project] path)
        // System prompt goes to AGENTS.md via the instruction file mechanism.
        if let Some(ref prompt) = config.prompt {
            args.push("--prompt".to_string());
            args.push(prompt.clone());
        }

        AgentLaunchSpec {
            command: self.command().to_string(),
            args,
            env: config.extra_env.clone(),
        }
    }

    fn default_model(&self) -> Option<&str> {
        None
    }

    fn supported_models(&self) -> &[&str] {
        &[]
    }

    fn supports_acp(&self) -> bool {
        true
    }

    fn acp_launch_spec(&self) -> Option<(String, Vec<String>)> {
        Some(("opencode".to_string(), vec![]))
    }

    fn cli_install_url(&self) -> Option<&str> {
        Some("https://github.com/opencode-ai/opencode")
    }

    fn cli_install_hint(&self) -> Option<&str> {
        Some("curl -fsSL https://opencode.ai/install | bash")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn basic_properties() {
        let a = OpenCodeAdapter;
        assert_eq!(a.name(), "opencode");
        assert_eq!(a.command(), "opencode");
        assert_eq!(a.default_model(), None);
        assert!(a.supported_models().is_empty());
    }

    #[test]
    fn build_spec_with_model() {
        let spec = OpenCodeAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: None,
            model: Some("anthropic/claude-sonnet-4-20250514".into()),
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.args, vec!["--model", "anthropic/claude-sonnet-4-20250514"]);
    }

    #[test]
    fn build_spec_with_prompt() {
        let spec = OpenCodeAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: Some("Fix the bug".into()),
            model: None,
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.args, vec!["--prompt", "Fix the bug"]);
    }

    #[test]
    fn build_spec_ignores_system_prompt() {
        // System prompt should NOT appear in args — it goes to AGENTS.md
        let spec = OpenCodeAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: Some("You are helpful.".into()),
            prompt: Some("Fix the bug".into()),
            model: None,
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.args, vec!["--prompt", "Fix the bug"]);
    }
}
