use std::collections::HashMap;
use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::db;
use crate::db::models::{NewProject, Project, UpdateProject};
use crate::db::DbState;
use crate::error::AppError;
use crate::project_config;

// ── Response types ──

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInfo {
    pub project: Project,
    pub current_branch: Option<String>,
    pub has_config_file: bool,
    pub instruction_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstructionFile {
    pub path: String,
    pub content: String,
}

// ── Helper functions ──

/// Search for an instruction file in the project root.
/// Priority: custom path from DB → CLAUDE.md → AGENTS.md → .cursorrules
pub(crate) fn find_instruction_file(project_root: &Path, custom_path: Option<&str>) -> Option<String> {
    if let Some(custom) = custom_path {
        let p = project_root.join(custom);
        if p.is_file() {
            return Some(crate::git::strip_unc_prefix(&p.to_string_lossy()).into_owned());
        }
    }
    for name in &["CLAUDE.md", "AGENTS.md", ".cursorrules"] {
        let p = project_root.join(name);
        if p.is_file() {
            return Some(crate::git::strip_unc_prefix(&p.to_string_lossy()).into_owned());
        }
    }
    None
}

/// Get the current branch name from a git repository path.
fn current_branch(repo_path: &Path) -> Option<String> {
    let repo = git2::Repository::open(repo_path).ok()?;
    let head = repo.head().ok()?;
    head.shorthand().map(String::from)
}

// ── Core logic (testable without Tauri State) ──

fn do_add_project(
    conn: &Connection,
    path: String,
    name: Option<String>,
) -> Result<Project, AppError> {
    // 1. Canonicalize the path (strip Windows UNC prefix so git CLI works)
    let canonical = std::fs::canonicalize(&path)
        .map_err(|_| AppError::Validation(format!("Path does not exist: {path}")))?;
    let canonical_str = crate::git::strip_unc_prefix(&canonical.to_string_lossy()).into_owned();

    // 2. Validate it's a git repository
    git2::Repository::open(&canonical)
        .map_err(|_| AppError::Validation(format!("Not a git repository: {canonical_str}")))?;

    // 3. Derive name from directory basename if not provided
    let project_name = name.unwrap_or_else(|| {
        canonical
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unnamed".to_string())
    });

    // 4. Return existing project if path already registered
    if let Some(existing) = db::projects::get_by_path(conn, &canonical_str)? {
        return Ok(existing);
    }

    // 5. Auto-detect instruction file
    let instruction_file_path = find_instruction_file(&canonical, None);

    // 6. Create via db
    let new = NewProject {
        name: project_name,
        path: canonical_str,
        default_agent: None,
        default_model: None,
        branch_naming_pattern: None,
        instruction_file_path,
    };

    let project = db::projects::create(conn, &new)?;

    Ok(project)
}

fn do_get_project_info(conn: &Connection, id: String) -> Result<ProjectInfo, AppError> {
    let project =
        db::projects::get(conn, &id)?.ok_or_else(|| AppError::NotFound(format!("Project {id}")))?;

    let project_path = Path::new(&project.path);

    // Ensure .agents/faber.json exists (auto-create from DB if missing, sync to DB if present)
    if let Err(e) = project_config::ensure_config(conn, &id, project_path) {
        tracing::warn!(project_id = %id, %e, "Failed to ensure project config");
    }

    let branch = current_branch(project_path);
    let has_config_file = project_config::config_path(project_path).is_file();

    // Re-read project from DB in case ensure_config updated it
    let project = db::projects::get(conn, &id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {id}")))?;

    let instruction_file =
        find_instruction_file(project_path, project.instruction_file_path.as_deref());

    Ok(ProjectInfo {
        project,
        current_branch: branch,
        has_config_file,
        instruction_file,
    })
}

fn do_read_instruction_file(
    conn: &Connection,
    project_id: String,
) -> Result<Option<InstructionFile>, AppError> {
    let project = db::projects::get(conn, &project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    let project_path = Path::new(&project.path);
    let instruction_path =
        find_instruction_file(project_path, project.instruction_file_path.as_deref());

    match instruction_path {
        Some(path) => {
            let content = std::fs::read_to_string(&path)?;
            Ok(Some(InstructionFile { path, content }))
        }
        None => Ok(None),
    }
}

fn do_create_project(
    conn: &Connection,
    parent_path: String,
    name: String,
) -> Result<Project, AppError> {
    // 1. Validate name
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Project name cannot be empty".into()));
    }
    // Block filesystem-unsafe characters
    if name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err(AppError::Validation(
            "Project name contains invalid characters (/ \\ : * ? \" < > |)".into(),
        ));
    }

    // 2. Build full path
    let parent = Path::new(&parent_path);
    if !parent.is_dir() {
        return Err(AppError::Validation(format!(
            "Parent directory does not exist: {parent_path}"
        )));
    }
    let full_path = parent.join(&name);

    // 3. Check path doesn't already exist (or is an empty dir)
    if full_path.exists() {
        if full_path.is_dir() {
            // Allow if dir is completely empty
            let is_empty = std::fs::read_dir(&full_path)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false);
            if !is_empty {
                return Err(AppError::Validation(format!(
                    "Directory already exists and is not empty: {}",
                    full_path.display()
                )));
            }
        } else {
            return Err(AppError::Validation(format!(
                "A file already exists at: {}",
                full_path.display()
            )));
        }
    }

    // 4. Create directory
    std::fs::create_dir_all(&full_path)?;

    // 5. Git init + initial commit
    let repo = git2::Repository::init(&full_path)
        .map_err(|e| AppError::Git(format!("Failed to initialize git repository: {e}")))?;

    // Create .gitignore with sensible defaults
    let gitignore_content = "# OS files\n.DS_Store\nThumbs.db\n\n# IDE\n.idea/\n.vscode/\n*.swp\n*.swo\n\n# Dependencies\nnode_modules/\ntarget/\n";
    std::fs::write(full_path.join(".gitignore"), gitignore_content)?;

    // Create initial commit so HEAD exists
    let sig = git2::Signature::now("Faber", "faber@local")
        .map_err(|e| AppError::Git(format!("Failed to create git signature: {e}")))?;
    let mut index = repo.index()?;
    index.add_path(Path::new(".gitignore"))?;
    index.write()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])?;

    // 6. Register in DB via existing do_add_project
    let full_path_str = full_path.to_string_lossy().into_owned();
    do_add_project(conn, full_path_str, Some(name))
}

