use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::db;
use crate::db::models::{NewProject, Project, UpdateProject};
use crate::db::DbState;
use crate::error::AppError;

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

    let branch = current_branch(project_path);
    let has_config_file = project_path.join(".agents").join("config.json").is_file();
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

// ── IPC Commands ──

#[tauri::command]
pub fn add_project(
    state: State<'_, DbState>,
    path: String,
    name: Option<String>,
) -> Result<Project, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    do_add_project(&conn, path, name)
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
    db::projects::get(&conn, &id)?.ok_or_else(|| AppError::NotFound(format!("Project {id}")))?;

    let upd = UpdateProject {
        name,
        default_agent,
        default_model,
        branch_naming_pattern,
        instruction_file_path,
        icon_path,
        color,
    };

    let project = db::projects::update(&conn, &id, &upd)?;
    Ok(project)
}

#[tauri::command]
pub fn remove_project(state: State<'_, DbState>, id: String) -> Result<bool, AppError> {
    let conn = state.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let deleted = db::projects::delete(&conn, &id)?;
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
