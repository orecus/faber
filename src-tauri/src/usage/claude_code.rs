use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::sync::Mutex;
use tracing::{debug, warn};

use super::{AgentUsageData, UsageWindow};

/// Atomic flag to avoid repeated keychain permission prompts after a failure.
static CREDENTIAL_STORE_FAILED: AtomicBool = AtomicBool::new(false);

/// Cached token with expiry tracking.
struct CachedToken {
    access_token: String,
    fetched_at: Instant,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub struct ClaudeCodeProvider {
    cached_token: Mutex<Option<CachedToken>>,
}

impl ClaudeCodeProvider {
    pub fn new() -> Self {
        Self {
            cached_token: Mutex::new(None),
        }
    }

    /// Try to get a valid OAuth token. Returns None if unavailable.
    async fn get_token(&self) -> Option<String> {
        let mut cache = self.cached_token.lock().await;

        // Check if cached token is still valid (with 60s buffer)
        if let Some(ref cached) = *cache {
            let age = cached.fetched_at.elapsed();
            let still_valid = if let Some(expires_at) = cached.expires_at {
                let now = chrono::Utc::now();
                expires_at > now + chrono::Duration::seconds(60)
            } else {
                // No expiry info — re-fetch after 5 minutes
                age < Duration::from_secs(300)
            };
            if still_valid {
                return Some(cached.access_token.clone());
            }
            debug!("Cached usage token expired, re-fetching");
        }

        // Try file-based credentials first
        if let Some(token_data) = Self::read_credentials_file() {
            let new_cache = CachedToken {
                access_token: token_data.access_token.clone(),
                fetched_at: Instant::now(),
                expires_at: token_data.expires_at.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&chrono::Utc))
                }),
            };
            // Check if this token is expired
            if let Some(expires_at) = new_cache.expires_at {
                if expires_at <= chrono::Utc::now() + chrono::Duration::seconds(60) {
                    debug!("Claude Code file token is expired, trying keychain");
                    // Fall through to keychain
                } else {
                    let token = new_cache.access_token.clone();
                    *cache = Some(new_cache);
                    return Some(token);
                }
            } else {
                let token = new_cache.access_token.clone();
                *cache = Some(new_cache);
                return Some(token);
            }
        }

        // Try OS keychain fallback
        let keychain_failed = CREDENTIAL_STORE_FAILED.load(Ordering::Relaxed);
        if !keychain_failed {
            if let Some(token) = Self::read_keychain_token() {
                debug!("Usage token resolved from keychain");
                let new_cache = CachedToken {
                    access_token: token.clone(),
                    fetched_at: Instant::now(),
                    expires_at: None,
                };
                *cache = Some(new_cache);
                return Some(token);
            }
            debug!("Keychain returned no usage token");
        }

        debug!("No usage token found from any source");
        *cache = None;
        None
    }

    /// Read token from `~/.claude/.credentials.json`.
    fn read_credentials_file() -> Option<CredentialsFileToken> {
        let home = dirs_next().ok()?;
        let creds_path = home.join(".claude").join(".credentials.json");

        let content = match std::fs::read_to_string(&creds_path) {
            Ok(c) => c,
            Err(_) => return None,
        };

        let parsed: serde_json::Value = match serde_json::from_str::<serde_json::Value>(&content) {
            Ok(v) => v,
            Err(e) => {
                warn!("Failed to parse Claude credentials JSON: {}", e);
                return None;
            }
        };

        // The token is at `claudeAiOauth.accessToken` or `claude_ai_oauth.access_token`
        let oauth = parsed
            .get("claudeAiOauth")
            .or_else(|| parsed.get("claude_ai_oauth"));

        let oauth = oauth?;

        let access_token = oauth
            .get("accessToken")
            .or_else(|| oauth.get("access_token"))
            .and_then(|v: &serde_json::Value| v.as_str())
            .map(|s: &str| s.to_string());

        let access_token = access_token?;

        let expires_at = oauth
            .get("expiresAt")
            .or_else(|| oauth.get("expires_at"))
            .and_then(|v: &serde_json::Value| v.as_str())
            .map(|s: &str| s.to_string());

        Some(CredentialsFileToken {
            access_token,
            expires_at,
        })
    }

    /// Try reading from OS keychain.
    fn read_keychain_token() -> Option<String> {
        use keyring::Entry;

        // Claude Code stores credentials under the OS username, not "default"
        let username = whoami::username();

        let result = Entry::new("Claude Code-credentials", &username)
            .and_then(|entry| entry.get_password());

        match result {
            Ok(password) => {
                // The keychain entry might be JSON or a raw token
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&password) {
                    let oauth = parsed
                        .get("claudeAiOauth")
                        .or_else(|| parsed.get("claude_ai_oauth"));
                    if let Some(oauth) = oauth {
                        let token = oauth
                            .get("accessToken")
                            .or_else(|| oauth.get("access_token"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        return token;
                    }
                    debug!("Keychain entry has no claudeAiOauth key, trying as raw string");
                    // Maybe it's just a token string in JSON
                    parsed.as_str().map(|s| s.to_string())
                } else {
                    debug!("Keychain value is not JSON, treating as raw token");
                    // Raw token string
                    Some(password)
                }
            }
            Err(e) => {
                // Only permanently disable on real access/permission errors,
                // not on NoEntry (which just means the entry doesn't exist yet)
                let is_no_entry = format!("{:?}", e).contains("NoEntry");
                if !is_no_entry {
                    warn!("Keychain read failed (disabling further attempts): {:?}", e);
                    CREDENTIAL_STORE_FAILED.store(true, Ordering::Relaxed);
                } else {
                    debug!("Keychain has no entry — will retry on next poll");
                }
                None
            }
        }
    }
}