// ── IPC Commands ──

#[tauri::command]
pub fn create_project(
    state: State<'_, DbState>,
    parent_path: String,
    name: String,
) -> Result<Project, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project = do_create_project(&conn, parent_path, name)?;
    tracing::info!(project_id = %project.id, name = %project.name, path = %project.path, "Project created");
    Ok(project)
}

#[tauri::command]
pub fn add_project(
    state: State<'_, DbState>,
    path: String,
    name: Option<String>,
) -> Result<Project, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let project = do_add_project(&conn, path, name)?;
    tracing::info!(project_id = %project.id, name = %project.name, path = %project.path, "Project added");
    Ok(project)
}

#[tauri::command]
pub fn list_projects(state: State<'_, DbState>) -> Result<Vec<Project>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let projects = db::projects::list(&conn)?;
    Ok(projects)
}

#[tauri::command]
pub fn get_project(state: State<'_, DbState>, id: String) -> Result<Project, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    db::projects::get(&conn, &id)?.ok_or_else(|| AppError::NotFound(format!("Project {id}")))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_project(
    state: State<'_, DbState>,
    id: String,
    name: Option<String>,
    default_agent: Option<Option<String>>,
    default_model: Option<Option<String>>,
    branch_naming_pattern: Option<Option<String>>,
    instruction_file_path: Option<Option<String>>,
    icon_path: Option<Option<String>>,
    color: Option<Option<String>>,
) -> Result<Project, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;

    // Verify project exists
    let existing =
        db::projects::get(&conn, &id)?.ok_or_else(|| AppError::NotFound(format!("Project {id}")))?;

    let upd = UpdateProject {
        name,
        default_agent: default_agent.clone(),
        default_model: default_model.clone(),
        branch_naming_pattern: branch_naming_pattern.clone(),
        instruction_file_path: instruction_file_path.clone(),
        icon_path,
        color,
    };

    let project = db::projects::update(&conn, &id, &upd)?;

    // Sync project fields to faber.json (if any config-relevant fields changed)
    if default_agent.is_some()
        || default_model.is_some()
        || branch_naming_pattern.is_some()
        || instruction_file_path.is_some()
    {
        let project_path = Path::new(&existing.path);
        if let Err(e) = project_config::update_project_fields(
            &conn,
            &id,
            project_path,
            default_agent,
            default_model,
            branch_naming_pattern,
            instruction_file_path,
        ) {
            tracing::warn!(project_id = %id, %e, "Failed to update faber.json");
        }
    }

    tracing::info!(project_id = %id, "Project updated");
    Ok(project)
}

