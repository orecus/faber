//! File watcher for `.agents/tasks/` directory.
//!
//! Watches for external changes (git checkout, manual edits, agent edits) to
//! task markdown files and auto-syncs them to the database. This replaces the
//! manual "Sync" button previously available in the Dashboard UI.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::db::DbState;
use crate::tasks;

/// Tracks active file watchers, keyed by project ID.
pub type TaskWatcherState = Arc<Mutex<TaskWatcherRegistry>>;

pub fn new_state() -> TaskWatcherState {
    Arc::new(Mutex::new(TaskWatcherRegistry::default()))
}

#[derive(Default)]
pub struct TaskWatcherRegistry {
    watchers: HashMap<String, WatcherEntry>,
}

#[allow(dead_code)]
struct WatcherEntry {
    _watcher: RecommendedWatcher,
    /// Timestamps of files recently written by the app, to avoid re-processing
    /// our own writes. Keyed by file path.
    written_by_app: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl TaskWatcherRegistry {
    /// Start watching the tasks directory for a project.
    /// No-op if a watcher is already active or disk files are disabled.
    pub fn start(
        &mut self,
        project_id: String,
        project_path: PathBuf,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        // Check if disk files are enabled
        {
            let db_state = app_handle.state::<DbState>();
            let conn = db_state
                .lock()
                .map_err(|e| format!("DB lock failed: {e}"))?;
            if !tasks::task_files_enabled(&conn, &project_id) {
                debug!(project_id, "Task file watcher skipped: disk files disabled");
                return Ok(());
            }
        }

        if self.watchers.contains_key(&project_id) {
            debug!(project_id, "Task file watcher already active");
            return Ok(());
        }

        let tasks_dir = project_path.join(".agents").join("tasks");

        // Don't start watcher if tasks directory doesn't exist
        if !tasks_dir.is_dir() {
            debug!(?tasks_dir, "Tasks directory does not exist, skipping watcher");
            return Ok(());
        }

        let written_by_app: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let written_by_app_clone = written_by_app.clone();

        let pid = project_id.clone();
        let handle = app_handle.clone();

        let mut watcher = notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                match res {
                    Ok(event) => {
                        handle_fs_event(
                            event,
                            &pid,
                            &tasks_dir,
                            &handle,
                            &written_by_app_clone,
                        );
                    }
                    Err(e) => {
                        warn!(%e, "Task file watcher error");
                    }
                }
            },
        )
        .map_err(|e| format!("Failed to create file watcher: {e}"))?;

        let watch_dir = project_path.join(".agents").join("tasks");
        watcher
            .watch(&watch_dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch {}: {e}", watch_dir.display()))?;

        info!(project_id = %project_id, dir = %watch_dir.display(), "Task file watcher started");

        self.watchers.insert(
            project_id,
            WatcherEntry {
                _watcher: watcher,
                written_by_app,
            },
        );

        Ok(())
    }

    /// Stop watching for a project.
    pub fn stop(&mut self, project_id: &str) {
        if self.watchers.remove(project_id).is_some() {
            info!(project_id, "Task file watcher stopped");
        }
    }

    /// Mark a file as recently written by the app (to avoid re-processing).
    #[allow(dead_code)]
    pub async fn mark_written(&self, project_id: &str, file_path: PathBuf) {
        if let Some(entry) = self.watchers.get(project_id) {
            let mut map = entry.written_by_app.lock().await;
            map.insert(file_path, Instant::now());
        }
    }
}

/// Handle a filesystem event from the notify watcher.
fn handle_fs_event(
    event: notify::Event,
    project_id: &str,
    tasks_dir: &Path,
    app_handle: &tauri::AppHandle,
    written_by_app: &Arc<Mutex<HashMap<PathBuf, Instant>>>,
) {
    // Only react to create, modify, and remove events
    let dominated = matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    );
    if !dominated {
        return;
    }

    // Check if any relevant .md files are involved
    let md_paths: Vec<&Path> = event
        .paths
        .iter()
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
        .map(|p| p.as_path())
        .collect();

    if md_paths.is_empty() {
        return;
    }

    // Check if this was our own write (debounce window: 2 seconds)
    {
        let map = written_by_app.blocking_lock();
        let dominated_by_app = md_paths.iter().all(|p| {
            map.get(*p)
                .map(|t| t.elapsed() < Duration::from_secs(2))
                .unwrap_or(false)
        });
        if dominated_by_app {
            debug!("Ignoring own write to task files");
            return;
        }
    }

    // Debounce: use a simple 500ms delay before processing
    // (notify may send multiple events for a single file save)
    std::thread::sleep(Duration::from_millis(500));

    // Re-sync the tasks directory
    debug!(project_id, "External task file change detected, syncing");
    let db_state: tauri::State<'_, DbState> = app_handle.state::<DbState>();
    let db_ref = db_state.inner();
    match db_ref.lock() {
        Ok(conn) => {
            match tasks::scan_and_sync(&conn, project_id, tasks_dir) {
                Ok(count) => {
                    debug!(project_id, count, "Task file sync complete");
                    // Emit event so frontend refreshes
                    if let Err(e) = app_handle.emit("tasks-updated", project_id) {
                        warn!(%e, "Failed to emit tasks-updated event");
                    }
                }
                Err(e) => {
                    error!(%e, project_id, "Task file sync failed");
                }
            }
        }
        Err(e) => {
            error!(%e, "Failed to lock DB for task file sync");
        }
    }
}
