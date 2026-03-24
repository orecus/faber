use super::{AgentAdapter, AgentLaunchConfig, AgentLaunchSpec};
use crate::acp::types::{AcpConfigOption, AcpConfigSelectGroup, AcpConfigSelectOption};
use crate::cmd_no_window;

pub struct OpenCodeAdapter;

/// Parsed model info from `opencode models --verbose` output.
struct ModelInfo {
    /// Full model ID (e.g. "opencode/big-pickle")
    id: String,
    /// Human-readable name (e.g. "Big Pickle")
    name: String,
    /// Provider ID for grouping (e.g. "opencode", "anthropic")
    provider: String,
    /// Available reasoning/thinking variants (e.g. ["low", "medium", "high"])
    variants: Vec<String>,
}

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

    fn detect_models(&self) -> Vec<String> {
        let resolved = crate::agent::resolve_command(self.command());
        let output = cmd_no_window(&resolved)
            .arg("models")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        match output {
            Ok(out) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect()
            }
            _ => vec![],
        }
    }

    fn detect_config_options(&self) -> Vec<AcpConfigOption> {
        let models = detect_models_verbose(self.command());
        if models.is_empty() {
            return vec![];
        }

        let mut options = Vec::new();

        // ── Model config option ──
        // Group models by provider for a cleaner selector
        let first_model = models[0].id.clone();

        // Collect unique providers in order
        let mut provider_order: Vec<String> = Vec::new();
        for m in &models {
            if !provider_order.contains(&m.provider) {
                provider_order.push(m.provider.clone());
            }
        }

        if provider_order.len() > 1 {
            // Multiple providers → grouped
            let groups: Vec<AcpConfigSelectGroup> = provider_order
                .iter()
                .map(|provider| {
                    let opts = models
                        .iter()
                        .filter(|m| &m.provider == provider)
                        .map(|m| AcpConfigSelectOption {
                            value: m.id.clone(),
                            name: m.name.clone(),
                            description: None,
                        })
                        .collect();
                    AcpConfigSelectGroup {
                        name: provider.clone(),
                        options: opts,
                    }
                })
                .collect();
            options.push(AcpConfigOption {
                id: "model".to_string(),
                name: "Model".to_string(),
                description: None,
                category: Some("model".to_string()),
                current_value: first_model,
                options: vec![],
                groups,
            });
        } else {
            // Single provider → flat list
            let flat: Vec<AcpConfigSelectOption> = models
                .iter()
                .map(|m| AcpConfigSelectOption {
                    value: m.id.clone(),
                    name: m.name.clone(),
                    description: None,
                })
                .collect();
            options.push(AcpConfigOption {
                id: "model".to_string(),
                name: "Model".to_string(),
                description: None,
                category: Some("model".to_string()),
                current_value: flat.first().map(|o| o.value.clone()).unwrap_or_default(),
                options: flat,
                groups: vec![],
            });
        }

        // ── Thought level config option ──
        // Collect the union of all variant names across models that support reasoning.
        // The actual variant applied depends on the current model, but we expose the
        // superset so the selector is always available. OpenCode ignores unknown levels.
        let mut variant_union: Vec<String> = Vec::new();
        for m in &models {
            for v in &m.variants {
                if !variant_union.contains(v) {
                    variant_union.push(v.clone());
                }
            }
        }

        if !variant_union.is_empty() {
            // Pick a reasonable default
            let default_level = if variant_union.contains(&"medium".to_string()) {
                "medium"
            } else {
                variant_union.first().map(|s| s.as_str()).unwrap_or("medium")
            };

            let level_options: Vec<AcpConfigSelectOption> = variant_union
                .iter()
                .map(|v| AcpConfigSelectOption {
                    value: v.clone(),
                    name: capitalize(v),
                    description: None,
                })
                .collect();
            options.push(AcpConfigOption {
                id: "thought_level".to_string(),
                name: "Thinking Level".to_string(),
                description: Some("Controls reasoning depth and token budget".to_string()),
                category: Some("thought_level".to_string()),
                current_value: default_level.to_string(),
                options: level_options,
                groups: vec![],
            });
        }

        options
    }

    fn supports_acp(&self) -> bool {
        true
    }

    fn acp_launch_spec(&self) -> Option<(String, Vec<String>)> {
        Some(("opencode".to_string(), vec!["acp".to_string()]))
    }

    fn cli_install_url(&self) -> Option<&str> {
        Some("https://github.com/opencode-ai/opencode")
    }

    fn cli_install_hint(&self) -> Option<&str> {
        Some("curl -fsSL https://opencode.ai/install | bash")
    }
}

