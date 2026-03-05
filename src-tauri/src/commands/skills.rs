use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

use crate::agent;
use crate::cmd_no_window;
use crate::db;
use crate::db::DbState;
use crate::error::AppError;

// ── Types ──

#[derive(Debug, Clone, Serialize)]
pub struct InstructionFileInfo {
    pub agent_name: String,
    pub filename: String,
    pub path: Option<String>,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleFileInfo {
    pub agent_name: String,
    pub display_name: String,
    pub path: Option<String>,
    pub relative_path: String,
    pub exists: bool,
    pub scope: String,
    pub category: String,
    pub deprecated: bool,
    pub deprecation_hint: Option<String>,
    pub frontmatter: Option<RuleFrontmatter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleFrontmatter {
    pub description: Option<String>,
    pub globs: Option<Vec<String>>,
    pub always_apply: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuleGroup {
    pub agent_name: String,
    pub display_name: String,
    pub installed: bool,
    pub project_rules: Vec<RuleFileInfo>,
    pub global_rules: Vec<RuleFileInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub path: String,
    pub description: String,
    pub is_global: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstalledSkillsResponse {
    pub project_skills: Vec<SkillInfo>,
    pub global_skills: Vec<SkillInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSearchResult {
    pub id: String,
    pub skill_id: String,
    pub name: String,
    #[serde(default)]
    pub installs: i64,
    #[serde(default)]
    pub source: String,
}

// ── Known instruction files per agent ──

const INSTRUCTION_FILES: &[(&str, &str)] = &[
    ("Claude", "CLAUDE.md"),
    ("Claude", "AGENTS.md"),
    ("Gemini", "GEMINI.md"),
    ("Cursor", ".cursorrules"),
    ("Codex", "AGENTS.md"),
    ("Copilot", ".github/copilot-instructions.md"),
];

/// Definition of a known rule file for an agent.
struct RuleDef {
    agent_name: &'static str,
    relative_path: &'static str,
    scope: &'static str,
    category: &'static str,
    deprecated: bool,
    deprecation_hint: Option<&'static str>,
    /// If true, this is a directory to scan recursively instead of a single file.
    is_directory: bool,
    /// Glob extensions to match when scanning a directory (e.g. &["md", "mdc"]).
    extensions: &'static [&'static str],
}

/// All known rule file definitions per agent.
///
/// Sources:
/// - Claude Code: https://code.claude.com/docs/en/memory
/// - Cursor: https://cursor.com/docs/context/rules
/// - Codex CLI: https://github.com/openai/codex/blob/main/docs/agents_md.md
/// - Gemini CLI: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md
/// - OpenCode: https://github.com/anomalyco/opencode — rules.mdx
const RULE_DEFS: &[RuleDef] = &[
    // ── Claude Code: project ──
    // Reads: CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, .claude/rules/**/*.md (with paths frontmatter)
    RuleDef { agent_name: "claude-code", relative_path: "CLAUDE.md", scope: "project", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    RuleDef { agent_name: "claude-code", relative_path: ".claude/CLAUDE.md", scope: "project", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    RuleDef { agent_name: "claude-code", relative_path: "CLAUDE.local.md", scope: "project", category: "local", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    RuleDef { agent_name: "claude-code", relative_path: ".claude/rules", scope: "project", category: "nested", deprecated: false, deprecation_hint: None, is_directory: true, extensions: &["md"] },
    // ── Claude Code: global ──
    // Reads: ~/.claude/CLAUDE.md, ~/.claude/rules/*.md
    RuleDef { agent_name: "claude-code", relative_path: ".claude/CLAUDE.md", scope: "global", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    RuleDef { agent_name: "claude-code", relative_path: ".claude/rules", scope: "global", category: "nested", deprecated: false, deprecation_hint: None, is_directory: true, extensions: &["md"] },
    // ── Cursor: project ──
    // Reads: .cursorrules (deprecated), .cursor/rules/**/*.{md,mdc}, AGENTS.md (+ nested subdirs)
    RuleDef { agent_name: "cursor-agent", relative_path: ".cursorrules", scope: "project", category: "primary", deprecated: true, deprecation_hint: Some("Migrate to .cursor/rules/"), is_directory: false, extensions: &[] },
    RuleDef { agent_name: "cursor-agent", relative_path: "AGENTS.md", scope: "project", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    RuleDef { agent_name: "cursor-agent", relative_path: ".cursor/rules", scope: "project", category: "nested", deprecated: false, deprecation_hint: None, is_directory: true, extensions: &["md", "mdc"] },
    // ── Codex CLI: project ──
    // Reads: AGENTS.md, AGENTS.override.md (searched up from cwd to repo root)
    RuleDef { agent_name: "codex", relative_path: "AGENTS.md", scope: "project", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    RuleDef { agent_name: "codex", relative_path: "AGENTS.override.md", scope: "project", category: "override", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    // ── Codex CLI: global ──
    // Reads: ~/.codex/AGENTS.md, ~/.codex/AGENTS.override.md
    RuleDef { agent_name: "codex", relative_path: ".codex/AGENTS.md", scope: "global", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    RuleDef { agent_name: "codex", relative_path: ".codex/AGENTS.override.md", scope: "global", category: "override", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    // ── Gemini CLI: project ──
    // Reads: GEMINI.md by default, AGENTS.md configurable via settings.json context.fileName
    RuleDef { agent_name: "gemini", relative_path: "GEMINI.md", scope: "project", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    RuleDef { agent_name: "gemini", relative_path: "AGENTS.md", scope: "project", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    // ── Gemini CLI: global ──
    // Reads: ~/.gemini/GEMINI.md
    RuleDef { agent_name: "gemini", relative_path: ".gemini/GEMINI.md", scope: "global", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    // ── OpenCode: project ──
    // Reads: AGENTS.md (primary), CLAUDE.md (fallback if no AGENTS.md)
    RuleDef { agent_name: "opencode", relative_path: "AGENTS.md", scope: "project", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    RuleDef { agent_name: "opencode", relative_path: "CLAUDE.md", scope: "project", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
    // ── OpenCode: global ──
    // Reads: ~/.config/opencode/AGENTS.md, ~/.claude/CLAUDE.md (compat, unless disabled)
    RuleDef { agent_name: "opencode", relative_path: ".config/opencode/AGENTS.md", scope: "global", category: "primary", deprecated: false, deprecation_hint: None, is_directory: false, extensions: &[] },
];

/// Known global rule directories for path validation.
const KNOWN_GLOBAL_RULE_DIRS: &[&str] = &[
    ".claude",
    ".codex",
    ".gemini",
    ".config/opencode",
];

// ── Helpers ──

/// Cross-platform home directory without external crate.
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

/// Simple percent-encoding for URL query parameters.
fn url_encode(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b' ' => encoded.push_str("%20"),
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

/// Build a `Command` for an npm script (npx, npm, etc.) that may be a `.cmd`
/// shim on Windows. On Windows this routes through `cmd.exe /c` so that batch
/// scripts are resolved correctly; on other platforms it calls the program
/// directly.
fn npx_command(args: &[&str]) -> std::process::Command {
    #[cfg(windows)]
    {
        let mut cmd = cmd_no_window("cmd.exe");
        // /d = skip AutoRun, /c = execute and terminate
        cmd.arg("/d").arg("/c").arg("npx");
        cmd.args(args);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = cmd_no_window("npx");
        cmd.args(args);
        cmd
    }
}

fn get_project_path(conn: &rusqlite::Connection, project_id: &str) -> Result<PathBuf, AppError> {
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
    Ok(PathBuf::from(project.path))
}

/// Ensure a path is within the project root (security).
fn validate_within_project(path: &Path, project_root: &Path) -> Result<(), AppError> {
    // Normalize paths for comparison
    let canonical_root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());

    let canonical_path = if path.exists() {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    } else {
        // For files that don't exist yet, check parent
        let parent = path.parent().unwrap_or(path);
        let canonical_parent = parent
            .canonicalize()
            .unwrap_or_else(|_| parent.to_path_buf());
        canonical_parent.join(path.file_name().unwrap_or_default())
    };

    if !canonical_path.starts_with(&canonical_root) {
        return Err(AppError::Validation(
            "Path is outside project root".to_string(),
        ));
    }
    Ok(())
}

/// Parse a SKILL.md file's frontmatter for name and description.
fn parse_skill_frontmatter(content: &str) -> (String, String) {
    let mut name = String::new();
    let mut description = String::new();

    if let Some(stripped) = content.strip_prefix("---") {
        if let Some(end) = stripped.find("---") {
            let frontmatter = &stripped[..end];
            for line in frontmatter.lines() {
                let line = line.trim();
                if let Some(val) = line.strip_prefix("name:") {
                    name = val.trim().trim_matches('"').trim_matches('\'').to_string();
                } else if let Some(val) = line.strip_prefix("description:") {
                    description = val.trim().trim_matches('"').trim_matches('\'').to_string();
                }
            }
        }
    }

    // Fallback: use first heading as name
    if name.is_empty() {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(heading) = trimmed.strip_prefix("# ") {
                name = heading.to_string();
                break;
            }
        }
    }

    (name, description)
}

/// Scan a skills directory and return SkillInfo entries.
fn scan_skills_dir(dir: &Path, is_global: bool) -> Vec<SkillInfo> {
    let mut skills = Vec::new();

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            tracing::debug!(
                "Skills dir not found or unreadable: {} ({})",
                dir.display(),
                e
            );
            return skills;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Look for SKILL.md inside the skill directory
        let skill_md = path.join("SKILL.md");
        let (name, description) = if skill_md.is_file() {
            match std::fs::read_to_string(&skill_md) {
                Ok(content) => parse_skill_frontmatter(&content),
                Err(_) => (String::new(), String::new()),
            }
        } else {
            (String::new(), String::new())
        };

        let dir_name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        skills.push(SkillInfo {
            name: if name.is_empty() {
                dir_name
            } else {
                name
            },
            path: crate::git::strip_unc_prefix(&path.to_string_lossy()).into_owned(),
            description,
            is_global,
        });
    }

    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    skills
}

/// Parse YAML frontmatter from a rule file for metadata (description, globs, alwaysApply).
fn parse_rule_frontmatter(content: &str) -> Option<RuleFrontmatter> {
    let stripped = content.strip_prefix("---")?;
    let end = stripped.find("---")?;
    let frontmatter = &stripped[..end];

    let mut description = None;
    let mut globs: Option<Vec<String>> = None;
    let mut always_apply = None;
    let mut in_globs = false;

    for line in frontmatter.lines() {
        let trimmed = line.trim();

        // Detect list continuation for globs
        if in_globs {
            if let Some(val) = trimmed.strip_prefix("- ") {
                if let Some(g) = globs.as_mut() {
                    g.push(val.trim().trim_matches('"').trim_matches('\'').to_string());
                }
                continue;
            } else {
                in_globs = false;
            }
        }

        if let Some(val) = trimmed.strip_prefix("description:") {
            let val = val.trim().trim_matches('"').trim_matches('\'');
            if !val.is_empty() {
                description = Some(val.to_string());
            }
        } else if let Some(val) = trimmed.strip_prefix("globs:") {
            let val = val.trim();
            if val.is_empty() {
                // YAML list follows
                globs = Some(Vec::new());
                in_globs = true;
            } else {
                // Inline value
                globs = Some(vec![val.trim_matches('"').trim_matches('\'').to_string()]);
            }
        } else if let Some(val) = trimmed.strip_prefix("alwaysApply:") {
            let val = val.trim();
            always_apply = Some(val == "true");
        }
    }

    if description.is_none() && globs.is_none() && always_apply.is_none() {
        return None;
    }

    Some(RuleFrontmatter {
        description,
        globs,
        always_apply,
    })
}

/// Recursively scan a directory for rule files with the given extensions.
fn scan_rule_directory(
    dir: &Path,
    extensions: &[&str],
    agent_name: &str,
    scope: &str,
    base_for_display: &Path,
) -> Vec<RuleFileInfo> {
    let mut results = Vec::new();

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return results,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Recurse into subdirectories
            results.extend(scan_rule_directory(&path, extensions, agent_name, scope, base_for_display));
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if extensions.iter().any(|&e| e.eq_ignore_ascii_case(ext)) {
                let rel = path.strip_prefix(base_for_display).unwrap_or(&path);
                let relative_path = if scope == "global" {
                    format!("~/{}", rel.to_string_lossy().replace('\\', "/"))
                } else {
                    rel.to_string_lossy().replace('\\', "/").to_string()
                };
                let display_name = path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                // Try to parse frontmatter
                let frontmatter = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|content| parse_rule_frontmatter(&content));

                results.push(RuleFileInfo {
                    agent_name: agent_name.to_string(),
                    display_name,
                    path: Some(crate::git::strip_unc_prefix(&path.to_string_lossy()).into_owned()),
                    relative_path,
                    exists: true,
                    scope: scope.to_string(),
                    category: "nested".to_string(),
                    deprecated: false,
                    deprecation_hint: None,
                    frontmatter,
                });
            }
        }
    }

    results.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    results
}

/// Validate that a path is within a known global rules directory.
fn validate_global_path(path: &Path) -> Result<(), AppError> {
    let home = home_dir().ok_or_else(|| AppError::Validation("Cannot determine home directory".into()))?;
    let canonical_path = if path.exists() {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    } else {
        let parent = path.parent().unwrap_or(path);
        let canonical_parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
        canonical_parent.join(path.file_name().unwrap_or_default())
    };

    for known_dir in KNOWN_GLOBAL_RULE_DIRS {
        let allowed = home.join(known_dir).canonicalize().unwrap_or_else(|_| home.join(known_dir));
        if canonical_path.starts_with(&allowed) {
            return Ok(());
        }
    }

    Err(AppError::Validation(
        "Path is not within a known global rules directory".to_string(),
    ))
}

// ── Commands: Rules ──

#[tauri::command]
pub fn list_rule_files(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<AgentRuleGroup>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project_path = get_project_path(&conn, &project_id)?;
    let home = home_dir();

    // Get agent info without running installation detection — the frontend
    // already knows which agents are installed and filters accordingly.
    let agents = agent::list_agent_info_no_detect();

    // Build a group per agent
    let mut groups: Vec<AgentRuleGroup> = Vec::new();

    for agent_info in &agents {
        let mut project_rules: Vec<RuleFileInfo> = Vec::new();
        let mut global_rules: Vec<RuleFileInfo> = Vec::new();

        for def in RULE_DEFS {
            if def.agent_name != agent_info.name {
                continue;
            }

            let (base_path, rules_vec) = match def.scope {
                "global" => {
                    if let Some(ref h) = home {
                        (h.clone(), &mut global_rules)
                    } else {
                        continue;
                    }
                }
                _ => (project_path.clone(), &mut project_rules),
            };

            if def.is_directory {
                let dir_path = base_path.join(def.relative_path);
                if dir_path.is_dir() {
                    let scanned = scan_rule_directory(
                        &dir_path,
                        def.extensions,
                        def.agent_name,
                        def.scope,
                        &base_path,
                    );
                    rules_vec.extend(scanned);
                }
                // Don't add the directory itself as a file entry
            } else {
                let file_path = base_path.join(def.relative_path);
                let exists = file_path.is_file();

                let relative_path = if def.scope == "global" {
                    format!("~/{}", def.relative_path)
                } else {
                    def.relative_path.to_string()
                };

                let frontmatter = if exists {
                    std::fs::read_to_string(&file_path)
                        .ok()
                        .and_then(|content| parse_rule_frontmatter(&content))
                } else {
                    None
                };

                // Use the filename as display name
                let display_name = Path::new(def.relative_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| def.relative_path.to_string());

                rules_vec.push(RuleFileInfo {
                    agent_name: def.agent_name.to_string(),
                    display_name,
                    path: if exists {
                        Some(crate::git::strip_unc_prefix(&file_path.to_string_lossy()).into_owned())
                    } else {
                        None
                    },
                    relative_path,
                    exists,
                    scope: def.scope.to_string(),
                    category: def.category.to_string(),
                    deprecated: def.deprecated,
                    deprecation_hint: def.deprecation_hint.map(String::from),
                    frontmatter,
                });
            }
        }

        groups.push(AgentRuleGroup {
            agent_name: agent_info.name.clone(),
            display_name: agent_info.display_name.clone(),
            installed: agent_info.installed,
            project_rules,
            global_rules,
        });
    }

    Ok(groups)
}

#[tauri::command]
pub fn read_rule_file_content(
    state: State<'_, DbState>,
    project_id: String,
    file_path: String,
) -> Result<String, AppError> {
    let path = Path::new(&file_path);

    // Determine if this is a global or project file and validate accordingly
    let is_global = if let Some(home) = home_dir() {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let home_canonical = home.canonicalize().unwrap_or(home);
        canonical.starts_with(&home_canonical) && !{
            let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
            let project_path = get_project_path(&conn, &project_id)?;
            let proj_canonical = project_path.canonicalize().unwrap_or(project_path);
            canonical.starts_with(&proj_canonical)
        }
    } else {
        false
    };

    if is_global {
        validate_global_path(path)?;
    } else {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let project_path = get_project_path(&conn, &project_id)?;
        validate_within_project(path, &project_path)?;
    }

    if !path.is_file() {
        return Err(AppError::NotFound(format!("File not found: {file_path}")));
    }

    // Limit to 2MB
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > 2_097_152 {
        return Err(AppError::Validation(
            "File exceeds 2MB size limit".into(),
        ));
    }

    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command]
pub fn save_rule_file(
    state: State<'_, DbState>,
    project_id: String,
    file_path: String,
    content: String,
) -> Result<(), AppError> {
    let path = Path::new(&file_path);

    // Determine if this is a global or project file
    let is_global = if let Some(home) = home_dir() {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let home_canonical = home.canonicalize().unwrap_or(home);
        canonical.starts_with(&home_canonical) && !{
            let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
            let project_path = get_project_path(&conn, &project_id)?;
            let proj_canonical = project_path.canonicalize().unwrap_or(project_path);
            canonical.starts_with(&proj_canonical)
        }
    } else {
        false
    };

    if is_global {
        validate_global_path(path)?;
    } else {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        let project_path = get_project_path(&conn, &project_id)?;
        validate_within_project(path, &project_path)?;
    }

    // Create parent directories if needed
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(path, content)?;
    Ok(())
}

#[tauri::command]
pub fn create_rule_file(
    state: State<'_, DbState>,
    project_id: String,
    agent_name: String,
    filename: String,
    directory: String,
    content: Option<String>,
) -> Result<RuleFileInfo, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project_path = get_project_path(&conn, &project_id)?;

    // Resolve directory: "~/" prefix means global, otherwise project-relative
    let (base_path, scope) = if directory.starts_with("~/") {
        let home = home_dir().ok_or_else(|| AppError::Validation("Cannot determine home directory".into()))?;
        let rel = directory.strip_prefix("~/").unwrap_or(&directory);
        (home.join(rel), "global")
    } else {
        (project_path.clone(), "project")
    };

    let dir_path = if scope == "project" {
        base_path.join(&directory)
    } else {
        base_path.clone()
    };

    let file_path = dir_path.join(&filename);

    // Validate path
    if scope == "global" {
        validate_global_path(&file_path)?;
    } else {
        validate_within_project(&file_path, &project_path)?;
    }

    if file_path.is_file() {
        return Err(AppError::Validation(format!("File already exists: {}", file_path.display())));
    }

    // Create parent dirs
    std::fs::create_dir_all(&dir_path)?;

    // Generate default content
    let default_content = content.unwrap_or_else(|| {
        let ext = Path::new(&filename).extension().and_then(|e| e.to_str()).unwrap_or("md");
        if ext == "mdc" {
            format!("---\ndescription: \nglobs: \nalwaysApply: false\n---\n\n# {}\n\n", filename.trim_end_matches(".mdc"))
        } else {
            format!("# {}\n\n", filename.trim_end_matches(".md"))
        }
    });

    std::fs::write(&file_path, &default_content)?;

    let relative_path = if scope == "global" {
        format!("~/{}/{}", directory.strip_prefix("~/").unwrap_or(&directory), filename)
    } else {
        format!("{}/{}", directory, filename)
    };

    let frontmatter = parse_rule_frontmatter(&default_content);

    Ok(RuleFileInfo {
        agent_name,
        display_name: filename,
        path: Some(crate::git::strip_unc_prefix(&file_path.to_string_lossy()).into_owned()),
        relative_path,
        exists: true,
        scope: scope.to_string(),
        category: "nested".to_string(),
        deprecated: false,
        deprecation_hint: None,
        frontmatter,
    })
}

#[tauri::command]
pub fn list_instruction_files(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Vec<InstructionFileInfo>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project_path = get_project_path(&conn, &project_id)?;

    // Deduplicate filenames (some agents share files like AGENTS.md)
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();

    for &(agent, filename) in INSTRUCTION_FILES {
        if !seen.insert(filename) {
            continue;
        }

        let file_path = project_path.join(filename);
        let exists = file_path.is_file();

        files.push(InstructionFileInfo {
            agent_name: agent.to_string(),
            filename: filename.to_string(),
            path: if exists {
                Some(
                    crate::git::strip_unc_prefix(&file_path.to_string_lossy()).into_owned(),
                )
            } else {
                None
            },
            exists,
        });
    }

    Ok(files)
}

#[tauri::command]
pub fn read_instruction_file_content(
    state: State<'_, DbState>,
    project_id: String,
    file_path: String,
) -> Result<String, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project_path = get_project_path(&conn, &project_id)?;
    let path = Path::new(&file_path);

    validate_within_project(path, &project_path)?;

    if !path.is_file() {
        return Err(AppError::NotFound(format!("File not found: {file_path}")));
    }

    // Limit to 2MB
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > 2_097_152 {
        return Err(AppError::Validation(
            "File exceeds 2MB size limit".into(),
        ));
    }

    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command]
pub fn save_instruction_file(
    state: State<'_, DbState>,
    project_id: String,
    filename: String,
    content: String,
) -> Result<(), AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project_path = get_project_path(&conn, &project_id)?;
    let file_path = project_path.join(&filename);

    validate_within_project(&file_path, &project_path)?;

    // Create parent directories if needed (e.g., .cursor/rules, .github/)
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(&file_path, content)?;
    Ok(())
}

// ── Commands: Skills ──

#[tauri::command]
pub fn list_installed_skills(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<InstalledSkillsResponse, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project_path = get_project_path(&conn, &project_id)?;

    // Project skills: <project_root>/.claude/skills/ + <project_root>/.agents/skills/
    let claude_skills_dir = project_path.join(".claude").join("skills");
    let universal_skills_dir = project_path.join(".agents").join("skills");
    tracing::info!(
        "Listing installed skills — claude: {}, universal: {}, global: ~/.claude/skills/",
        claude_skills_dir.display(),
        universal_skills_dir.display(),
    );
    let mut project_skills = scan_skills_dir(&claude_skills_dir, false);
    project_skills.extend(scan_skills_dir(&universal_skills_dir, false));
    project_skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // Global skills: ~/.claude/skills/
    let global_skills = if let Some(home) = home_dir() {
        let global_skills_dir = home.join(".claude").join("skills");
        scan_skills_dir(&global_skills_dir, true)
    } else {
        tracing::warn!("Could not determine home directory for global skills");
        Vec::new()
    };

    tracing::info!(
        "Found {} project skills, {} global skills",
        project_skills.len(),
        global_skills.len()
    );

    Ok(InstalledSkillsResponse {
        project_skills,
        global_skills,
    })
}

#[tauri::command]
pub fn read_skill_content(path: String) -> Result<String, AppError> {
    let skill_dir = Path::new(&path);
    let skill_md = skill_dir.join("SKILL.md");

    if skill_md.is_file() {
        // Limit to 1MB
        let metadata = std::fs::metadata(&skill_md)?;
        if metadata.len() > 1_048_576 {
            return Err(AppError::Validation(
                "Skill file exceeds 1MB size limit".into(),
            ));
        }
        return Ok(std::fs::read_to_string(&skill_md)?);
    }

    // Fallback: look for README.md
    let readme = skill_dir.join("README.md");
    if readme.is_file() {
        let metadata = std::fs::metadata(&readme)?;
        if metadata.len() > 1_048_576 {
            return Err(AppError::Validation(
                "File exceeds 1MB size limit".into(),
            ));
        }
        return Ok(std::fs::read_to_string(&readme)?);
    }

    Err(AppError::NotFound("No SKILL.md or README.md found".into()))
}

#[tauri::command]
pub async fn search_skills(query: String) -> Result<Vec<SkillSearchResult>, AppError> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let url = format!(
        "https://skills.sh/api/search?q={}",
        url_encode(&query)
    );
    tracing::info!("Searching skills: {}", url);

    let response = reqwest::get(&url)
        .await
        .map_err(|e| {
            tracing::error!("Skills search request failed: {e}");
            AppError::Io(format!("Skills search request failed: {e}"))
        })?;

    if !response.status().is_success() {
        tracing::error!("Skills search returned status {}", response.status());
        return Err(AppError::Io(format!(
            "Skills search returned status {}",
            response.status()
        )));
    }

    // The API may return different shapes; try to parse as array of results
    let body = response
        .text()
        .await
        .map_err(|e| AppError::Io(format!("Failed to read search response: {e}")))?;

    tracing::debug!("Skills search response body: {}", &body[..body.len().min(500)]);

    // Try parsing as direct array
    if let Ok(results) = serde_json::from_str::<Vec<SkillSearchResult>>(&body) {
        tracing::info!("Skills search returned {} results", results.len());
        return Ok(results);
    }

    // Try parsing as object with "results" field
    #[derive(Deserialize)]
    struct Wrapper {
        results: Option<Vec<SkillSearchResult>>,
        skills: Option<Vec<SkillSearchResult>>,
        data: Option<Vec<SkillSearchResult>>,
    }

    if let Ok(wrapper) = serde_json::from_str::<Wrapper>(&body) {
        if let Some(results) = wrapper.results.or(wrapper.skills).or(wrapper.data) {
            tracing::info!("Skills search returned {} results (wrapped)", results.len());
            return Ok(results);
        }
    }

    // If we can't parse, return empty with no error (API shape may change)
    tracing::warn!("Could not parse skills.sh response: {}", &body[..body.len().min(200)]);
    Ok(Vec::new())
}

#[tauri::command]
pub async fn remove_skill(
    state: State<'_, DbState>,
    project_id: String,
    skill_name: String,
    global: bool,
) -> Result<String, AppError> {
    let project_path = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        get_project_path(&conn, &project_id)?
    };

    tracing::info!(
        "Removing skill '{}' (global={}) in {}",
        skill_name,
        global,
        project_path.display()
    );

    let mut args: Vec<&str> = vec!["--yes", "skills", "remove", &skill_name];
    if global {
        args.push("-g");
    }

    tracing::debug!("Running command: npx {}", args.join(" "));

    let mut cmd = npx_command(&args);
    cmd.current_dir(&project_path);

    let output = cmd
        .output()
        .map_err(|e| {
            tracing::error!("Failed to spawn npx process: {e}");
            AppError::Io(format!("Failed to run npx skills: {e}. Is npm/npx installed?"))
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    tracing::info!(
        "npx skills remove exited with status={}, stdout={}, stderr={}",
        output.status,
        stdout.trim(),
        stderr.trim()
    );

    if !output.status.success() {
        let err_msg = if stderr.is_empty() { &stdout } else { &stderr };
        tracing::error!("Skill remove failed: {}", err_msg);
        return Err(AppError::Io(format!(
            "Skill remove failed: {}",
            err_msg
        )));
    }

    tracing::info!("Skill '{}' removed successfully", skill_name);
    Ok(stdout)
}
