//! File watcher for `.agents/faber.json`.
//!
//! Watches for external changes (manual edits, git checkout, other tools) to the
//! project config file and re-syncs to the DB + emits a Tauri event so the
//! frontend can reload settings.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::db::DbState;
use crate::project_config;

/// Tracks active config file watchers, keyed by project ID.
pub type ConfigWatcherState = Arc<Mutex<ConfigWatcherRegistry>>;

pub fn new_state() -> ConfigWatcherState {
    Arc::new(Mutex::new(ConfigWatcherRegistry::default()))
}

#[derive(Default)]
pub struct ConfigWatcherRegistry {
    watchers: HashMap<String, WatcherEntry>,
}

#[allow(dead_code)]
struct WatcherEntry {
    _watcher: RecommendedWatcher,
    /// Timestamp of last write by the app, to avoid re-processing our own saves.
    last_app_write: Arc<Mutex<Option<Instant>>>,
}

impl ConfigWatcherRegistry {
    /// Start watching `.agents/faber.json` for a project.
    /// No-op if a watcher is already active.
    pub fn start(
        &mut self,
        project_id: String,
        project_path: PathBuf,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        if self.watchers.contains_key(&project_id) {
            debug!(project_id, "Config file watcher already active");
            return Ok(());
        }

        let agents_dir = project_path.join(".agents");

        // Don't start watcher if .agents directory doesn't exist yet.
        // It will be created when ensure_config runs.
        if !agents_dir.is_dir() {
            debug!(?agents_dir, "No .agents dir yet, skipping config watcher");
            return Ok(());
        }

        let last_app_write: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
        let last_app_write_clone = last_app_write.clone();

        let pid = project_id.clone();
        let handle = app_handle.clone();
        let config_file = project_config::config_path(&project_path);

        let mut watcher = notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                match res {
                    Ok(event) => {
                        handle_fs_event(
                            event,
                            &pid,
                            &config_file,
                            &project_path,
                            &handle,
                            &last_app_write_clone,
                        );
                    }
                    Err(e) => {
                        warn!(%e, "Config file watcher error");
                    }
                }
            },
        )
        .map_err(|e| format!("Failed to create config watcher: {e}"))?;

        watcher
            .watch(&agents_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch {}: {e}", agents_dir.display()))?;

        info!(project_id = %project_id, dir = %agents_dir.display(), "Config file watcher started");

        self.watchers.insert(
            project_id,
            WatcherEntry {
                _watcher: watcher,
                last_app_write,
            },
        );

        Ok(())
    }

    /// Stop watching for a project.
    pub fn stop(&mut self, project_id: &str) {
        if self.watchers.remove(project_id).is_some() {
            info!(project_id, "Config file watcher stopped");
        }
    }

    /// Mark that we just wrote the config file (to suppress re-processing).
    #[allow(dead_code)]
    pub async fn mark_written(&self, project_id: &str) {
        if let Some(entry) = self.watchers.get(project_id) {
            let mut ts = entry.last_app_write.lock().await;
            *ts = Some(Instant::now());
        }
    }
}

/// Handle a filesystem event from the notify watcher.
fn handle_fs_event(
    event: notify::Event,
    project_id: &str,
    config_file: &Path,
    project_path: &Path,
    app_handle: &tauri::AppHandle,
    last_app_write: &Arc<Mutex<Option<Instant>>>,
) {
    // Only react to create/modify events
    let dominated = matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_)
    );
    if !dominated {
        return;
    }

    // Check if any path matches faber.json
    let is_config = event
        .paths
        .iter()
        .any(|p| p.file_name().and_then(|n| n.to_str()) == Some("faber.json"));
    if !is_config {
        return;
    }

    // Check if this was our own write (debounce window: 2 seconds)
    {
        let ts = last_app_write.blocking_lock();
        if let Some(t) = *ts {
            if t.elapsed() < Duration::from_secs(2) {
                debug!("Ignoring own write to faber.json");
                return;
            }
        }
    }

    // Debounce: wait 500ms for editors that write multiple times
    std::thread::sleep(Duration::from_millis(500));

    // Verify file still exists (could have been a transient event)
    if !config_file.is_file() {
        return;
    }

    debug!(project_id, "External faber.json change detected, syncing");

    // Load config and sync to DB
    let cfg = project_config::load(project_path);

    let db_state: tauri::State<'_, DbState> = app_handle.state::<DbState>();
    match db_state.inner().lock() {
        Ok(conn) => {
            if let Err(e) = project_config::sync_to_db(&conn, project_id, project_path, &cfg) {
                error!(%e, project_id, "Config sync to DB failed");
                return;
            }
            debug!(project_id, "Config file synced to DB");

            // Emit event so frontend refreshes settings
            if let Err(e) = app_handle.emit("project-config-changed", project_id) {
                warn!(%e, "Failed to emit project-config-changed event");
            }
        }
        Err(e) => {
            error!(%e, "Failed to lock DB for config sync");
        }
    }
}
