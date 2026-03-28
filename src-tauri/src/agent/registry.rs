//! ACP Registry client — fetches the public agent registry and filters
//! to agents that Faber has built-in adapters for.
//!
//! Registry URL: https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::builtin_adapters;

// ── Installed npm package versions cache ──

/// Cache for globally installed npm package versions.
/// Populated once per `fetch_registry` call by shelling out to `npm list -g --json`.
struct NpmVersionCache {
    versions: HashMap<String, String>,
    fetched_at: Instant,
}

static NPM_VERSION_CACHE: Mutex<Option<NpmVersionCache>> = Mutex::new(None);

/// TTL for the npm version cache — same as registry cache (1 hour).
const NPM_CACHE_TTL: Duration = Duration::from_secs(3600);

/// Shell out to `npm list -g --json --depth=0` and parse installed package versions.
/// Returns a map of package name → version string.
fn get_global_npm_versions() -> HashMap<String, String> {
    // Check cache first
    if let Ok(guard) = NPM_VERSION_CACHE.lock() {
        if let Some(ref entry) = *guard {
            if entry.fetched_at.elapsed() < NPM_CACHE_TTL {
                tracing::debug!(
                    age_secs = entry.fetched_at.elapsed().as_secs(),
                    count = entry.versions.len(),
                    "npm version cache hit"
                );
                return entry.versions.clone();
            }
        }
    }

    tracing::debug!("npm version cache miss — querying npm list -g");

    let mut versions = HashMap::new();

    let npm_cmd = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let output = crate::cmd_no_window(npm_cmd)
        .args(["list", "-g", "--json", "--depth=0"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    match output {
        Ok(ref result) if result.status.success() => {
            match serde_json::from_slice::<serde_json::Value>(&result.stdout) {
                Ok(json) => {
                    if let Some(deps) = json.get("dependencies").and_then(|d| d.as_object()) {
                        for (pkg_name, pkg_info) in deps {
                            if let Some(ver) = pkg_info.get("version").and_then(|v| v.as_str()) {
                                versions.insert(pkg_name.clone(), ver.to_string());
                            }
                        }
                    }
                    tracing::debug!(count = versions.len(), "Parsed global npm packages");
                }
                Err(e) => {
                    tracing::warn!(%e, "Failed to parse npm list JSON output");
                }
            }
        }
        Ok(ref result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            tracing::warn!(
                exit_code = ?result.status.code(),
                stderr = %stderr.trim(),
                "npm list -g exited with non-zero status"
            );
            // npm list returns exit code 1 when there are peer dep warnings
            // but still outputs valid JSON — try parsing anyway
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&result.stdout) {
                if let Some(deps) = json.get("dependencies").and_then(|d| d.as_object()) {
                    for (pkg_name, pkg_info) in deps {
                        if let Some(ver) = pkg_info.get("version").and_then(|v| v.as_str()) {
                            versions.insert(pkg_name.clone(), ver.to_string());
                        }
                    }
                }
                tracing::debug!(
                    count = versions.len(),
                    "Parsed global npm packages from non-zero exit output"
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                error = %e,
                command = %npm_cmd,
                "Failed to run npm list -g — npm may not be installed"
            );
        }
    }

    // Update cache
    if let Ok(mut guard) = NPM_VERSION_CACHE.lock() {
        *guard = Some(NpmVersionCache {
            versions: versions.clone(),
            fetched_at: Instant::now(),
        });
    }

    versions
}

/// Compare an installed version against a registry version using semver.
/// Returns `true` if the registry version is strictly newer.
fn is_update_available(installed_version: &str, registry_version: &str) -> bool {
    // Try parsing as semver
    match (
        semver::Version::parse(installed_version),
        semver::Version::parse(registry_version),
    ) {
        (Ok(installed), Ok(registry)) => {
            let has_update = registry > installed;
            tracing::debug!(
                %installed_version,
                %registry_version,
                has_update,
                "Semver version comparison"
            );
            has_update
        }
        (installed_result, registry_result) => {
            // Log parse failures for diagnostics
            if let Err(ref e) = installed_result {
                tracing::debug!(
                    version = %installed_version,
                    error = %e,
                    "Failed to parse installed version as semver"
                );
            }
            if let Err(ref e) = registry_result {
                tracing::debug!(
                    version = %registry_version,
                    error = %e,
                    "Failed to parse registry version as semver"
                );
            }
            // Fallback: simple string comparison — only flag if they differ
            let has_update = installed_version != registry_version;
            tracing::debug!(
                %installed_version,
                %registry_version,
                has_update,
                "Fallback string version comparison"
            );
            has_update
        }
    }
}

// ── Constants ──

const REGISTRY_URL: &str =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/// Cache TTL — 1 hour.
const CACHE_TTL: Duration = Duration::from_secs(3600);

/// HTTP request timeout.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

// ── Registry JSON types (deserialization) ──

/// Top-level registry response.
#[derive(Debug, Deserialize)]
struct RegistryResponse {
    #[allow(dead_code)]
    version: String,
    agents: Vec<RegistryAgent>,
}

/// A single agent entry from the registry.
#[derive(Debug, Clone, Deserialize)]
struct RegistryAgent {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    authors: Vec<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    distribution: Option<RegistryDistribution>,
}

/// Distribution methods available for an agent.
#[derive(Debug, Clone, Deserialize)]
struct RegistryDistribution {
    #[serde(default)]
    npx: Option<NpxDistribution>,
    #[serde(default)]
    #[allow(dead_code)]
    binary: Option<HashMap<String, BinaryPlatform>>,
    #[serde(default)]
    uvx: Option<UvxDistribution>,
}

#[derive(Debug, Clone, Deserialize)]
struct NpxDistribution {
    package: String,
    #[serde(default)]
    #[allow(dead_code)]
    args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct BinaryPlatform {
    archive: String,
    cmd: String,
    #[serde(default)]
    args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
struct UvxDistribution {
    package: String,
}

// ── Output types (serialized to frontend) ──

/// Enriched registry entry sent to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AcpRegistryInfo {
    /// Registry agent ID (e.g. "claude-acp").
    pub registry_id: String,
    /// Faber's internal agent name (e.g. "claude-code").
    pub faber_agent_name: String,
    /// Display name from the registry.
    pub name: String,
    /// Version from the registry.
    pub registry_version: String,
    /// Description from the registry.
    pub description: String,
    /// Repository URL.
    pub repository: Option<String>,
    /// Authors list.
    pub authors: Vec<String>,
    /// License string.
    pub license: Option<String>,
    /// Icon URL from the CDN.
    pub icon_url: Option<String>,
    /// Whether the agent CLI is installed locally.
    pub cli_installed: bool,
    /// Whether the ACP adapter is installed locally.
    pub adapter_installed: bool,
    /// The locally installed adapter package name (if any).
    pub local_adapter_package: Option<String>,
    /// The locally installed adapter version (if detected via npm).
    pub installed_version: Option<String>,
    /// Whether an update is available (registry version > local adapter package version).
    pub update_available: bool,
    /// Install command from the registry distribution (npx preferred).
    pub install_command: Option<String>,
}

// ── Cache ──

struct CacheEntry {
    data: Vec<AcpRegistryInfo>,
    fetched_at: Instant,
}

static REGISTRY_CACHE: Mutex<Option<CacheEntry>> = Mutex::new(None);

// ── Mapping ──

/// Maps Faber's internal agent name to the ACP registry ID.
/// Only agents listed here will be shown from the registry.
fn faber_to_registry_id() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("claude-code", "claude-acp"),
        ("codex", "codex-acp"),
        ("gemini", "gemini"),
        ("copilot", "github-copilot-cli"),
        ("cursor-agent", "cursor"),
        ("opencode", "opencode"),
    ])
}

