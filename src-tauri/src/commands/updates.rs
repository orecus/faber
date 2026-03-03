use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;
use tracing::{error, info, warn};

use crate::error::AppError;
use crate::pty::{self, PtyState};

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Clone, Serialize)]
struct UpdateDownloadProgress {
    progress: f64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    custom_endpoint: Option<String>,
) -> Result<UpdateInfo, AppError> {
    let current_version = app.package_info().version.to_string();
    info!(current_version = %current_version, "Checking for updates...");

    let mut builder = app.updater_builder();
    if let Some(ref endpoint) = custom_endpoint {
        info!(endpoint = %endpoint, "Using custom update endpoint");
        let url: url::Url = endpoint
            .parse()
            .map_err(|e: url::ParseError| AppError::Validation(e.to_string()))?;
        builder = builder
            .endpoints(vec![url])
            .map_err(|e| AppError::Io(format!("Invalid endpoint: {e}")))?;
    }

    let updater = builder
        .build()
        .map_err(|e| AppError::Io(format!("Failed to build updater: {e}")))?;

    match updater.check().await {
        Ok(Some(update)) => {
            info!(
                latest_version = %update.version,
                current_version = %current_version,
                "Update available"
            );
            Ok(UpdateInfo {
                available: true,
                current_version,
                latest_version: update.version.clone(),
                release_notes: update.body.clone(),
                date: update.date.map(|d| d.to_string()),
            })
        }
        Ok(None) => {
            info!("No update available, already on latest version");
            Ok(UpdateInfo {
                available: false,
                current_version: current_version.clone(),
                latest_version: current_version,
                release_notes: None,
                date: None,
            })
        }
        Err(e) => {
            error!(error = %e, "Update check failed");
            Err(AppError::Io(format!("Update check failed: {e}")))
        }
    }
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    pty_state: State<'_, PtyState>,
    custom_endpoint: Option<String>,
) -> Result<(), AppError> {
    info!("Starting update download and install process");

    let mut builder = app.updater_builder();
    if let Some(ref endpoint) = custom_endpoint {
        info!(endpoint = %endpoint, "Using custom update endpoint");
        let url: url::Url = endpoint
            .parse()
            .map_err(|e: url::ParseError| AppError::Validation(e.to_string()))?;
        builder = builder
            .endpoints(vec![url])
            .map_err(|e| AppError::Io(format!("Invalid endpoint: {e}")))?;
    }

    let updater = builder
        .build()
        .map_err(|e| AppError::Io(format!("Failed to build updater: {e}")))?;

    info!("Checking for available update before download...");
    let update = updater
        .check()
        .await
        .map_err(|e| {
            error!(error = %e, "Update check failed during download flow");
            AppError::Io(format!("Update check failed: {e}"))
        })?
        .ok_or_else(|| {
            warn!("No update available when trying to download");
            AppError::NotFound("No update available".to_string())
        })?;

    info!(
        version = %update.version,
        "Update found, preparing to download"
    );

    // Kill all active PTY sessions before downloading/installing
    let session_ids = pty::list_sessions(&pty_state)?;
    if !session_ids.is_empty() {
        info!(count = session_ids.len(), "Killing active PTY sessions before update");
        for sid in &session_ids {
            let _ = pty::kill(&pty_state, sid);
        }
    }

    // Download and install with progress reporting
    info!("Starting update download...");
    let app_handle = app.clone();
    let app_install = app.clone();
    let mut downloaded: usize = 0;
    update
        .download_and_install(
            move |chunk_len, content_length| {
                downloaded += chunk_len;
                let progress = if let Some(total) = content_length {
                    (downloaded as f64 / total as f64) * 100.0
                } else {
                    0.0
                };
                if downloaded == chunk_len {
                    // Log on first chunk
                    info!(
                        total_bytes = content_length,
                        "Download started"
                    );
                }
                let _ = app_handle.emit(
                    "update-download-progress",
                    UpdateDownloadProgress {
                        progress,
                        total: content_length,
                    },
                );
            },
            move || {
                info!("Download complete, installing update...");
                let _ = app_install.emit("update-installing", ());
            },
        )
        .await
        .map_err(|e| {
            error!(error = %e, "Update download/install failed");
            AppError::Io(format!("Update failed: {e}"))
        })?;

    info!("Update installed successfully, restarting app");
    app.restart();
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}
