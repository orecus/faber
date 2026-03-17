use rusqlite::Connection;

const MIGRATION_001: &str = r#"
CREATE TABLE projects (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    path                  TEXT NOT NULL UNIQUE,
    default_agent         TEXT,
    default_model         TEXT,
    branch_naming_pattern TEXT DEFAULT 'feat/{{task_id}}-{{task_slug}}',
    instruction_file_path TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
    id              TEXT NOT NULL,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_file_path  TEXT,
    title           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'backlog'
                    CHECK(status IN ('backlog','ready','in-progress','in-review','done','archived')),
    priority        TEXT NOT NULL DEFAULT 'P2'
                    CHECK(priority IN ('P0','P1','P2')),
    agent           TEXT,
    model           TEXT,
    branch          TEXT,
    worktree_path   TEXT,
    github_issue    TEXT,
    depends_on      TEXT,
    labels          TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id, project_id)
);

CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id         TEXT,
    mode            TEXT NOT NULL CHECK(mode IN ('task','plan','vibe')),
    agent           TEXT NOT NULL,
    model           TEXT,
    status          TEXT NOT NULL DEFAULT 'starting'
                    CHECK(status IN ('starting','running','paused','stopped','finished','error')),
    pid             INTEGER,
    worktree_path   TEXT,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at        TEXT
);

CREATE TABLE settings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    scope     TEXT NOT NULL CHECK(scope IN ('global','project')),
    scope_id  TEXT,
    key       TEXT NOT NULL,
    value     TEXT NOT NULL
);