/// Reverse mapping: registry ID → Faber agent name.
fn registry_id_to_faber() -> HashMap<&'static str, &'static str> {
    faber_to_registry_id()
        .into_iter()
        .map(|(faber, reg)| (reg, faber))
        .collect()
}

// ── Public API ──

/// Invalidate the npm version cache so the next `fetch_registry` call re-queries
/// globally installed packages.  Called after an adapter install/update.
pub fn invalidate_npm_cache() {
    if let Ok(mut guard) = NPM_VERSION_CACHE.lock() {
        *guard = None;
        tracing::debug!("NPM version cache invalidated");
    }
}

/// Invalidate the registry cache so the next `fetch_registry` call re-fetches
/// from the CDN and re-checks installed versions.
pub fn invalidate_registry_cache() {
    if let Ok(mut guard) = REGISTRY_CACHE.lock() {
        *guard = None;
        tracing::debug!("ACP registry cache invalidated");
    }
}

/// Fetch the ACP registry, filter to Faber-supported agents, and enrich
/// with local installation status. Uses a 1-hour in-memory cache.
pub async fn fetch_registry(force_refresh: bool) -> Result<Vec<AcpRegistryInfo>, String> {
    // Check cache first (unless force refresh)
    if !force_refresh {
        if let Ok(guard) = REGISTRY_CACHE.lock() {
            if let Some(ref entry) = *guard {
                if entry.fetched_at.elapsed() < CACHE_TTL {
                    tracing::debug!("ACP registry: returning cached data");
                    return Ok(entry.data.clone());
                }
            }
        }
    }

    // Fetch from CDN
    tracing::info!("ACP registry: fetching from {}", REGISTRY_URL);
    let client = reqwest::Client::new();
    let response = client
        .get(REGISTRY_URL)
        .timeout(REQUEST_TIMEOUT)
        .header("User-Agent", concat!("faber/v", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch ACP registry: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "ACP registry returned HTTP {}",
            response.status()
        ));
    }

    let registry: RegistryResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse ACP registry JSON: {e}"))?;

    tracing::info!(
        agents = registry.agents.len(),
        version = %registry.version,
        "ACP registry fetched"
    );

    // Build reverse mapping & get local agent info
    let id_to_faber = registry_id_to_faber();
    let local_agents = builtin_adapters();

    let mut results: Vec<AcpRegistryInfo> = Vec::new();

    for agent in &registry.agents {
        // Only include agents that Faber has adapters for
        let faber_name = match id_to_faber.get(agent.id.as_str()) {
            Some(name) => *name,
            None => continue,
        };

        // Find the local adapter info
        let local = local_agents.iter().find(|a| a.name() == faber_name);

        let cli_installed = local.map(|a| a.detect_installation()).unwrap_or(false);
        let adapter_installed = local.map(|a| a.detect_acp_adapter()).unwrap_or(false);
        let local_adapter_package = local.and_then(|a| a.acp_adapter_package().map(String::from));

        // Determine install command from registry distribution
        let install_command = agent.distribution.as_ref().and_then(|d| {
            if let Some(ref npx) = d.npx {
                Some(format!("npx {}", npx.package))
            } else {
                d.uvx.as_ref().map(|uvx| format!("uvx {}", uvx.package))
            }
        });

        // Version comparison: check if registry has a newer version than what's installed locally.
        // Uses `npm list -g --json` to get actual installed adapter versions.
        let (installed_version, update_available) = if adapter_installed {
            if let Some(ref local_pkg) = local_adapter_package {
                let npm_versions = get_global_npm_versions();
                if let Some(installed_ver) = npm_versions.get(local_pkg.as_str()) {
                    let has_update = is_update_available(installed_ver, &agent.version);
                    tracing::info!(
                        agent = %faber_name,
                        package = %local_pkg,
                        installed = %installed_ver,
                        registry = %agent.version,
                        update_available = has_update,
                        "Version check for ACP adapter"
                    );
                    (Some(installed_ver.clone()), has_update)
                } else {
                    // Package is installed (detected by file existence) but npm doesn't report it.
                    // Don't flag as update available — could be a non-npm install method.
                    tracing::info!(
                        agent = %faber_name,
                        package = %local_pkg,
                        registry = %agent.version,
                        "ACP adapter detected but not found in npm list — skipping version check"
                    );
                    (None, false)
                }
            } else {
                (None, false)
            }
        } else {
            (None, false)
        };

        results.push(AcpRegistryInfo {
            registry_id: agent.id.clone(),
            faber_agent_name: faber_name.to_string(),
            name: agent.name.clone(),
            registry_version: agent.version.clone(),
            description: agent.description.clone(),
            repository: agent.repository.clone(),
            authors: agent.authors.clone(),
            license: agent.license.clone(),
            icon_url: agent.icon.clone(),
            cli_installed,
            adapter_installed,
            local_adapter_package,
            installed_version,
            update_available,
            install_command,
        });
    }

    // Sort: installed first, then by name
    results.sort_by(|a, b| {
        b.cli_installed
            .cmp(&a.cli_installed)
            .then_with(|| a.name.cmp(&b.name))
    });

    tracing::info!(
        matched = results.len(),
        "ACP registry: filtered to Faber-supported agents"
    );

    // Update cache
    if let Ok(mut guard) = REGISTRY_CACHE.lock() {
        *guard = Some(CacheEntry {
            data: results.clone(),
            fetched_at: Instant::now(),
        });
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapping_covers_all_builtin_agents() {
        let mapping = faber_to_registry_id();
        let adapters = builtin_adapters();
        for adapter in &adapters {
            assert!(
                mapping.contains_key(adapter.name()),
                "Missing registry mapping for agent: {}",
                adapter.name()
            );
        }
    }

    #[test]
    fn version_comparison_works() {
        // Newer registry version → update available
        assert!(is_update_available("1.0.0", "1.1.0"));
        assert!(is_update_available("0.9.0", "1.0.0"));
        assert!(is_update_available("1.0.0", "1.0.1"));

        // Same version → no update
        assert!(!is_update_available("1.0.0", "1.0.0"));

        // Older registry version → no update
        assert!(!is_update_available("2.0.0", "1.0.0"));
    }

    #[test]
    fn mapping_is_bidirectional() {
        let forward = faber_to_registry_id();
        let reverse = registry_id_to_faber();
        assert_eq!(forward.len(), reverse.len());
        for (faber, reg) in &forward {
            assert_eq!(reverse.get(reg as &str), Some(faber));
        }
    }
}
