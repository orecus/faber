use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::LogDir;

#[derive(Debug, Clone, Serialize)]
pub struct DocEntry {
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocContent {
    pub slug: String,
    pub title: String,
    pub body: String,
}

/// Simple YAML frontmatter for doc files.
#[derive(Debug, serde::Deserialize)]
struct DocFrontmatter {
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    order: i32,
}

/// Parse YAML frontmatter delimited by `---` and return (frontmatter, body).
fn parse_frontmatter(content: &str) -> Option<(DocFrontmatter, String)> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    let after_first = &trimmed[3..];
    let close_pos = after_first.find("\n---")?;
    let yaml_str = &after_first[..close_pos];
    let body_start = close_pos + 4;
    let body = if body_start < after_first.len() {
        after_first[body_start..].trim_start_matches('\n').to_string()
    } else {
        String::new()
    };
    let fm: DocFrontmatter = serde_yaml::from_str(yaml_str).ok()?;
    Some((fm, body))
}

/// Resolve the docs directory — either from Tauri resources (bundled app)
/// or from the project root (dev mode).
fn resolve_docs_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    // In bundled builds, resources are placed alongside the binary.
    // On macOS, Tauri maps "../docs/*" to "_up_/docs/" inside Resources/.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("docs");
        if bundled.is_dir() {
            return Ok(bundled);
        }
        let macos_bundled = resource_dir.join("_up_").join("docs");
        if macos_bundled.is_dir() {
            return Ok(macos_bundled);
        }
    }

    // Dev mode: docs/ lives at the repo root (two levels up from src-tauri/target/).
    // Tauri sets the CWD to the project root during `tauri dev`.
    let dev_path = std::env::current_dir()
        .unwrap_or_default()
        .join("docs");
    if dev_path.is_dir() {
        return Ok(dev_path);
    }

    // Also try relative to the Cargo manifest directory (compile-time).
    let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let from_manifest = manifest.parent().unwrap_or(&manifest).join("docs");
    if from_manifest.is_dir() {
        return Ok(from_manifest);
    }

    Err(AppError::NotFound("docs directory not found".into()))
}

#[tauri::command]
pub fn list_docs(app: AppHandle) -> Result<Vec<DocEntry>, AppError> {
    let docs_dir = resolve_docs_dir(&app)?;
    let mut entries = Vec::new();

    for entry in std::fs::read_dir(&docs_dir).map_err(|e| AppError::Io(e.to_string()))? {
        let entry = entry.map_err(|e| AppError::Io(e.to_string()))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let slug = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        let content = std::fs::read_to_string(&path).map_err(|e| AppError::Io(e.to_string()))?;
        if let Some((fm, _)) = parse_frontmatter(&content) {
            entries.push(DocEntry {
                slug,
                title: fm.title,
                description: fm.description,
                icon: fm.icon,
                order: fm.order,
            });
        } else {
            // Files without frontmatter: use filename as title
            entries.push(DocEntry {
                slug: slug.clone(),
                title: slug.replace(['_', '-'], " "),
                description: String::new(),
                icon: String::from("file-text"),
                order: 999,
            });
        }
    }

    entries.sort_by_key(|e| e.order);
    Ok(entries)
}

#[tauri::command]
pub fn get_doc_content(app: AppHandle, slug: String) -> Result<DocContent, AppError> {
    let docs_dir = resolve_docs_dir(&app)?;
    let path = docs_dir.join(format!("{slug}.md"));
    if !path.is_file() {
        return Err(AppError::NotFound(format!("Doc '{slug}' not found")));
    }

    let content = std::fs::read_to_string(&path).map_err(|e| AppError::Io(e.to_string()))?;

    if let Some((fm, body)) = parse_frontmatter(&content) {
        Ok(DocContent {
            slug,
            title: fm.title,
            body,
        })
    } else {
        // No frontmatter — return entire content as body
        Ok(DocContent {
            slug: slug.clone(),
            title: slug.replace(['_', '-'], " "),
            body: content,
        })
    }
}

/// Return the path to the log directory so the UI can offer "Open Log Folder".
#[tauri::command]
pub fn get_log_directory(log_dir: tauri::State<'_, LogDir>) -> Result<String, AppError> {
    Ok(log_dir.0.to_string_lossy().to_string())
}

/// Open the log directory in the system file manager.
#[tauri::command]
pub fn open_log_directory(log_dir: tauri::State<'_, LogDir>) -> Result<(), AppError> {
    let path = &log_dir.0;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Io(e.to_string()))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Io(e.to_string()))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Io(e.to_string()))?;
    }
    Ok(())
}
