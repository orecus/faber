//! Tauri commands for font detection.

use std::sync::OnceLock;

use crate::error::AppError;
use crate::font_detector::{detect_available_fonts, is_font_available, AvailableFont};

/// Cached font list — computed once on first call, then reused.
static FONT_CACHE: OnceLock<Vec<AvailableFont>> = OnceLock::new();

/// Returns a list of available terminal-suitable fonts on the system.
/// The result is cached after the first call and computed off the main thread.
#[tauri::command]
pub async fn get_available_fonts() -> Result<Vec<AvailableFont>, AppError> {
    if let Some(cached) = FONT_CACHE.get() {
        return Ok(cached.clone());
    }
    let fonts = tokio::task::spawn_blocking(detect_available_fonts)
        .await
        .map_err(|e| AppError::Io(format!("Font detection task failed: {e}")))?;
    // Use get_or_init to handle the race if two calls happen concurrently
    Ok(FONT_CACHE.get_or_init(|| fonts).clone())
}

/// Checks if a specific font family is available on the system.
#[tauri::command]
pub fn check_font_available(family: String) -> bool {
    is_font_available(&family)
}