struct CredentialsFileToken {
    access_token: String,
    expires_at: Option<String>,
}

/// Get the user's home directory.
fn dirs_next() -> Result<std::path::PathBuf, ()> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE")
            .map(std::path::PathBuf::from)
            .map_err(|_| ())
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .map(std::path::PathBuf::from)
            .map_err(|_| ())
    }
}

/// API response from Anthropic's usage endpoint.
///
/// We parse as a map of named windows to handle current and future fields
/// (five_hour, seven_day, seven_day_opus, seven_day_oauth_apps, etc.)
/// without needing to update the struct for each new window type.
#[derive(Debug, Deserialize)]
struct UsageWindowResponse {
    utilization: f64,
    resets_at: Option<String>,
}

/// Map API field names to human-readable labels matching the Claude Code UI.
fn window_label(api_key: &str) -> Option<&'static str> {
    match api_key {
        "five_hour" => Some("Session"),
        "seven_day" => Some("Weekly (all)"),
        "seven_day_opus" => Some("Weekly (Sonnet)"),
        _ => None, // skip unknown fields (nulls, iguana_necktie, etc.)
    }
}

/// Order for display: session first, then weekly, then model-specific.
fn window_order(api_key: &str) -> u8 {
    match api_key {
        "five_hour" => 0,
        "seven_day" => 1,
        "seven_day_opus" => 2,
        _ => 99,
    }
}

impl ClaudeCodeProvider {
    pub fn agent_name(&self) -> &str {
        "claude"
    }

    pub fn display_name(&self) -> &str {
        "Claude Code"
    }

    pub fn is_available(&self) -> bool {
        // Check if credentials file exists
        if let Ok(home) = dirs_next() {
            let creds_path = home.join(".claude").join(".credentials.json");
            if creds_path.exists() {
                return true;
            }
        }
        // Check keychain availability (without prompting)
        !CREDENTIAL_STORE_FAILED.load(Ordering::Relaxed)
    }

    pub async fn fetch_usage(&self) -> AgentUsageData {
        let token = match self.get_token().await {
            Some(t) => t,
            None => {
                debug!("No usage token available, skipping API call");
                return AgentUsageData {
                    agent_name: self.agent_name().to_string(),
                    display_name: self.display_name().to_string(),
                    windows: vec![],
                    error: None,
                    needs_auth: true,
                };
            }
        };

        // Make HTTP request to Anthropic usage API
        let client = reqwest::Client::new();
        let result = client
            .get("https://api.anthropic.com/api/oauth/usage")
            .header("Authorization", format!("Bearer {}", token))
            .header("anthropic-beta", "oauth-2025-04-20")
            .header("User-Agent", concat!("faber/v", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(10))
            .send()
            .await;

        match result {
            Ok(response) => {
                if response.status() == 401 || response.status() == 403 {
                    debug!("Usage API returned auth error, invalidating cached token");
                    // Invalidate cached token since it's rejected
                    let mut cache = self.cached_token.lock().await;
                    *cache = None;
                    return AgentUsageData {
                        agent_name: self.agent_name().to_string(),
                        display_name: self.display_name().to_string(),
                        windows: vec![],
                        error: None,
                        needs_auth: true,
                    };
                }

                if !response.status().is_success() {
                    let status = response.status();
                    return AgentUsageData {
                        agent_name: self.agent_name().to_string(),
                        display_name: self.display_name().to_string(),
                        windows: vec![],
                        error: Some(format!("API returned {}", status)),
                        needs_auth: false,
                    };
                }

                // Parse as a generic map so we handle current and future fields
                match response.json::<std::collections::HashMap<String, serde_json::Value>>().await {
                    Ok(raw) => {
                        let mut windows: Vec<(u8, UsageWindow)> = Vec::new();
                        for (key, value) in &raw {
                            // Skip null values and non-object fields
                            if value.is_null() || !value.is_object() {
                                continue;
                            }
                            let label = match window_label(key) {
                                Some(l) => l,
                                None => continue, // unknown window type
                            };
                            if let Ok(w) = serde_json::from_value::<UsageWindowResponse>(value.clone()) {
                                windows.push((
                                    window_order(key),
                                    UsageWindow {
                                        label: label.to_string(),
                                        // utilization is already 0-100 from the API
                                        utilization: w.utilization.round(),
                                        resets_at: w.resets_at,
                                    },
                                ));
                            }
                        }
                        // Sort by display order
                        windows.sort_by_key(|(order, _)| *order);

                        AgentUsageData {
                            agent_name: self.agent_name().to_string(),
                            display_name: self.display_name().to_string(),
                            windows: windows.into_iter().map(|(_, w)| w).collect(),
                            error: None,
                            needs_auth: false,
                        }
                    }
                    Err(e) => AgentUsageData {
                        agent_name: self.agent_name().to_string(),
                        display_name: self.display_name().to_string(),
                        windows: vec![],
                        error: Some(format!("Failed to parse response: {}", e)),
                        needs_auth: false,
                    },
                }
            }
            Err(e) => AgentUsageData {
                agent_name: self.agent_name().to_string(),
                display_name: self.display_name().to_string(),
                windows: vec![],
                error: Some(format!("Request failed: {}", e)),
                needs_auth: false,
            },
        }
    }
}
