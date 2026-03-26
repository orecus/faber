use crate::db::models::FileEntry;
use crate::error::AppError;
use serde::Serialize;
use std::path::Path;

/// Open a file using the OS default application.
#[tauri::command]
pub async fn open_file_in_os(path: String) -> Result<(), AppError> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(AppError::Validation(format!(
            "File does not exist: {}",
            path
        )));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open file: {}", e)))?;
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct EditorInfo {
    pub id: String,
    pub label: String,
    pub command: String,
}

/// Known editors to probe for in PATH.
const KNOWN_EDITORS: &[(&str, &str, &str)] = &[
    ("vscode", "VS Code", "code"),
    ("cursor", "Cursor", "cursor"),
    ("zed", "Zed", "zed"),
    ("windsurf", "Windsurf", "windsurf"),
    ("fleet", "Fleet", "fleet"),
    ("sublime", "Sublime Text", "subl"),
    ("vim", "Vim", "vim"),
    ("neovim", "Neovim", "nvim"),
];

/// Check if a command is available on PATH.
fn command_exists(cmd: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        // On Windows, check for cmd, cmd.exe, and cmd.cmd variants
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("where")
            .arg(cmd)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Detect which code editors are available on the system PATH.
#[tauri::command]
pub async fn detect_editors() -> Result<Vec<EditorInfo>, AppError> {
    let editors: Vec<EditorInfo> = KNOWN_EDITORS
        .iter()
        .filter(|(_, _, cmd)| command_exists(cmd))
        .map(|(id, label, cmd)| EditorInfo {
            id: id.to_string(),
            label: label.to_string(),
            command: cmd.to_string(),
        })
        .collect();

    Ok(editors)
}

/// Open a file or directory in a specific editor.
#[tauri::command]
pub async fn open_in_editor(path: String, editor_id: String) -> Result<(), AppError> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(AppError::Validation(format!(
            "Path does not exist: {}",
            path
        )));
    }

    let cmd = KNOWN_EDITORS
        .iter()
        .find(|(id, _, _)| *id == editor_id.as_str())
        .map(|(_, _, cmd)| *cmd)
        .ok_or_else(|| AppError::Validation(format!("Unknown editor: {}", editor_id)))?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/c", cmd, &path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open in editor: {}", e)))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(cmd)
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Io(format!("Failed to open in editor: {}", e)))?;
    }

    Ok(())
}

/// Directories to skip during file listing/search.
const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "__pycache__",
    ".git",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".output",
    "out",
    ".turbo",
    ".cache",
];

/// Check if a directory name should be skipped.
fn should_skip_dir(name: &str) -> bool {
    IGNORED_DIRS.contains(&name)
}

/// Recursively index all files in a project directory.
/// Returns a flat list of all FileEntry items, sorted alphabetically by path.
/// Skips hidden files/dirs and common noisy directories.
#[tauri::command]
pub async fn index_project_files(
    project_root: String,
) -> Result<Vec<FileEntry>, AppError> {
    let root = Path::new(&project_root);
    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::Io(format!("Cannot resolve project root '{}': {}", project_root, e)))?;

    let mut results = Vec::new();

    fn walk(dir: &Path, canonical_root: &Path, results: &mut Vec<FileEntry>) {
        let read_dir = match std::fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(_) => return,
        };

        for entry in read_dir {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let file_name = entry.file_name().to_string_lossy().to_string();

            if file_name.starts_with('.') {
                continue;
            }

            if metadata.is_dir() {
                if should_skip_dir(&file_name) {
                    continue;
                }
                walk(&entry.path(), canonical_root, results);
            } else {
                let rel_path = entry
                    .path()
                    .strip_prefix(canonical_root)
                    .unwrap_or(&entry.path())
                    .to_string_lossy()
                    .replace('\\', "/");

                let extension = entry
                    .path()
                    .extension()
                    .map(|e| e.to_string_lossy().to_string());

                results.push(FileEntry {
                    name: file_name,
                    path: rel_path,
                    is_dir: false,
                    size: Some(metadata.len()),
                    extension,
                });
            }
        }
    }

    walk(&canonical_root, &canonical_root, &mut results);

    // Sort alphabetically by path
    results.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));

    Ok(results)
}

/// List entries in a directory, sorted: directories first, then alphabetically.
/// The `path` must be an absolute path. Returns relative paths from `project_root`.
#[tauri::command]
pub async fn list_directory(
    path: String,
    project_root: String,
) -> Result<Vec<FileEntry>, AppError> {
    let dir = Path::new(&path);
    let root = Path::new(&project_root);

    // Security: ensure the requested path is within the project root
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| AppError::Io(format!("Cannot resolve path '{}': {}", path, e)))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::Io(format!("Cannot resolve project root '{}': {}", project_root, e)))?;

    if !canonical_dir.starts_with(&canonical_root) {
        return Err(AppError::Validation(format!(
            "Path '{}' is outside project root '{}'",
            path, project_root
        )));
    }

    let mut entries = Vec::new();

    let read_dir = std::fs::read_dir(&canonical_dir)
        .map_err(|e| AppError::Io(format!("Cannot read directory '{}': {}", path, e)))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| AppError::Io(e.to_string()))?;
        let metadata = entry.metadata().map_err(|e| AppError::Io(e.to_string()))?;
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs (starting with .)
        if file_name.starts_with('.') {
            continue;
        }

        // Skip common noisy directories
        if metadata.is_dir() && should_skip_dir(&file_name) {
            continue;
        }

        let is_dir = metadata.is_dir();
        let size = if is_dir { None } else { Some(metadata.len()) };
        let extension = if is_dir {
            None
        } else {
            entry
                .path()
                .extension()
                .map(|e| e.to_string_lossy().to_string())
        };

        // Compute relative path from project root
        let rel_path = entry
            .path()
            .strip_prefix(&canonical_root)
            .unwrap_or(&entry.path())
            .to_string_lossy()
            .replace('\\', "/");

        entries.push(FileEntry {
            name: file_name,
            path: rel_path,
            is_dir,
            size,
            extension,
        });
    }

    // Sort: directories first, then alphabetically (case-insensitive)
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}
