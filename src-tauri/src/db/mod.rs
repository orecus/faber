pub mod agent_configs;
pub mod migrations;
pub mod models;
pub mod projects;
pub mod sessions;
pub mod settings;
pub mod tasks;

use rusqlite::Connection;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

pub type DbState = Mutex<Connection>;

fn configure(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;",
    )?;
    Ok(())
}

/// Open (or create) the database at `path`, run migrations, return a `Mutex<Connection>`.
pub fn init(path: &Path) -> Result<DbState, rusqlite::Error> {
    tracing::debug!(path = %path.display(), "Opening database");
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrations::run(&conn)?;

    // Restrict DB file permissions to owner-only on Unix (0600)
    // to prevent other local users from reading session data or settings.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(path, perms);
        }
    }

    Ok(Mutex::new(conn))
}

/// In-memory database for tests.
#[cfg(test)]
pub fn init_memory() -> Result<DbState, rusqlite::Error> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrations::run(&conn)?;
    Ok(Mutex::new(conn))
}

/// Generate a text ID with the given prefix, a hex timestamp, and a counter to avoid collisions.
pub fn generate_id(prefix: &str) -> String {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}_{ts:x}_{seq:x}")
}