/// Parse `opencode models --verbose` output into structured model info.
///
/// The output format is: model ID line, then a JSON block, repeated per model.
/// We parse the JSON to extract display name, provider, and thinking variants.
fn detect_models_verbose(command: &str) -> Vec<ModelInfo> {
    let resolved = crate::agent::resolve_command(command);
    let output = cmd_no_window(&resolved)
        .args(["models", "--verbose"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    let stdout = match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).to_string(),
        _ => return vec![],
    };

    parse_verbose_output(&stdout)
}

/// Parse the verbose output format: alternating model-ID lines and JSON blocks.
fn parse_verbose_output(stdout: &str) -> Vec<ModelInfo> {
    let mut models = Vec::new();
    let mut current_id: Option<String> = None;
    let mut json_buf = String::new();
    let mut brace_depth: i32 = 0;
    let mut in_json = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if !in_json && trimmed.starts_with('{') {
            in_json = true;
            json_buf.clear();
        }

        if in_json {
            json_buf.push_str(line);
            json_buf.push('\n');
            brace_depth += trimmed.chars().filter(|&c| c == '{').count() as i32;
            brace_depth -= trimmed.chars().filter(|&c| c == '}').count() as i32;

            if brace_depth == 0 {
                in_json = false;
                if let Some(ref id) = current_id {
                    if let Some(info) = parse_model_json(id, &json_buf) {
                        models.push(info);
                    }
                }
                current_id = None;
                json_buf.clear();
            }
        } else {
            // This is a model ID line (e.g. "opencode/big-pickle")
            current_id = Some(trimmed.to_string());
        }
    }

    models
}

/// Parse a single model's JSON metadata.
fn parse_model_json(full_id: &str, json_str: &str) -> Option<ModelInfo> {
    let v: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let name = v.get("name")?.as_str()?.to_string();
    let provider = v
        .get("providerID")
        .and_then(|p| p.as_str())
        .unwrap_or("unknown")
        .to_string();

    let variants: Vec<String> = v
        .get("variants")
        .and_then(|v| v.as_object())
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default();

    Some(ModelInfo {
        id: full_id.to_string(),
        name,
        provider,
        variants,
    })
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().to_string() + chars.as_str(),
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

    #[test]
    fn parse_verbose_output_single_model() {
        let output = r#"opencode/big-pickle
{
  "id": "big-pickle",
  "providerID": "opencode",
  "name": "Big Pickle",
  "variants": {
    "high": { "thinking": { "type": "enabled", "budgetTokens": 16000 } },
    "max": { "thinking": { "type": "enabled", "budgetTokens": 31999 } }
  }
}
"#;
        let models = parse_verbose_output(output);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "opencode/big-pickle");
        assert_eq!(models[0].name, "Big Pickle");
        assert_eq!(models[0].provider, "opencode");
        assert_eq!(models[0].variants.len(), 2);
        assert!(models[0].variants.contains(&"high".to_string()));
        assert!(models[0].variants.contains(&"max".to_string()));
    }

    #[test]
    fn parse_verbose_output_multiple_providers() {
        let output = r#"opencode/big-pickle
{
  "id": "big-pickle",
  "providerID": "opencode",
  "name": "Big Pickle",
  "variants": {}
}
anthropic/claude-sonnet-4
{
  "id": "claude-sonnet-4",
  "providerID": "anthropic",
  "name": "Claude Sonnet 4",
  "variants": { "low": {}, "medium": {}, "high": {} }
}
"#;
        let models = parse_verbose_output(output);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].provider, "opencode");
        assert_eq!(models[1].provider, "anthropic");
        assert_eq!(models[1].variants.len(), 3);
    }

    #[test]
    fn parse_verbose_output_no_variants_key() {
        let output = r#"opencode/test-model
{
  "id": "test-model",
  "providerID": "opencode",
  "name": "Test Model"
}
"#;
        let models = parse_verbose_output(output);
        assert_eq!(models.len(), 1);
        assert!(models[0].variants.is_empty());
    }
}
