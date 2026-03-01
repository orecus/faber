use crate::db::models::FileEntry;
use crate::error::AppError;
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
        if metadata.is_dir() {
            match file_name.as_str() {
                "node_modules" | "target" | "__pycache__" | ".git" | "dist" | "build"
                | ".next" | ".nuxt" | ".output" | "out" | ".turbo" | ".cache" => continue,
                _ => {}
            }
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
