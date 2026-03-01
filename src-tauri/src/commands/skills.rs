use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

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
        Err(_) => return skills,
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

// ── Commands: Rules ──

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

    // Project skills: <project_root>/.claude/skills/
    let project_skills_dir = project_path.join(".claude").join("skills");
    let project_skills = scan_skills_dir(&project_skills_dir, false);

    // Global skills: ~/.claude/skills/
    let global_skills = if let Some(home) = home_dir() {
        let global_skills_dir = home.join(".claude").join("skills");
        scan_skills_dir(&global_skills_dir, true)
    } else {
        Vec::new()
    };

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

    let response = reqwest::get(&url)
        .await
        .map_err(|e| AppError::Io(format!("Skills search request failed: {e}")))?;

    if !response.status().is_success() {
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

    // Try parsing as direct array
    if let Ok(results) = serde_json::from_str::<Vec<SkillSearchResult>>(&body) {
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
            return Ok(results);
        }
    }

    // If we can't parse, return empty with no error (API shape may change)
    tracing::warn!("Could not parse skills.sh response: {}", &body[..body.len().min(200)]);
    Ok(Vec::new())
}

#[tauri::command]
pub async fn install_skill(
    state: State<'_, DbState>,
    project_id: String,
    source: String,
    skill_name: String,
    global: bool,
) -> Result<String, AppError> {
    let project_path = {
        let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
        get_project_path(&conn, &project_id)?
    };

    let mut cmd = cmd_no_window("npx");
    cmd.args(["skills", "add", &source, "-s", &skill_name]);
    if global {
        cmd.arg("-g");
    }
    cmd.current_dir(&project_path);

    let output = cmd
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run npx skills: {e}. Is npm/npx installed?")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(AppError::Io(format!(
            "Skill install failed: {}",
            if stderr.is_empty() { &stdout } else { &stderr }
        )));
    }

    Ok(stdout)
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

    let mut cmd = cmd_no_window("npx");
    cmd.args(["skills", "remove", &skill_name]);
    if global {
        cmd.arg("-g");
    }
    cmd.current_dir(&project_path);

    let output = cmd
        .output()
        .map_err(|e| AppError::Io(format!("Failed to run npx skills: {e}. Is npm/npx installed?")))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(AppError::Io(format!(
            "Skill remove failed: {}",
            if stderr.is_empty() { &stdout } else { &stderr }
        )));
    }

    Ok(stdout)
}
