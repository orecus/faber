use super::{AgentAdapter, AgentLaunchConfig, AgentLaunchSpec};

pub struct CodexAdapter;

impl AgentAdapter for CodexAdapter {
    fn name(&self) -> &str {
        "codex"
    }

    fn display_name(&self) -> &str {
        "Codex CLI"
    }

    fn command(&self) -> &str {
        "codex"
    }

    fn build_launch_spec(&self, config: &AgentLaunchConfig) -> AgentLaunchSpec {
        let mut args = Vec::new();

        // Model selection
        if let Some(ref model) = config.model {
            args.push("--model".to_string());
            args.push(model.clone());
        }

        // Codex has no system prompt CLI flag — system prompt is written
        // to AGENTS.md in the working directory by the session layer.

        // Extra flags
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

    fn default_model(&self) -> Option<&str> {
        Some("gpt-5.3-codex")
    }

    fn supported_models(&self) -> &[&str] {
        &["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-max", "gpt-5.2", "gpt-5.1-codex-mini"]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn basic_properties() {
        let a = CodexAdapter;
        assert_eq!(a.name(), "codex");
        assert_eq!(a.command(), "codex");
        assert_eq!(a.default_model(), Some("gpt-5.3-codex"));
    }

    #[test]
    fn build_spec_with_prompt() {
        let spec = CodexAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: Some("Add tests".into()),
            model: Some("o3".into()),
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.args, vec!["--model", "o3", "Add tests"]);
    }
}