CREATE TABLE agent_configs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scope       TEXT NOT NULL CHECK(scope IN ('global','project','task')),
    scope_id    TEXT,
    agent_name  TEXT NOT NULL,
    model       TEXT,
    flags       TEXT,
    env_vars    TEXT
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(project_id, status);
CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_task ON sessions(task_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_settings_scope ON settings(scope, scope_id);
CREATE UNIQUE INDEX uq_settings_scope_key ON settings(scope, COALESCE(scope_id, ''), key);
CREATE INDEX idx_agent_configs_scope ON agent_configs(scope, scope_id);
CREATE UNIQUE INDEX uq_agent_configs_scope_name ON agent_configs(scope, COALESCE(scope_id, ''), agent_name);
"#;

const MIGRATION_002: &str = r#"
-- Recreate sessions table with 'shell' added to mode CHECK constraint
CREATE TABLE sessions_new (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id         TEXT,
    mode            TEXT NOT NULL CHECK(mode IN ('task','plan','vibe','shell')),
    agent           TEXT NOT NULL,
    model           TEXT,
    status          TEXT NOT NULL DEFAULT 'starting'
                    CHECK(status IN ('starting','running','paused','stopped','finished','error')),
    pid             INTEGER,
    worktree_path   TEXT,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at        TEXT
);

INSERT INTO sessions_new SELECT * FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_task ON sessions(task_id);
CREATE INDEX idx_sessions_status ON sessions(status);
"#;

const MIGRATION_003: &str = r#"
ALTER TABLE projects ADD COLUMN icon_path TEXT;
"#;

const MIGRATION_004: &str = r#"
ALTER TABLE projects ADD COLUMN color TEXT;
"#;

const MIGRATION_005: &str = r#"
ALTER TABLE sessions ADD COLUMN mcp_connected INTEGER NOT NULL DEFAULT 0;
"#;

const MIGRATION_006: &str = r#"
ALTER TABLE sessions ADD COLUMN name TEXT;
"#;

const MIGRATION_007: &str = r#"
ALTER TABLE tasks ADD COLUMN github_pr TEXT;
"#;

const MIGRATION_008: &str = r#"
-- Remove 'plan' from session mode CHECK constraint
CREATE TABLE sessions_new (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id         TEXT,
    mode            TEXT NOT NULL CHECK(mode IN ('task','vibe','shell')),
    agent           TEXT NOT NULL,
    model           TEXT,
    status          TEXT NOT NULL DEFAULT 'starting'
                    CHECK(status IN ('starting','running','paused','stopped','finished','error')),
    pid             INTEGER,
    worktree_path   TEXT,
    mcp_connected   INTEGER NOT NULL DEFAULT 0,
    name            TEXT,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at        TEXT
);

INSERT INTO sessions_new SELECT * FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_task ON sessions(task_id);
CREATE INDEX idx_sessions_status ON sessions(status);
"#;

const MIGRATION_009: &str = r#"
-- Add 'research' to session mode CHECK constraint
CREATE TABLE sessions_new (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id         TEXT,
    mode            TEXT NOT NULL CHECK(mode IN ('task','vibe','shell','research')),
    agent           TEXT NOT NULL,
    model           TEXT,
    status          TEXT NOT NULL DEFAULT 'starting'
                    CHECK(status IN ('starting','running','paused','stopped','finished','error')),
    pid             INTEGER,
    worktree_path   TEXT,
    mcp_connected   INTEGER NOT NULL DEFAULT 0,
    name            TEXT,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at        TEXT
);

INSERT INTO sessions_new SELECT * FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_task ON sessions(task_id);
CREATE INDEX idx_sessions_status ON sessions(status);
"#;

const MIGRATION_010: &str = r#"
ALTER TABLE tasks ADD COLUMN body TEXT DEFAULT '';
"#;

const MIGRATION_011: &str = r#"
CREATE TABLE task_activity (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    project_id  TEXT NOT NULL,
    session_id  TEXT,
    event_type  TEXT NOT NULL CHECK(event_type IN ('status','progress','files_changed','error','waiting','complete')),
    timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
    data        TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_task_activity_task ON task_activity(task_id, project_id);
CREATE INDEX idx_task_activity_session ON task_activity(session_id);
CREATE INDEX idx_task_activity_timestamp ON task_activity(timestamp);
"#;

const MIGRATION_012: &str = r#"
ALTER TABLE sessions ADD COLUMN transport TEXT NOT NULL DEFAULT 'pty'
    CHECK(transport IN ('pty','acp'));
"#;

const MIGRATION_013: &str = r#"
CREATE TABLE acp_permission_rules (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    capability      TEXT NOT NULL,
    path_pattern    TEXT,
    command_pattern TEXT,
    action          TEXT NOT NULL DEFAULT 'ask'
                    CHECK(action IN ('auto_approve','ask','deny')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_acp_perm_rules_project ON acp_permission_rules(project_id);

CREATE TABLE acp_permission_log (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    project_id  TEXT NOT NULL,
    capability  TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    decision    TEXT NOT NULL CHECK(decision IN ('approved','denied','auto_approved','auto_denied')),
    decided_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_acp_perm_log_project ON acp_permission_log(project_id);
CREATE INDEX idx_acp_perm_log_session ON acp_permission_log(session_id);
CREATE INDEX idx_acp_perm_log_timestamp ON acp_permission_log(decided_at);
"#;

// Add 'chat' to session mode CHECK constraint
const MIGRATION_014: &str = r#"
-- Add 'chat' to session mode CHECK constraint
CREATE TABLE sessions_new (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id         TEXT,
    mode            TEXT NOT NULL CHECK(mode IN ('task','vibe','shell','research','chat')),
    transport       TEXT NOT NULL DEFAULT 'pty' CHECK(transport IN ('pty','acp')),
    agent           TEXT NOT NULL,
    model           TEXT,
    status          TEXT NOT NULL DEFAULT 'starting'
                    CHECK(status IN ('starting','running','paused','stopped','finished','error')),
    pid             INTEGER,
    worktree_path   TEXT,
    mcp_connected   INTEGER NOT NULL DEFAULT 0,
    name            TEXT,
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at        TEXT
);

INSERT INTO sessions_new SELECT * FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_task ON sessions(task_id);
CREATE INDEX idx_sessions_status ON sessions(status);
"#;

const MIGRATION_015: &str = r#"
-- Rename ACP "continuous mode" policy setting to "trust mode" to avoid confusion
-- with Faber's task-queue continuous mode feature.
UPDATE settings SET key = REPLACE(key, 'acp_continuous_mode_policy', 'acp_trust_mode_policy')
WHERE key LIKE 'acp_continuous_mode_policy%';
"#;

const MIGRATIONS: &[&str] = &[MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004, MIGRATION_005, MIGRATION_006, MIGRATION_007, MIGRATION_008, MIGRATION_009, MIGRATION_010, MIGRATION_011, MIGRATION_012, MIGRATION_013, MIGRATION_014, MIGRATION_015];

pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL
        );",
    )?;

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )?;

    let total = MIGRATIONS.len() as i64;
    let mut applied = 0;

    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let version = (i + 1) as i64;
        if version > current {
            conn.execute_batch(sql)?;
            conn.execute("INSERT INTO schema_version (version) VALUES (?1)", [version])?;
            tracing::debug!(version, "Applied migration");
            applied += 1;
        }
    }

    if applied > 0 {
        tracing::info!(from = current, to = total, applied, "Database migrations applied");
    } else {
        tracing::debug!(version = current, "Database schema up to date");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_runs_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run(&conn).unwrap();

        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 15);

        // Running again is a no-op
        run(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 15);
    }
}
