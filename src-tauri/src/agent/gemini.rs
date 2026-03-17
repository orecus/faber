use super::{AgentAdapter, AgentLaunchConfig, AgentLaunchSpec};

pub struct GeminiAdapter;

impl AgentAdapter for GeminiAdapter {
    fn name(&self) -> &str {
        "gemini"
    }

    fn display_name(&self) -> &str {
        "Gemini CLI"
    }

    fn command(&self) -> &str {
        "gemini"
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

        // Gemini has no system prompt CLI flag — system prompt is written
        // to GEMINI.md in the working directory by the session layer.
        // Use --prompt-interactive to pass the initial prompt and stay in
        // interactive mode (positional query also works but this is explicit).
        if let Some(ref prompt) = config.prompt {
            args.push("--prompt-interactive".to_string());
            args.push(prompt.clone());
        }

        AgentLaunchSpec {
            command: self.command().to_string(),
            args,
            env: config.extra_env.clone(),
        }
    }

    fn default_model(&self) -> Option<&str> {
        Some("gemini-2.5-pro")
    }

    fn supported_models(&self) -> &[&str] {
        &["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-pro", "gemini-3-flash"]
    }

    fn supports_acp(&self) -> bool {
        true
    }

    fn acp_launch_spec(&self) -> Option<(String, Vec<String>)> {
        Some(("gemini".to_string(), vec!["--acp".to_string()]))
    }

    fn cli_install_url(&self) -> Option<&str> {
        Some("https://github.com/google-gemini/gemini-cli")
    }

    fn cli_install_hint(&self) -> Option<&str> {
        Some("npm install -g @google/gemini-cli")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn basic_properties() {
        let a = GeminiAdapter;
        assert_eq!(a.name(), "gemini");
        assert_eq!(a.command(), "gemini");
        assert_eq!(a.default_model(), Some("gemini-2.5-pro"));
    }

    #[test]
    fn build_spec_with_model() {
        let spec = GeminiAdapter.build_launch_spec(&AgentLaunchConfig {
            system_prompt: None,
            prompt: None,
            model: Some("gemini-2.5-flash".into()),
            extra_flags: vec![],
            extra_env: HashMap::new(),
        });
        assert_eq!(spec.args, vec!["--model", "gemini-2.5-flash"]);
    }
}