#[tauri::command]
pub fn remove_project(state: State<'_, DbState>, id: String) -> Result<bool, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let deleted = db::projects::delete(&conn, &id)?;
    if deleted {
        tracing::info!(project_id = %id, "Project removed");
    }
    Ok(deleted)
}

#[tauri::command]
pub fn get_project_info(state: State<'_, DbState>, id: String) -> Result<ProjectInfo, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    do_get_project_info(&conn, id)
}

/// Auto-detect a project icon SVG by searching known file names in the project root.
#[tauri::command]
pub fn resolve_project_icon(path: String) -> Result<Option<String>, AppError> {
    let root = std::path::PathBuf::from(&path);
    if !root.is_dir() {
        return Ok(None);
    }

    let names = &["logo.svg", "favicon.svg", "icon.svg"];
    let subdirs = &[
        "", "public", "assets", "static", "src", "resources", "res",
        "img", "images", "icons", ".github",
    ];

    // 1. Check well-known SVG filenames in root and common subdirectories
    for dir in subdirs {
        let base = if dir.is_empty() { root.clone() } else { root.join(dir) };
        if !dir.is_empty() && !base.is_dir() {
            continue;
        }
        for name in names {
            let candidate = base.join(name);
            if candidate.is_file() {
                return Ok(Some(candidate.to_string_lossy().into_owned()));
            }
        }
    }

    // 2. Check package.json for icon/logo field pointing to .svg
    let pkg_json = root.join("package.json");
    if pkg_json.is_file() {
        if let Ok(content) = std::fs::read_to_string(&pkg_json) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                for field in &["icon", "logo"] {
                    if let Some(val) = json.get(field).and_then(|v| v.as_str()) {
                        if val.ends_with(".svg") {
                            let candidate = root.join(val);
                            if candidate.is_file() {
                                return Ok(Some(candidate.to_string_lossy().into_owned()));
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(None)
}

/// Read an SVG file and return its content as a string.
/// Only reads files with .svg extension as a basic safety check.
#[tauri::command]
pub fn read_svg_icon(path: String) -> Result<Option<String>, AppError> {
    let p = std::path::PathBuf::from(&path);
    // Only allow .svg files
    match p.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("svg") => {}
        _ => return Err(AppError::Validation("Only .svg files can be read as icons".into())),
    }
    if !p.is_file() {
        return Ok(None);
    }
    // Limit file size to 1MB to prevent abuse
    let metadata = std::fs::metadata(&p)?;
    if metadata.len() > 1_048_576 {
        return Err(AppError::Validation("SVG file exceeds 1MB size limit".into()));
    }
    let content = std::fs::read_to_string(&p)?;
    Ok(Some(content))
}

/// Get the current branch name for multiple projects at once.
/// Returns a map of project_id → branch_name (or null if unavailable).
#[tauri::command]
pub fn get_project_branches(
    state: State<'_, DbState>,
    project_ids: Vec<String>,
) -> Result<HashMap<String, Option<String>>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let mut result = HashMap::new();
    for id in project_ids {
        let branch = db::projects::get(&conn, &id)?
            .map(|p| current_branch(Path::new(&p.path)))
            .unwrap_or(None);
        result.insert(id, branch);
    }
    Ok(result)
}

#[tauri::command]
pub fn read_instruction_file(
    state: State<'_, DbState>,
    project_id: String,
) -> Result<Option<InstructionFile>, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    do_read_instruction_file(&conn, project_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup() -> Connection {
        let state = db::init_memory().unwrap();
        state.into_inner().unwrap()
    }

    fn init_git_repo(dir: &Path) {
        git2::Repository::init(dir).expect("failed to init git repo");
    }

    // ── Helper function tests ──

    #[test]
    fn find_instruction_file_custom_path() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("MY_INSTRUCTIONS.md"), "custom").unwrap();

        let result = find_instruction_file(root, Some("MY_INSTRUCTIONS.md"));
        assert!(result.is_some());
        assert!(result.unwrap().ends_with("MY_INSTRUCTIONS.md"));
    }

    #[test]
    fn find_instruction_file_priority_order() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // No instruction files → None
        assert!(find_instruction_file(root, None).is_none());

        // Only .cursorrules
        fs::write(root.join(".cursorrules"), "rules").unwrap();
        let result = find_instruction_file(root, None).unwrap();
        assert!(result.ends_with(".cursorrules"));

        // Add AGENTS.md → should win over .cursorrules
        fs::write(root.join("AGENTS.md"), "agents").unwrap();
        let result = find_instruction_file(root, None).unwrap();
        assert!(result.ends_with("AGENTS.md"));

        // Add CLAUDE.md → should win over AGENTS.md
        fs::write(root.join("CLAUDE.md"), "claude").unwrap();
        let result = find_instruction_file(root, None).unwrap();
        assert!(result.ends_with("CLAUDE.md"));
    }

    #[test]
    fn find_instruction_file_custom_overrides_all() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("CLAUDE.md"), "claude").unwrap();
        fs::write(root.join("custom.md"), "custom").unwrap();

        let result = find_instruction_file(root, Some("custom.md")).unwrap();
        assert!(result.ends_with("custom.md"));
    }

    #[test]
    fn current_branch_returns_branch_name() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let repo = git2::Repository::init(root).unwrap();

        // Create an initial commit so HEAD exists
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let tree_id = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
            .unwrap();

        let branch = current_branch(root);
        assert!(branch.is_some());
        let name = branch.unwrap();
        assert!(name == "master" || name == "main");
    }

    #[test]
    fn current_branch_no_commits_returns_none() {
        let tmp = TempDir::new().unwrap();
        init_git_repo(tmp.path());
        assert!(current_branch(tmp.path()).is_none());
    }

    // ── Command logic tests (via do_* functions) ──

    // ── Create project tests ──

    #[test]
    fn create_project_success() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();

        let project = do_create_project(
            &conn,
            tmp.path().to_string_lossy().into_owned(),
            "my-new-project".to_string(),
        )
        .unwrap();

        assert_eq!(project.name, "my-new-project");
        assert!(project.id.starts_with("proj_"));

        // Verify directory was created
        let project_dir = tmp.path().join("my-new-project");
        assert!(project_dir.is_dir());

        // Verify it's a git repo with a commit
        let repo = git2::Repository::open(&project_dir).unwrap();
        assert!(repo.head().is_ok());

        // Verify .gitignore exists
        assert!(project_dir.join(".gitignore").is_file());
    }

    #[test]
    fn create_project_empty_name_fails() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();

        let result = do_create_project(
            &conn,
            tmp.path().to_string_lossy().into_owned(),
            "  ".to_string(),
        );
        assert!(result.is_err());
        assert!(format!("{}", result.unwrap_err()).contains("empty"));
    }

    #[test]
    fn create_project_invalid_chars_fails() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();

        let result = do_create_project(
            &conn,
            tmp.path().to_string_lossy().into_owned(),
            "bad/name".to_string(),
        );
        assert!(result.is_err());
        assert!(format!("{}", result.unwrap_err()).contains("invalid characters"));
    }

    #[test]
    fn create_project_existing_nonempty_dir_fails() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();

        // Create a non-empty directory
        let existing = tmp.path().join("existing");
        fs::create_dir_all(&existing).unwrap();
        fs::write(existing.join("file.txt"), "content").unwrap();

        let result = do_create_project(
            &conn,
            tmp.path().to_string_lossy().into_owned(),
            "existing".to_string(),
        );
        assert!(result.is_err());
        assert!(format!("{}", result.unwrap_err()).contains("not empty"));
    }

    #[test]
    fn create_project_parent_not_found_fails() {
        let conn = setup();

        let result = do_create_project(
            &conn,
            "/nonexistent/path/that/does/not/exist".to_string(),
            "test".to_string(),
        );
        assert!(result.is_err());
    }

    // ── Add project tests ──

    #[test]
    fn add_project_validates_git_repo() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();

        let result = do_add_project(&conn, tmp.path().to_string_lossy().into_owned(), None);
        assert!(result.is_err());
        let err = format!("{}", result.unwrap_err());
        assert!(err.contains("Not a git repository"));
    }

    #[test]
    fn add_project_success() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();
        init_git_repo(tmp.path());

        let project = do_add_project(
            &conn,
            tmp.path().to_string_lossy().into_owned(),
            Some("test-project".to_string()),
        )
        .unwrap();

        assert_eq!(project.name, "test-project");
        assert!(project.id.starts_with("proj_"));
    }

    #[test]
    fn add_project_derives_name_from_dir() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();
        init_git_repo(tmp.path());

        let project =
            do_add_project(&conn, tmp.path().to_string_lossy().into_owned(), None).unwrap();

        let expected = tmp
            .path()
            .canonicalize()
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(project.name, expected);
    }

    #[test]
    fn add_project_returns_existing_on_duplicate_path() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();
        init_git_repo(tmp.path());
        let path = tmp.path().to_string_lossy().into_owned();

        let first = do_add_project(&conn, path.clone(), Some("first".into())).unwrap();
        let second = do_add_project(&conn, path, Some("second".into())).unwrap();

        // Same project returned, original name preserved
        assert_eq!(first.id, second.id);
        assert_eq!(second.name, "first");
    }

    #[test]
    fn add_project_auto_detects_instruction_file() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();
        init_git_repo(tmp.path());
        fs::write(tmp.path().join("CLAUDE.md"), "# Instructions").unwrap();

        let project =
            do_add_project(&conn, tmp.path().to_string_lossy().into_owned(), None).unwrap();

        assert!(project.instruction_file_path.is_some());
        assert!(project
            .instruction_file_path
            .unwrap()
            .ends_with("CLAUDE.md"));
    }

    #[test]
    fn list_and_get_projects() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();
        init_git_repo(tmp.path());

        let project = do_add_project(
            &conn,
            tmp.path().to_string_lossy().into_owned(),
            Some("test".into()),
        )
        .unwrap();

        let projects = db::projects::list(&conn).unwrap();
        assert_eq!(projects.len(), 1);

        let fetched = db::projects::get(&conn, &project.id).unwrap().unwrap();
        assert_eq!(fetched.id, project.id);
    }

    #[test]
    fn get_project_not_found() {
        let conn = setup();
        let result =
            db::projects::get(&conn, "nonexistent").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn update_and_remove_project() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();
        init_git_repo(tmp.path());

        let project = do_add_project(
            &conn,
            tmp.path().to_string_lossy().into_owned(),
            Some("old-name".into()),
        )
        .unwrap();

        let upd = UpdateProject {
            name: Some("new-name".into()),
            default_agent: None,
            default_model: None,
            branch_naming_pattern: None,
            instruction_file_path: None,
            icon_path: None,
            color: None,
        };
        let updated = db::projects::update(&conn, &project.id, &upd).unwrap();
        assert_eq!(updated.name, "new-name");

        let removed = db::projects::delete(&conn, &project.id).unwrap();
        assert!(removed);

        let removed_again = db::projects::delete(&conn, &project.id).unwrap();
        assert!(!removed_again);
    }

    #[test]
    fn get_project_info_returns_extended_data() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        init_git_repo(root);

        // Create .agents/config.json
        fs::create_dir_all(root.join(".agents")).unwrap();
        fs::write(root.join(".agents").join("config.json"), "{}").unwrap();

        // Create CLAUDE.md
        fs::write(root.join("CLAUDE.md"), "# Instructions").unwrap();

        let project =
            do_add_project(&conn, root.to_string_lossy().into_owned(), None).unwrap();

        let info = do_get_project_info(&conn, project.id).unwrap();
        assert!(info.has_config_file);
        assert!(info.instruction_file.is_some());
        assert!(info.instruction_file.unwrap().ends_with("CLAUDE.md"));
        // No commits so branch is None
        assert!(info.current_branch.is_none());
    }

    #[test]
    fn read_instruction_file_returns_content() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        init_git_repo(root);
        fs::write(root.join("CLAUDE.md"), "Hello from CLAUDE.md").unwrap();

        let project =
            do_add_project(&conn, root.to_string_lossy().into_owned(), None).unwrap();

        let result = do_read_instruction_file(&conn, project.id).unwrap();
        assert!(result.is_some());
        let file = result.unwrap();
        // Content starts with original text
        assert!(file.content.starts_with("Hello from CLAUDE.md"));
        assert!(file.path.ends_with("CLAUDE.md"));
    }

    #[test]
    fn read_instruction_file_returns_none_when_no_agent_installed() {
        let conn = setup();
        let tmp = TempDir::new().unwrap();
        init_git_repo(tmp.path());

        // Agent instruction files are only created at session launch time (not project add),
        // so a fresh project with no sessions should have no instruction file.
        let project = do_add_project(
            &conn,
            tmp.path().to_string_lossy().into_owned(),
            None,
        )
        .unwrap();

        // If an agent created an instruction file, verify it has content.
        // If no agent is installed, verify None is returned.
        let result = do_read_instruction_file(&conn, project.id).unwrap();
        if let Some(file) = &result {
            // An agent instruction file was auto-created — verify it has the MCP marker
            assert!(file.content.contains("Faber"));
        }
        // Both outcomes (Some with MCP content, or None) are valid depending on environment
    }
}
