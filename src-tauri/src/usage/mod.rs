pub mod claude_code;
pub mod registry;

use serde::Serialize;

/// Data returned by a usage provider for a single agent platform.
#[derive(Debug, Clone, Serialize)]
pub struct AgentUsageData {
    pub agent_name: String,
    pub display_name: String,
    pub windows: Vec<UsageWindow>,
    pub error: Option<String>,
    pub needs_auth: bool,
}

/// A single usage/quota window (e.g. "5-hour session", "7-day weekly").
#[derive(Debug, Clone, Serialize)]
pub struct UsageWindow {
    pub label: String,
    pub utilization: f64,
    pub resets_at: Option<String>,
}
