use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::AppError;

// ── Types ──

/// Plugin manifest from `.claude-plugin/plugin.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: Option<PluginAuthor>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub homepage: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginAuthor {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
}

/// An installed plugin entry, parsed from `installed_plugins.json`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub name: String,
    pub marketplace: String,
    pub scope: String,
    pub version: String,
    pub install_path: String,
    pub installed_at: String,
    pub last_updated: String,
    pub git_commit_sha: String,
    pub description: String,
    pub author_name: String,
    pub category: String,
    pub keywords: Vec<String>,
    /// Inferred type: "lsp", "skill", "agent", "hook", "mcp", "command", "mixed", or "plugin".
    pub extension_type: String,
    /// Components found in the plugin directory.
    pub components: PluginComponents,
}

/// Counts of plugin sub-components.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginComponents {
    pub skills: u32,
    pub agents: u32,
    pub commands: u32,
    pub has_hooks: bool,
    pub has_mcp: bool,
    pub has_lsp: bool,
    pub has_settings: bool,
}

/// A configured marketplace source.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceInfo {
    pub name: String,
    pub source_repo: String,
    pub install_location: String,
    pub last_updated: String,
}

/// A plugin available from a marketplace catalog.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailablePlugin {
    pub name: String,
    pub marketplace: String,
    pub description: String,
    pub author_name: String,
    pub unique_installs: u64,
    pub is_installed: bool,
    pub is_blocked: bool,
    pub category: String,
    pub keywords: Vec<String>,
    /// Inferred type: "lsp", "skill", "agent", "hook", "mcp", "command", "mixed", or "plugin".
    pub extension_type: String,
    /// Components found in the marketplace catalog copy.
    pub components: PluginComponents,
}

/// Full response for the plugins overview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginsOverview {
    pub installed: Vec<InstalledPlugin>,
    pub marketplaces: Vec<MarketplaceInfo>,
    pub available: Vec<AvailablePlugin>,
    pub claude_cli_available: bool,
}

// ── JSON file schemas (deserialization) ──

#[derive(Deserialize)]
struct InstalledPluginsFile {
    #[serde(default)]
    plugins: HashMap<String, Vec<InstalledPluginEntry>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPluginEntry {
    scope: String,
    install_path: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    installed_at: String,
    #[serde(default)]
    last_updated: String,
    #[serde(default)]
    git_commit_sha: String,
}

#[derive(Deserialize)]
struct MarketplaceSource {
    #[serde(default)]
    source: String,
    #[serde(default)]
    repo: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KnownMarketplaceEntry {
    source: MarketplaceSource,
    install_location: String,
    #[serde(default)]
    last_updated: String,
}

#[derive(Deserialize)]
struct InstallCountsFile {
    #[serde(default)]
    counts: Vec<InstallCountEntry>,
}

#[derive(Deserialize)]
struct InstallCountEntry {
    plugin: String,
    unique_installs: u64,
}

#[derive(Deserialize)]
struct BlocklistFile {
    #[serde(default)]
    plugins: Vec<BlocklistEntry>,
}

#[derive(Deserialize)]
struct BlocklistEntry {
    plugin: String,
}

// ── Helpers ──

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

fn plugins_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("plugins"))
}

/// Read and parse a JSON file, returning a default on any error.
fn read_json_file<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Parse the plugin manifest from a plugin directory.
fn read_plugin_manifest(plugin_dir: &Path) -> Option<PluginManifest> {
    let manifest_path = plugin_dir.join(".claude-plugin").join("plugin.json");
    read_json_file(&manifest_path)
}

/// Scan a plugin directory for its component counts.
fn scan_plugin_components(plugin_dir: &Path) -> PluginComponents {
    let mut components = PluginComponents::default();

    // Count skill directories
    if let Ok(entries) = std::fs::read_dir(plugin_dir.join("skills")) {
        components.skills = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .count() as u32;
    }

    // Count agent directories/files
    if let Ok(entries) = std::fs::read_dir(plugin_dir.join("agents")) {
        components.agents = entries.filter_map(|e| e.ok()).count() as u32;
    }

    // Count command directories
    if let Ok(entries) = std::fs::read_dir(plugin_dir.join("commands")) {
        components.commands = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .count() as u32;
    }

    components.has_hooks = plugin_dir.join("hooks").is_dir()
        || plugin_dir.join("hooks.json").is_file();
    components.has_mcp = plugin_dir.join(".mcp.json").is_file();
    components.has_lsp = plugin_dir.join(".lsp.json").is_file();
    components.has_settings = plugin_dir.join("settings.json").is_file();

    components
}

