use super::claude_code::ClaudeCodeProvider;
use super::AgentUsageData;

/// Registry holding all available usage providers.
pub struct UsageRegistry {
    claude_code: ClaudeCodeProvider,
}

impl UsageRegistry {
    pub fn new() -> Self {
        Self {
            claude_code: ClaudeCodeProvider::new(),
        }
    }

    /// Fetch usage data from all available providers.
    pub async fn fetch_all(&self) -> Vec<AgentUsageData> {
        let mut results = Vec::new();

        if self.claude_code.is_available() {
            results.push(self.claude_code.fetch_usage().await);
        }

        // Future providers can be added here:
        // if self.codex.is_available() { results.push(self.codex.fetch_usage().await); }

        results
    }
}