/// Parse "plugin_name@marketplace" into (name, marketplace).
fn parse_plugin_key(key: &str) -> (String, String) {
    if let Some(at_pos) = key.rfind('@') {
        (key[..at_pos].to_string(), key[at_pos + 1..].to_string())
    } else {
        (key.to_string(), String::new())
    }
}

/// Marketplace manifest from `.claude-plugin/marketplace.json`.
#[derive(Debug, Clone, Deserialize)]
struct MarketplaceManifest {
    #[serde(default)]
    _name: String,
    #[serde(default)]
    plugins: Vec<MarketplacePluginEntry>,
}

/// A plugin entry inside a marketplace.json manifest.
#[derive(Debug, Clone, Deserialize)]
struct MarketplacePluginEntry {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    _version: String,
    #[serde(default)]
    author: Option<PluginAuthor>,
    /// Local path (e.g. "./plugins/foo") or git object for external plugins.
    #[serde(default)]
    source: Option<serde_json::Value>,
    #[serde(default)]
    category: String,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    _homepage: Option<String>,
    /// Whether this plugin declares LSP servers in the manifest.
    #[serde(default, alias = "lspServers")]
    lsp_servers: Option<serde_json::Value>,
}

/// Infer a category from the plugin name, description, and components.
/// Only used as fallback when the marketplace manifest doesn't provide one.
fn infer_category(name: &str, description: &str, components: &PluginComponents) -> String {
    let lower_name = name.to_lowercase();
    let lower_desc = description.to_lowercase();

    // LSP plugins
    if lower_name.ends_with("-lsp") || lower_name.contains("lsp") || components.has_lsp {
        return "development".to_string();
    }

    // Integration / MCP plugins (known service names)
    let integrations = [
        "github", "gitlab", "slack", "linear", "asana", "stripe", "firebase",
        "supabase", "sentry", "vercel", "notion", "jira", "monday", "figma",
        "playwright", "greptile", "posthog", "airtable", "datadog", "circleback",
        "pinecone", "context7", "coderabbit", "huggingface", "atlassian",
    ];
    for svc in integrations {
        if lower_name == svc || lower_name.starts_with(&format!("{}-", svc)) || lower_name.starts_with(&format!("{}_", svc)) {
            return "integration".to_string();
        }
    }
    if components.has_mcp || lower_desc.contains("mcp server") || lower_desc.contains("integration") {
        return "integration".to_string();
    }

    // Output style / hooks
    if lower_name.contains("output-style") || lower_name.contains("style") {
        return "productivity".to_string();
    }
    if components.has_hooks && components.skills == 0 && components.agents == 0 && components.commands == 0 {
        return "productivity".to_string();
    }

    // Dev workflow / commands
    if lower_name.contains("commit") || lower_name.contains("pr-review")
        || lower_name.contains("code-review")
        || lower_desc.contains("git workflow") || lower_desc.contains("pull request")
    {
        return "productivity".to_string();
    }

    if lower_name.contains("security") || lower_desc.contains("security") {
        return "security".to_string();
    }

    // Default: general
    "general".to_string()
}

/// Infer the extension type from its components.
/// `has_manifest_lsp` indicates whether the marketplace manifest declares `lspServers`.
fn infer_extension_type(components: &PluginComponents, has_manifest_lsp: bool) -> String {
    let mut types: Vec<&str> = Vec::new();

    if components.has_lsp || has_manifest_lsp {
        types.push("lsp");
    }
    if components.skills > 0 {
        types.push("skill");
    }
    if components.agents > 0 {
        types.push("agent");
    }
    if components.has_hooks {
        types.push("hook");
    }
    if components.has_mcp {
        types.push("mcp");
    }
    if components.commands > 0 {
        types.push("command");
    }

    match types.len() {
        0 => "plugin".to_string(),
        1 => types[0].to_string(),
        _ => "mixed".to_string(),
    }
}

/// Resolve the source field from a marketplace entry to a local directory path.
/// source can be a string like "./plugins/foo" or an object with a `path` field.
fn resolve_source_path(source: &Option<serde_json::Value>, marketplace_dir: &Path) -> Option<PathBuf> {
    let val = source.as_ref()?;
    let rel = if let Some(s) = val.as_str() {
        s.to_string()
    } else if let Some(obj) = val.as_object() {
        // External plugin objects may have a "path" field
        obj.get("path").and_then(|v| v.as_str()).map(|s| s.to_string())?
    } else {
        return None;
    };

    // Resolve relative to marketplace dir
    let path = marketplace_dir.join(rel.trim_start_matches("./"));
    if path.is_dir() {
        Some(path)
    } else {
        None
    }
}

/// Build a `Command` for the `claude` CLI, hiding the console window on Windows.
fn claude_command() -> std::process::Command {
    crate::cmd_no_window("claude")
}

// ── Commands ──

#[tauri::command]
pub fn list_plugins() -> Result<PluginsOverview, AppError> {
    let base = match plugins_dir() {
        Some(p) => p,
        None => {
            return Ok(PluginsOverview {
                installed: vec![],
                marketplaces: vec![],
                available: vec![],
                claude_cli_available: false,
            });
        }
    };

    // Check if claude CLI is available
    let claude_cli_available = crate::agent::is_command_in_path("claude");

    // 1. Parse installed plugins
    let installed_file = base.join("installed_plugins.json");
    let installed_data: Option<InstalledPluginsFile> = read_json_file(&installed_file);

    let mut installed: Vec<InstalledPlugin> = Vec::new();
    let mut installed_set: std::collections::HashSet<String> = std::collections::HashSet::new();

    if let Some(data) = &installed_data {
        for (key, entries) in &data.plugins {
            let (name, marketplace) = parse_plugin_key(key);
            installed_set.insert(key.clone());

            for entry in entries {
                // Read manifest from install path for description/author
                let install_path = PathBuf::from(&entry.install_path);
                let manifest = read_plugin_manifest(&install_path);
                let components = if install_path.is_dir() {
                    scan_plugin_components(&install_path)
                } else {
                    PluginComponents::default()
                };

                let description = manifest
                    .as_ref()
                    .map(|m| m.description.clone())
                    .unwrap_or_default();
                let author_name = manifest
                    .as_ref()
                    .and_then(|m| m.author.as_ref())
                    .map(|a| a.name.clone())
                    .unwrap_or_default();
                let keywords = manifest
                    .as_ref()
                    .map(|m| m.keywords.clone())
                    .unwrap_or_default();
                let category = infer_category(&name, &description, &components);
                let extension_type = infer_extension_type(&components, false);

                installed.push(InstalledPlugin {
                    name: name.clone(),
                    marketplace: marketplace.clone(),
                    scope: entry.scope.clone(),
                    version: entry.version.clone(),
                    install_path: entry.install_path.clone(),
                    installed_at: entry.installed_at.clone(),
                    last_updated: entry.last_updated.clone(),
                    git_commit_sha: entry.git_commit_sha.clone(),
                    description,
                    author_name,
                    category,
                    keywords,
                    extension_type,
                    components,
                });
            }
        }
    }

    installed.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // 2. Parse marketplaces
    let marketplaces_file = base.join("known_marketplaces.json");
    let marketplaces_data: Option<HashMap<String, KnownMarketplaceEntry>> =
        read_json_file(&marketplaces_file);

    let mut marketplaces: Vec<MarketplaceInfo> = Vec::new();
    if let Some(data) = &marketplaces_data {
        for (name, entry) in data {
            let source_repo = if !entry.source.repo.is_empty() {
                entry.source.repo.clone()
            } else {
                entry.source.source.clone()
            };
            marketplaces.push(MarketplaceInfo {
                name: name.clone(),
                source_repo,
                install_location: entry.install_location.clone(),
                last_updated: entry.last_updated.clone(),
            });
        }
    }
    marketplaces.sort_by(|a, b| a.name.cmp(&b.name));

    // 3. Parse install counts
    let counts_file = base.join("install-counts-cache.json");
    let counts_data: Option<InstallCountsFile> = read_json_file(&counts_file);
    let mut counts_map: HashMap<String, u64> = HashMap::new();
    if let Some(data) = &counts_data {
        for entry in &data.counts {
            counts_map.insert(entry.plugin.clone(), entry.unique_installs);
        }
    }

    // 4. Parse blocklist
    let blocklist_file = base.join("blocklist.json");
    let blocklist_data: Option<BlocklistFile> = read_json_file(&blocklist_file);
    let blocked_set: std::collections::HashSet<String> = blocklist_data
        .map(|b| b.plugins.into_iter().map(|e| e.plugin).collect())
        .unwrap_or_default();

    // 5. Scan marketplace catalogs for available plugins via marketplace.json
    let mut available: Vec<AvailablePlugin> = Vec::new();
    let marketplaces_dir = base.join("marketplaces");

    if marketplaces_dir.is_dir() {
        if let Ok(marketplace_entries) = std::fs::read_dir(&marketplaces_dir) {
            for mkt_entry in marketplace_entries.flatten() {
                let mkt_path = mkt_entry.path();
                if !mkt_path.is_dir() {
                    continue;
                }
                let marketplace_name = mkt_entry.file_name().to_string_lossy().to_string();

                // Primary: parse .claude-plugin/marketplace.json
                let manifest_path = mkt_path.join(".claude-plugin").join("marketplace.json");
                if let Some(manifest) = read_json_file::<MarketplaceManifest>(&manifest_path) {
                    tracing::info!(
                        "Marketplace '{}': parsed marketplace.json with {} plugin entries",
                        marketplace_name,
                        manifest.plugins.len()
                    );

                    for entry in &manifest.plugins {
                        let plugin_key = format!("{}@{}", entry.name, marketplace_name);

                        // Resolve source path for component scanning
                        let source_dir = resolve_source_path(&entry.source, &mkt_path);
                        let components = source_dir
                            .as_ref()
                            .map(|d| scan_plugin_components(d))
                            .unwrap_or_default();

                        // Also try to read plugin.json from the source dir for extra metadata
                        let plugin_manifest = source_dir
                            .as_ref()
                            .and_then(|d| read_plugin_manifest(d));

                        // Prefer marketplace.json fields, fall back to plugin.json
                        let description = if !entry.description.is_empty() {
                            entry.description.clone()
                        } else {
                            plugin_manifest.as_ref().map(|m| m.description.clone()).unwrap_or_default()
                        };

                        let author_name = entry.author.as_ref()
                            .map(|a| a.name.clone())
                            .or_else(|| plugin_manifest.as_ref().and_then(|m| m.author.as_ref()).map(|a| a.name.clone()))
                            .unwrap_or_default();

                        // Merge keywords from marketplace entry + plugin manifest
                        let mut keywords = entry.keywords.clone();
                        keywords.extend(entry.tags.clone());
                        if let Some(ref pm) = plugin_manifest {
                            for kw in &pm.keywords {
                                if !keywords.contains(kw) {
                                    keywords.push(kw.clone());
                                }
                            }
                        }

                        // Category: prefer marketplace.json, then infer
                        let category = if !entry.category.is_empty() {
                            entry.category.clone()
                        } else {
                            infer_category(&entry.name, &description, &components)
                        };

                        let has_manifest_lsp = entry.lsp_servers.as_ref()
                            .map(|v| v.is_array() || v.is_object())
                            .unwrap_or(false);
                        let extension_type = infer_extension_type(&components, has_manifest_lsp);

                        let unique_installs = counts_map.get(&plugin_key).copied().unwrap_or(0);
                        let is_installed = installed_set.contains(&plugin_key);
                        let is_blocked = blocked_set.contains(&plugin_key);

                        available.push(AvailablePlugin {
                            name: entry.name.clone(),
                            marketplace: marketplace_name.clone(),
                            description,
                            author_name,
                            unique_installs,
                            is_installed,
                            is_blocked,
                            category,
                            keywords,
                            extension_type,
                            components,
                        });
                    }
                } else {
                    tracing::warn!(
                        "Marketplace '{}': no marketplace.json found at {}, falling back to directory scan",
                        marketplace_name,
                        manifest_path.display()
                    );

                    // Fallback: scan plugins/ and external_plugins/ directories
                    for subdir in &["plugins", "external_plugins"] {
                        let plugins_dir = mkt_path.join(subdir);
                        if !plugins_dir.is_dir() {
                            continue;
                        }

                        if let Ok(plugin_entries) = std::fs::read_dir(&plugins_dir) {
                            for plugin_entry in plugin_entries.flatten() {
                                let plugin_path = plugin_entry.path();
                                if !plugin_path.is_dir() {
                                    continue;
                                }

                                let plugin_name =
                                    plugin_entry.file_name().to_string_lossy().to_string();
                                let plugin_key =
                                    format!("{}@{}", plugin_name, marketplace_name);

                                let pm = read_plugin_manifest(&plugin_path);
                                let components = scan_plugin_components(&plugin_path);

                                let description = pm.as_ref().map(|m| m.description.clone()).unwrap_or_default();
                                let author_name = pm.as_ref().and_then(|m| m.author.as_ref()).map(|a| a.name.clone()).unwrap_or_default();
                                let keywords = pm.as_ref().map(|m| m.keywords.clone()).unwrap_or_default();
                                let category = infer_category(&plugin_name, &description, &components);
                                let extension_type = infer_extension_type(&components, false);

                                let unique_installs = counts_map.get(&plugin_key).copied().unwrap_or(0);
                                let is_installed = installed_set.contains(&plugin_key);
                                let is_blocked = blocked_set.contains(&plugin_key);

                                available.push(AvailablePlugin {
                                    name: plugin_name,
                                    marketplace: marketplace_name.clone(),
                                    description,
                                    author_name,
                                    unique_installs,
                                    is_installed,
                                    is_blocked,
                                    category,
                                    keywords,
                                    extension_type,
                                    components,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    tracing::info!(
        "Plugins overview: {} installed, {} available, {} marketplaces",
        installed.len(),
        available.len(),
        marketplaces.len()
    );

    // Sort available by install count (descending), then name
    available.sort_by(|a, b| {
        b.unique_installs
            .cmp(&a.unique_installs)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(PluginsOverview {
        installed,
        marketplaces,
        available,
        claude_cli_available,
    })
}

#[tauri::command]
pub fn get_plugin_readme(marketplace: String, plugin_name: String) -> Result<String, AppError> {
    let base = plugins_dir()
        .ok_or_else(|| AppError::Validation("Cannot determine home directory".into()))?;

    let mkt_dir = base.join("marketplaces").join(&marketplace);

    // Strategy 1: Resolve source path from marketplace.json
    let manifest_path = mkt_dir.join(".claude-plugin").join("marketplace.json");
    if let Some(manifest) = read_json_file::<MarketplaceManifest>(&manifest_path) {
        if let Some(entry) = manifest.plugins.iter().find(|p| p.name == plugin_name) {
            if let Some(source_dir) = resolve_source_path(&entry.source, &mkt_dir) {
                let readme_path = source_dir.join("README.md");
                if readme_path.is_file() {
                    let metadata = std::fs::metadata(&readme_path)?;
                    if metadata.len() > 2_097_152 {
                        return Err(AppError::Validation("File exceeds 2MB size limit".into()));
                    }
                    return Ok(std::fs::read_to_string(&readme_path)?);
                }
            }
        }
    }

    // Strategy 2: Check well-known subdirectories
    for subdir in &["plugins", "external_plugins"] {
        let readme_path = mkt_dir
            .join(subdir)
            .join(&plugin_name)
            .join("README.md");

        if readme_path.is_file() {
            let metadata = std::fs::metadata(&readme_path)?;
            if metadata.len() > 2_097_152 {
                return Err(AppError::Validation("File exceeds 2MB size limit".into()));
            }
            return Ok(std::fs::read_to_string(&readme_path)?);
        }
    }

    Err(AppError::NotFound(format!(
        "No README.md found for plugin {} in marketplace {}",
        plugin_name, marketplace
    )))
}

#[tauri::command]
pub async fn install_plugin(
    plugin_name: String,
    scope: String,
) -> Result<String, AppError> {
    tracing::info!("Installing plugin '{}' with scope '{}'", plugin_name, scope);

    let mut cmd = claude_command();
    cmd.args(["plugin", "install", &plugin_name, "--scope", &scope]);

    let output = cmd.output().map_err(|e| {
        tracing::error!("Failed to spawn claude process: {e}");
        AppError::Io(format!(
            "Failed to run claude plugin install: {e}. Is Claude Code CLI installed?"
        ))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    tracing::info!(
        "claude plugin install exited status={}, stdout={}, stderr={}",
        output.status,
        stdout.trim(),
        stderr.trim()
    );

    if !output.status.success() {
        let err_msg = if stderr.is_empty() { &stdout } else { &stderr };
        return Err(AppError::Io(format!("Plugin install failed: {}", err_msg)));
    }

    Ok(stdout)
}

#[tauri::command]
pub async fn uninstall_plugin(
    plugin_name: String,
    scope: String,
) -> Result<String, AppError> {
    tracing::info!(
        "Uninstalling plugin '{}' from scope '{}'",
        plugin_name,
        scope
    );

    let mut cmd = claude_command();
    cmd.args(["plugin", "uninstall", &plugin_name, "--scope", &scope]);

    let output = cmd.output().map_err(|e| {
        AppError::Io(format!("Failed to run claude plugin uninstall: {e}"))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let err_msg = if stderr.is_empty() { &stdout } else { &stderr };
        return Err(AppError::Io(format!(
            "Plugin uninstall failed: {}",
            err_msg
        )));
    }

    Ok(stdout)
}

#[tauri::command]
pub async fn toggle_plugin(
    plugin_name: String,
    enable: bool,
    scope: String,
) -> Result<String, AppError> {
    let action = if enable { "enable" } else { "disable" };
    tracing::info!("{}ing plugin '{}' (scope={})", action, plugin_name, scope);

    let mut cmd = claude_command();
    cmd.args(["plugin", action, &plugin_name, "--scope", &scope]);

    let output = cmd.output().map_err(|e| {
        AppError::Io(format!("Failed to run claude plugin {action}: {e}"))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let err_msg = if stderr.is_empty() { &stdout } else { &stderr };
        return Err(AppError::Io(format!(
            "Plugin {action} failed: {}",
            err_msg
        )));
    }

    Ok(stdout)
}

#[tauri::command]
pub async fn update_plugin(
    plugin_name: String,
    scope: String,
) -> Result<String, AppError> {
    tracing::info!("Updating plugin '{}' (scope={})", plugin_name, scope);

    let mut cmd = claude_command();
    cmd.args(["plugin", "update", &plugin_name, "--scope", &scope]);

    let output = cmd.output().map_err(|e| {
        AppError::Io(format!("Failed to run claude plugin update: {e}"))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let err_msg = if stderr.is_empty() { &stdout } else { &stderr };
        return Err(AppError::Io(format!(
            "Plugin update failed: {}",
            err_msg
        )));
    }

    Ok(stdout)
}

#[tauri::command]
pub async fn add_marketplace(source: String, scope: String) -> Result<String, AppError> {
    tracing::info!("Adding marketplace '{}' (scope={})", source, scope);

    let mut cmd = claude_command();
    cmd.args(["plugin", "marketplace", "add", &source, "--scope", &scope]);

    let output = cmd.output().map_err(|e| {
        AppError::Io(format!("Failed to run claude plugin marketplace add: {e}"))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let err_msg = if stderr.is_empty() { &stdout } else { &stderr };
        return Err(AppError::Io(format!(
            "Marketplace add failed: {}",
            err_msg
        )));
    }

    Ok(stdout)
}

#[tauri::command]
pub async fn remove_marketplace(name: String) -> Result<String, AppError> {
    tracing::info!("Removing marketplace '{}'", name);

    let mut cmd = claude_command();
    cmd.args(["plugin", "marketplace", "remove", &name]);

    let output = cmd.output().map_err(|e| {
        AppError::Io(format!(
            "Failed to run claude plugin marketplace remove: {e}"
        ))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let err_msg = if stderr.is_empty() { &stdout } else { &stderr };
        return Err(AppError::Io(format!(
            "Marketplace remove failed: {}",
            err_msg
        )));
    }

    Ok(stdout)
}

#[tauri::command]
pub async fn update_marketplaces() -> Result<String, AppError> {
    tracing::info!("Updating all marketplaces");

    let mut cmd = claude_command();
    cmd.args(["plugin", "marketplace", "update"]);

    let output = cmd.output().map_err(|e| {
        AppError::Io(format!(
            "Failed to run claude plugin marketplace update: {e}"
        ))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let err_msg = if stderr.is_empty() { &stdout } else { &stderr };
        return Err(AppError::Io(format!(
            "Marketplace update failed: {}",
            err_msg
        )));
    }

    Ok(stdout)
}
