use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as TokioMutex;

use crate::agent::{self, AgentLaunchConfig};
use crate::commands::tasks::do_update_task_status;
use crate::continuous;
use crate::db;
use crate::db::models::{
    NewSession, Session, SessionMode, SessionStatus,
};
use crate::error::AppError;
use crate::git::{self, BranchNameVars, DEFAULT_BRANCH_PATTERN};
use crate::mcp;
use crate::mcp::McpState;
use crate::mcp::server::McpSessionData;
use crate::pty::{self, PtyState};
use crate::tasks;

// ── MCP tool descriptions (shared between system prompt and instruction files) ──

/// Core MCP tool description shared by both the system prompt and instruction file section.
/// This is the single source of truth — both constants below are derived from it.
const MCP_TOOLS_DESCRIPTION: &str = "\
You have MCP tools provided by the Faber IDE for reporting your progress. \
You MUST use them throughout your workflow:

- `report_status(status, message, activity?)` — Call when you start working (status: \"working\"). Optional activity: \"researching\", \"exploring\", \"planning\", \"coding\", \"testing\", \"debugging\", \"reviewing\".
- `report_progress(current_step, total_steps, description)` — Call before each step
- `report_files_changed(files)` — Call after modifying files
- `report_error(error, details?)` — Call if you encounter an error or blocker
- `report_waiting(question)` — Call if you need user input
- `report_complete(summary)` — Call when finished
- `get_task(task_id?)` — Fetch task metadata and body. Omit task_id to get current session's task.
- `update_task(task_id?, status?, priority?, title?, labels?, depends_on?, github_issue?, github_pr?)` — Update task metadata (status, priority, labels, etc.). Omit task_id to use current session's task.
- `update_task_plan(plan, task_id?)` — Update the implementation plan in the task file.
- `create_task(title, body?, priority?, labels?, depends_on?)` — Create a new task in the current project (always created as backlog).
- `list_tasks(status?, label?)` — List all tasks in the current project with optional filters. Returns compact metadata (no body).

Always call `report_status` first, then `report_progress` as you work, \
and `report_complete` when done.";

// ── Agent instruction file management ──

const MCP_INSTRUCTION_MARKER_START: &str = "<!-- Faber:MCP -->";
const MCP_INSTRUCTION_MARKER_END: &str = "<!-- /Faber:MCP -->";

/// Build the MCP system prompt string (for agents that support --system-prompt).
fn mcp_system_prompt_text() -> String {
    MCP_TOOLS_DESCRIPTION.to_string()
}

/// Build the MCP instruction section for agent instruction files (CLAUDE.md, etc.).
fn mcp_instruction_section() -> String {
    format!(
        "{}\n## Faber Integration\n\n{}\n{}",
        MCP_INSTRUCTION_MARKER_START, MCP_TOOLS_DESCRIPTION, MCP_INSTRUCTION_MARKER_END
    )
}

/// Map agent names to their native instruction file names.
pub fn agent_instruction_filename(agent_name: &str) -> Option<&'static str> {
    match agent_name {
        "claude-code" => Some("CLAUDE.md"),
        "codex" => Some("AGENTS.md"),
        "copilot" => Some("AGENTS.md"),
        "cursor-agent" => Some("AGENTS.md"),
        "gemini" => Some("GEMINI.md"),
        "opencode" => Some("AGENTS.md"),
        _ => None,
    }
}

/// Update or insert the Faber MCP section in content.
/// Returns the updated content string.
pub fn upsert_mcp_section(content: &str, section: &str) -> String {
    if let (Some(start), Some(end)) = (
        content.find(MCP_INSTRUCTION_MARKER_START),
        content.find(MCP_INSTRUCTION_MARKER_END),
    ) {
        let end = end + MCP_INSTRUCTION_MARKER_END.len();
        let mut result = String::with_capacity(content.len());
        result.push_str(&content[..start]);
        result.push_str(section);
        result.push_str(&content[end..]);
        result
    } else {
        // Append with a blank line separator
        let mut result = content.to_string();
        if !result.is_empty() && !result.ends_with('\n') {
            result.push('\n');
        }
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(section);
        result.push('\n');
        result
    }
}

/// Write or update the MCP section in a single instruction file.
pub fn write_instruction_file(dir: &Path, filename: &str) {
    let path = dir.join(filename);
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let section = mcp_instruction_section();
    let updated = upsert_mcp_section(&existing, &section);
    if updated != existing {
        let _ = std::fs::write(&path, &updated);
        tracing::info!(filename, dir = %dir.display(), "Updated instruction file");
    }
}

// ── Variable interpolation ──

/// Replace `{{key}}` placeholders with values from `vars`.
/// Unknown keys are left as-is.
pub fn interpolate_vars(template: &str, vars: &HashMap<&str, &str>) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("{{{{{key}}}}}"), value);
    }
    result
}

// ── Event payloads ──

#[derive(Clone, Serialize)]
pub(crate) struct SessionStatusChanged {
    pub session_id: String,
    pub old_status: SessionStatus,
    pub new_status: SessionStatus,
}

/// Returns the MCP system prompt if the agent supports the system prompt flag.
fn mcp_system_prompt(adapter: &dyn agent::AgentAdapter, mcp_connected: bool) -> Option<String> {
    if mcp_connected && adapter.supports_system_prompt_flag() {
        Some(mcp_system_prompt_text())
    } else {
        None
    }
}

// ── MCP helpers ──

/// Get the MCP server port. Call this BEFORE acquiring the DB lock to avoid
/// nested mutex issues. Returns 0 if the MCP server is not running.
pub fn get_mcp_port(mcp_state: &Arc<TokioMutex<McpState>>) -> u16 {
    let guard = mcp_state.blocking_lock();
    guard.port
}

/// MCP connection info returned by `inject_mcp`.
struct McpConnection {
    url: String,
    secret: String,
}

/// Inject MCP config for a session.
/// Returns `Some(McpConnection)` on success so the caller can add the URL and secret to the PTY env.
///
/// IMPORTANT: `mcp_port` should be obtained via `get_mcp_port()` BEFORE any std::sync::Mutex
/// is held, to avoid blocking_lock contention with the Tokio mutex.
fn inject_mcp(
    mcp_state: &Arc<TokioMutex<McpState>>,
    mcp_port: u16,
    session_id: &str,
    cwd: &Path,
    agent_name: &str,
    project_id: Option<&str>,
    task_id: Option<&str>,
) -> Option<McpConnection> {
    if mcp_port == 0 {
        tracing::warn!("MCP server not running, skipping MCP injection");
        return None;
    }

    match mcp::server::write_mcp_config(cwd, agent_name) {
        Ok(Some(_)) => {
            let mut guard = mcp_state.blocking_lock();
            guard.sessions.insert(session_id.to_string(), McpSessionData {
                project_id: project_id.map(String::from),
                task_id: task_id.map(String::from),
                ..Default::default()
            });
            let secret = guard.secret.clone();
            Some(McpConnection {
                url: mcp::server::build_session_mcp_url(mcp_port, session_id),
                secret,
            })
        }
        Ok(None) => None,
        Err(e) => {
            tracing::warn!(%e, "Failed to write MCP config");
            None
        }
    }
}

// ── Task session ──

#[allow(clippy::too_many_arguments)]
pub fn start_task_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    mcp_port: u16,
    project_id: &str,
    task_id: &str,
    agent_override: Option<&str>,
    model_override: Option<&str>,
    create_worktree: bool,
    base_branch: Option<&str>,
    user_prompt: Option<&str>,
) -> Result<Session, AppError> {
    // 1. Fetch project
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    // 2. Fetch task
    let task = db::tasks::get(conn, task_id, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;

    // Read task file content if available
    let task_file_content = task
        .task_file_path
        .as_ref()
        .and_then(|p| {
            let path = Path::new(p);
            if path.is_file() {
                std::fs::read_to_string(path).ok()
            } else {
                None
            }
        });

    // Parse frontmatter for agent/model/branch hints
    let parsed = task_file_content.as_ref().and_then(|content| {
        task.task_file_path
            .as_ref()
            .and_then(|p| tasks::parse_task_file(content, Path::new(p)).ok())
    });

    // 3. Resolve agent: override → task.agent → project.default_agent → "claude-code"
    let agent_name = agent_override
        .or(task.agent.as_deref())
        .or(project.default_agent.as_deref())
        .unwrap_or("claude-code");

    let adapter = agent::get_adapter(agent_name)
        .ok_or_else(|| AppError::NotFound(format!("Agent adapter: {agent_name}")))?;

    // 4. Resolve agent config cascade
    let agent_config = db::agent_configs::resolve(conn, Some(task_id), project_id, agent_name)?;

    // 5. Determine model: override → agent_config.model → task.model → project.default_model
    // When nothing is explicitly set, model stays None and no --model flag is passed,
    // letting the agent CLI use its own built-in default.
    let model = model_override
        .map(String::from)
        .or_else(|| agent_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| task.model.clone())
        .or_else(|| project.default_model.clone());

    // 6. Optionally create worktree
    let (worktree_path, _branch_name) = if create_worktree {
        let branch = if let Some(branch) = task.branch.as_deref().or(
            parsed
                .as_ref()
                .and_then(|p| p.frontmatter.branch.as_deref()),
        ) {
            branch.to_string()
        } else {
            let pattern = project
                .branch_naming_pattern
                .as_deref()
                .unwrap_or(DEFAULT_BRANCH_PATTERN);
            let slug = tasks::slugify(&task.title);
            git::resolve_branch_name(
                pattern,
                &BranchNameVars {
                    task_id: Some(task_id),
                    task_slug: Some(&slug),
                },
            )
        };

        let repo_path = Path::new(&project.path);
        let worktree = git::create_worktree(repo_path, &branch, base_branch, None)?;

        // Update task worktree path in DB
        let _ = db::tasks::update_worktree(conn, task_id, project_id, Some(&worktree.path));

        (Some(worktree.path), branch)
    } else {
        (None, String::new())
    };

    let cwd = worktree_path.as_deref().unwrap_or(&project.path);

    // 7. Pre-generate session ID for MCP URL
    let session_id = db::generate_id("sess");

    // 8. Inject MCP config (session-agnostic file + session-specific URL)
    let mcp_conn = inject_mcp(mcp_state, mcp_port, &session_id, Path::new(cwd), agent_name, Some(project_id), Some(task_id));

    // 9. Validate task file exists
    let task_file_path_str = task.task_file_path.as_deref()
        .ok_or_else(|| AppError::Validation(format!("Task {task_id} has no task file path")))?;
    if !Path::new(task_file_path_str).is_file() {
        return Err(AppError::Validation(format!(
            "Task file does not exist: {task_file_path_str}"
        )));
    }

    // 10. Generate user prompt from template (use provided or auto-generate)
    let worktree_hint = worktree_path.as_deref().map(|wt| {
        format!(
            "You are working in worktree {wt}, read the task by using the provided MCP tools \
             and work on the task within the assigned worktree."
        )
    }).unwrap_or_default();

    let user_prompt_str = if user_prompt.is_none_or(|s| s.trim().is_empty()) {
        let template = crate::commands::prompts::get_session_prompt(conn, "task");
        let mut vars = HashMap::new();
        vars.insert("task_id", task_id);
        vars.insert("worktree_hint", worktree_hint.as_str());
        Some(interpolate_vars(&template.prompt, &vars))
    } else {
        let trimmed = user_prompt.unwrap().trim().to_string();
        if worktree_hint.is_empty() {
            Some(trimmed)
        } else {
            Some(format!("{trimmed} {worktree_hint}"))
        }
    };

    // 10. Build launch spec
    let extra_flags = agent_config
        .as_ref()
        .map(|c| c.flags.clone())
        .unwrap_or_default();
    let mut extra_env: HashMap<String, String> = HashMap::new();

    // Inject session-specific MCP URL and auth secret into PTY env
    if let Some(conn) = &mcp_conn {
        extra_env.insert("FABER_MCP_URL".to_string(), conn.url.clone());
        extra_env.insert("FABER_MCP_SECRET".to_string(), conn.secret.clone());
    }

    let launch_config = AgentLaunchConfig {
        system_prompt: mcp_system_prompt(adapter.as_ref(), mcp_conn.is_some()),
        prompt: user_prompt_str,
        model: model.clone(),
        extra_flags,
        extra_env,
    };
    let spec = adapter.build_launch_spec(&launch_config);

    // 11. Create session record with pre-generated ID
    let new_session = NewSession {
        project_id: project_id.to_string(),
        task_id: Some(task_id.to_string()),
        name: Some(task.id.clone()),
        mode: SessionMode::Task,
        agent: agent_name.to_string(),
        model,
        worktree_path: worktree_path.clone(),
    };
    let session = db::sessions::create_with_id(conn, &session_id, &new_session)?;

    // Mark MCP connected in DB
    if mcp_conn.is_some() {
        let _ = db::sessions::update_mcp_connected(conn, &session.id, true);
    }

    // 12. Spawn PTY (wrap in login shell on Unix so agents get proper PATH/locale)
    pty::spawn(
        pty_state,
        app,
        session.id.clone(),
        &spec.command,
        &spec.args,
        Some(cwd),
        Some(&spec.env),
        80,
        24,
        cfg!(unix),
    )?;

    // 13. Update session status to Running
    db::sessions::update_status(conn, &session.id, SessionStatus::Running)?;

    // 14. Update task status to in-progress (file + DB + TODOS.md)
    // GitHub sync context is captured under lock, executed after lock release in caller.
    let (github_sync_ctx, todos_update) = match do_update_task_status(conn, project_id, task_id, "in-progress") {
        Ok((task, sync_ctx, todos)) => {
            let _ = app.emit("task-updated", &task);
            (sync_ctx, todos)
        }
        Err(e) => { tracing::error!(%e, task_id, "Failed to mark task as in-progress"); (None, None) }
    };
    // Write TODOS.md outside the hot path (content generated under lock)
    if let Some(t) = todos_update { t.write(); }

    // 15. Emit event
    let session = db::sessions::get(conn, &session.id)?
        .ok_or_else(|| AppError::Database("Session disappeared after creation".into()))?;
    let _ = app.emit("session-started", &session);

    // Execute GitHub sync (best-effort). This happens under the caller's DB lock,
    // which is acceptable here since session launch already does heavy I/O (PTY, worktree).
    // The critical fix is in the `update_task_status` IPC command path.
    if let Some(ctx) = github_sync_ctx {
        crate::commands::tasks::execute_github_sync(ctx);
    }

    Ok(session)
}

// ── Vibe session ──

pub struct VibeSessionOpts<'a> {
    pub agent_name: Option<&'a str>,
    pub model: Option<&'a str>,
    pub create_worktree: bool,
    pub base_branch: Option<&'a str>,
    pub user_prompt: Option<&'a str>,
}

pub fn start_vibe_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    mcp_port: u16,
    project_id: &str,
    opts: &VibeSessionOpts<'_>,
) -> Result<Session, AppError> {
    // 1. Fetch project
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    // Resolve agent
    let agent_name = opts
        .agent_name
        .or(project.default_agent.as_deref())
        .unwrap_or("claude-code");

    let adapter = agent::get_adapter(agent_name)
        .ok_or_else(|| AppError::NotFound(format!("Agent adapter: {agent_name}")))?;

    // 2. Resolve agent config
    let agent_config = db::agent_configs::resolve(conn, None, project_id, agent_name)?;

    // 3. Determine model (None = let the agent CLI use its own default)
    let model = opts
        .model
        .map(String::from)
        .or_else(|| {
            agent_config
                .as_ref()
                .and_then(|c| c.model.clone())
        })
        .or_else(|| project.default_model.clone());

    // 4. Optionally create worktree
    let repo_path = Path::new(&project.path);
    let worktree_path = if opts.create_worktree {
        let branch_name = git::resolve_branch_name(
            "vibe/{{timestamp}}",
            &BranchNameVars {
                task_id: None,
                task_slug: None,
            },
        );
        let worktree = git::create_worktree(repo_path, &branch_name, opts.base_branch, None)?;
        Some(worktree.path)
    } else {
        None
    };

    let cwd = worktree_path
        .as_deref()
        .unwrap_or(&project.path);

    // 5. Pre-generate session ID for MCP URL
    let session_id = db::generate_id("sess");

    // 6. Inject MCP config (session-agnostic file + session-specific URL)
    let mcp_conn = inject_mcp(mcp_state, mcp_port, &session_id, Path::new(cwd), agent_name, Some(project_id), None);

    // 7. No system prompt — MCP instructions injected via instruction file
    let user_prompt_str = opts.user_prompt.map(|s| s.to_string());

    // 8. Build launch spec
    let extra_flags = agent_config
        .as_ref()
        .map(|c| c.flags.clone())
        .unwrap_or_default();
    let mut extra_env: HashMap<String, String> = HashMap::new();

    // Inject session-specific MCP URL and auth secret into PTY env
    if let Some(conn) = &mcp_conn {
        extra_env.insert("FABER_MCP_URL".to_string(), conn.url.clone());
        extra_env.insert("FABER_MCP_SECRET".to_string(), conn.secret.clone());
    }

    let launch_config = AgentLaunchConfig {
        system_prompt: mcp_system_prompt(adapter.as_ref(), mcp_conn.is_some()),
        prompt: user_prompt_str,
        model: model.clone(),
        extra_flags,
        extra_env,
    };
    let spec = adapter.build_launch_spec(&launch_config);

    // 9. Create session record with pre-generated ID
    let new_session = NewSession {
        project_id: project_id.to_string(),
        task_id: None,
        name: None,
        mode: SessionMode::Vibe,
        agent: agent_name.to_string(),
        model,
        worktree_path: worktree_path.clone(),
    };
    let session = db::sessions::create_with_id(conn, &session_id, &new_session)?;

    // Mark MCP connected in DB
    if mcp_conn.is_some() {
        let _ = db::sessions::update_mcp_connected(conn, &session.id, true);
    }

    // 10. Spawn PTY (wrap in login shell on Unix so agents get proper PATH/locale)
    pty::spawn(
        pty_state,
        app,
        session.id.clone(),
        &spec.command,
        &spec.args,
        Some(cwd),
        Some(&spec.env),
        80,
        24,
        cfg!(unix),
    )?;

    // 11. Update status to Running
    db::sessions::update_status(conn, &session.id, SessionStatus::Running)?;

    // 12. Emit event
    let session = db::sessions::get(conn, &session.id)?
        .ok_or_else(|| AppError::Database("Session disappeared after creation".into()))?;
    let _ = app.emit("session-started", &session);

    Ok(session)
}

// ── Research session ──

pub struct ResearchSessionOpts<'a> {
    pub task_id: &'a str,
    pub agent_name: Option<&'a str>,
    pub model: Option<&'a str>,
    pub user_prompt: Option<&'a str>,
}

pub fn start_research_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    mcp_port: u16,
    project_id: &str,
    opts: &ResearchSessionOpts<'_>,
) -> Result<Session, AppError> {
    // 1. Fetch project
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    // 2. Fetch task
    let task = db::tasks::get(conn, opts.task_id, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {}", opts.task_id)))?;

    // 3. Resolve agent
    let agent_name = opts
        .agent_name
        .or(task.agent.as_deref())
        .or(project.default_agent.as_deref())
        .unwrap_or("claude-code");

    let adapter = agent::get_adapter(agent_name)
        .ok_or_else(|| AppError::NotFound(format!("Agent adapter: {agent_name}")))?;

    // 4. Resolve agent config
    let agent_config = db::agent_configs::resolve(conn, Some(opts.task_id), project_id, agent_name)?;

    // 5. Determine model
    let model = opts
        .model
        .map(String::from)
        .or_else(|| agent_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| task.model.clone())
        .or_else(|| project.default_model.clone());

    // 6. Always run in project root — no worktree creation
    let cwd = &project.path;

    // 7. Pre-generate session ID for MCP URL
    let session_id = db::generate_id("sess");

    // 8. Inject MCP config
    let mcp_conn = inject_mcp(mcp_state, mcp_port, &session_id, Path::new(cwd), agent_name, Some(project_id), Some(opts.task_id));

    // 9. Generate user prompt from template (research-focused)
    let user_prompt_str = if opts.user_prompt.is_none_or(|s| s.trim().is_empty()) {
        let template = crate::commands::prompts::get_session_prompt(conn, "research");
        let mut vars = HashMap::new();
        vars.insert("task_id", opts.task_id);
        Some(interpolate_vars(&template.prompt, &vars))
    } else {
        opts.user_prompt.map(|s| s.to_string())
    };

    // 10. Build launch spec
    let extra_flags = agent_config
        .as_ref()
        .map(|c| c.flags.clone())
        .unwrap_or_default();
    let mut extra_env: HashMap<String, String> = HashMap::new();

    if let Some(conn_info) = &mcp_conn {
        extra_env.insert("FABER_MCP_URL".to_string(), conn_info.url.clone());
        extra_env.insert("FABER_MCP_SECRET".to_string(), conn_info.secret.clone());
    }

    let launch_config = AgentLaunchConfig {
        system_prompt: mcp_system_prompt(adapter.as_ref(), mcp_conn.is_some()),
        prompt: user_prompt_str,
        model: model.clone(),
        extra_flags,
        extra_env,
    };
    let spec = adapter.build_launch_spec(&launch_config);

    // 11. Create session record — NOTE: no task status change
    let new_session = NewSession {
        project_id: project_id.to_string(),
        task_id: Some(opts.task_id.to_string()),
        name: Some(task.id.clone()),
        mode: SessionMode::Research,
        agent: agent_name.to_string(),
        model,
        worktree_path: None,
    };
    let session = db::sessions::create_with_id(conn, &session_id, &new_session)?;

    if mcp_conn.is_some() {
        let _ = db::sessions::update_mcp_connected(conn, &session.id, true);
    }

    // 12. Spawn PTY
    pty::spawn(
        pty_state,
        app,
        session.id.clone(),
        &spec.command,
        &spec.args,
        Some(cwd),
        Some(&spec.env),
        80,
        24,
        cfg!(unix),
    )?;

    // 13. Update session status to Running
    db::sessions::update_status(conn, &session.id, SessionStatus::Running)?;

    // 14. Emit event — NO task status update (research mode)
    let session = db::sessions::get(conn, &session.id)?
        .ok_or_else(|| AppError::Database("Session disappeared after creation".into()))?;
    let _ = app.emit("session-started", &session);

    Ok(session)
}

// ── Shell session ──

pub fn start_shell_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    project_id: &str,
) -> Result<Session, AppError> {
    // 1. Fetch project (validate exists)
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    // 2. Detect user's shell (prefer saved setting, fall back to env)
    let shell = db::settings::get_value(conn, "global", None, "terminal_shell")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if cfg!(windows) {
                std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
            } else {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
            }
        });

    // 3. Create session record (no MCP for shell sessions)
    let new_session = NewSession {
        project_id: project_id.to_string(),
        task_id: None,
        name: None,
        mode: SessionMode::Shell,
        agent: "shell".to_string(),
        model: None,
        worktree_path: None,
    };
    let session = db::sessions::create(conn, &new_session)?;

    // 4. Spawn PTY with user's shell (no login wrapping — already a shell)
    pty::spawn(
        pty_state,
        app,
        session.id.clone(),
        &shell,
        &[],
        Some(&project.path),
        None,
        80,
        24,
        false,
    )?;

    // 5. Update status to Running
    db::sessions::update_status(conn, &session.id, SessionStatus::Running)?;

    // 6. Emit event
    let session = db::sessions::get(conn, &session.id)?
        .ok_or_else(|| AppError::Database("Session disappeared after creation".into()))?;
    let _ = app.emit("session-started", &session);

    Ok(session)
}

// ── Skill install session ──

/// Spawn an interactive PTY session that runs `npx skills add <source> -s <skill>`.
/// This lets the user interact with the skills CLI (e.g. select agents).
pub fn start_skill_install_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    project_id: &str,
    source: &str,
    skill_name: &str,
) -> Result<Session, AppError> {
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    tracing::info!(
        "Starting skill install session for '{}' from '{}' in {}",
        skill_name,
        source,
        project.path
    );

    let new_session = NewSession {
        project_id: project_id.to_string(),
        task_id: None,
        name: Some(format!("Installing: {}", skill_name)),
        mode: SessionMode::Shell,
        agent: "shell".to_string(),
        model: None,
        worktree_path: None,
    };
    let session = db::sessions::create(conn, &new_session)?;

    // Detect user's shell (same logic as start_shell_session)
    let shell = db::settings::get_value(conn, "global", None, "terminal_shell")
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if cfg!(windows) {
                std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
            } else {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
            }
        });

    // Spawn an interactive shell (stays open after command completes)
    pty::spawn(
        pty_state,
        app,
        session.id.clone(),
        &shell,
        &[],
        Some(&project.path),
        None,
        80,
        24,
        false, // no login shell wrapping — already a shell
    )?;

    // Write the install command into the running shell
    let install_cmd = format!("npx --yes skills add {} -s {}\n", source, skill_name);
    pty::write(pty_state, &session.id, &install_cmd)?;

    db::sessions::update_status(conn, &session.id, SessionStatus::Running)?;

    let session = db::sessions::get(conn, &session.id)?
        .ok_or_else(|| AppError::Database("Session disappeared after creation".into()))?;
    let _ = app.emit("session-started", &session);

    Ok(session)
}

// ── Relaunch session ──

/// Relaunch a stopped/finished/error session with the same configuration.
/// Creates a new session record and PTY. For task sessions, reuses the
/// existing worktree instead of creating a new one.
pub fn relaunch_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    mcp_port: u16,
    session_id: &str,
) -> Result<Session, AppError> {
    let old = db::sessions::get(conn, session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Session {session_id}")))?;

    match old.mode {
        SessionMode::Task => {
            // For task sessions, reuse the existing worktree
            let task_id = old.task_id.as_deref()
                .ok_or_else(|| AppError::Validation("Task session has no task_id".into()))?;

            let project = db::projects::get(conn, &old.project_id)?
                .ok_or_else(|| AppError::NotFound(format!("Project {}", old.project_id)))?;

            let task = db::tasks::get(conn, task_id, &old.project_id)?
                .ok_or_else(|| AppError::NotFound(format!("Task {task_id}")))?;

            // Resolve agent
            let agent_name = task
                .agent
                .as_deref()
                .or(project.default_agent.as_deref())
                .unwrap_or("claude-code");

            let adapter = agent::get_adapter(agent_name)
                .ok_or_else(|| AppError::NotFound(format!("Agent adapter: {agent_name}")))?;

            // Resolve model (None = let the agent CLI use its own default)
            let agent_config = db::agent_configs::resolve(conn, Some(task_id), &old.project_id, agent_name)?;
            let model = agent_config
                .as_ref()
                .and_then(|c| c.model.clone())
                .or_else(|| task.model.clone())
                .or_else(|| project.default_model.clone());

            // Determine CWD: reuse old worktree path if it exists, otherwise project root
            let cwd = old
                .worktree_path
                .as_deref()
                .filter(|p| Path::new(p).exists())
                .unwrap_or(&project.path);

            // Pre-generate session ID for MCP URL
            let new_session_id = db::generate_id("sess");

            // Inject MCP config
            let mcp_conn = inject_mcp(mcp_state, mcp_port, &new_session_id, Path::new(cwd), agent_name, Some(&old.project_id), old.task_id.as_deref());

            // Build launch spec
            let extra_flags = agent_config
                .as_ref()
                .map(|c| c.flags.clone())
                .unwrap_or_default();
            let mut extra_env: HashMap<String, String> = HashMap::new();

            if let Some(conn_info) = &mcp_conn {
                extra_env.insert("FABER_MCP_URL".to_string(), conn_info.url.clone());
                extra_env.insert("FABER_MCP_SECRET".to_string(), conn_info.secret.clone());
            }

            // Generate a continuation prompt from template
            let relaunch_worktree_hint = old.worktree_path.as_deref()
                .filter(|p| Path::new(p).exists())
                .map(|wt| {
                    format!(
                        "You are working in worktree {wt}, read the task by using the provided MCP tools \
                         and work on the task within the assigned worktree."
                    )
                }).unwrap_or_default();

            let template = crate::commands::prompts::get_session_prompt(conn, "task-continue");
            let mut vars = HashMap::new();
            vars.insert("task_id", task_id);
            vars.insert("worktree_hint", relaunch_worktree_hint.as_str());
            let relaunch_prompt = Some(interpolate_vars(&template.prompt, &vars));

            let launch_config = AgentLaunchConfig {
                system_prompt: mcp_system_prompt(adapter.as_ref(), mcp_conn.is_some()),
                prompt: relaunch_prompt,
                model: model.clone(),
                extra_flags,
                extra_env,
            };
            let spec = adapter.build_launch_spec(&launch_config);

            // Create session record (preserve original mode: task or plan)
            let new_session = NewSession {
                project_id: old.project_id.clone(),
                task_id: Some(task_id.to_string()),
                name: old.name.clone().or_else(|| Some(task.id.clone())),
                mode: old.mode,
                agent: agent_name.to_string(),
                model,
                worktree_path: Some(cwd.to_string()),
            };
            let session = db::sessions::create_with_id(conn, &new_session_id, &new_session)?;

            if mcp_conn.is_some() {
                let _ = db::sessions::update_mcp_connected(conn, &session.id, true);
            }

            // Spawn PTY (wrap in login shell on Unix for agent relaunches)
            pty::spawn(
                pty_state, app, session.id.clone(),
                &spec.command, &spec.args,
                Some(cwd), Some(&spec.env),
                80, 24,
                cfg!(unix),
            )?;

            db::sessions::update_status(conn, &session.id, SessionStatus::Running)?;

            let session = db::sessions::get(conn, &session.id)?
                .ok_or_else(|| AppError::Database("Session disappeared after creation".into()))?;

            // Remove the old session so the sidebar doesn't show both
            let _ = db::sessions::delete(conn, session_id);

            let _ = app.emit("session-started", &session);
            Ok(session)
        }

        SessionMode::Vibe => {
            let opts = VibeSessionOpts {
                agent_name: Some(&old.agent),
                model: old.model.as_deref(),
                create_worktree: false,
                base_branch: None,
                user_prompt: None,
            };
            let new_session = start_vibe_session(conn, pty_state, app, mcp_state, mcp_port, &old.project_id, &opts)?;
            let _ = db::sessions::delete(conn, session_id);
            Ok(new_session)
        }

        SessionMode::Shell => {
            let new_session = start_shell_session(conn, pty_state, app, &old.project_id)?;
            let _ = db::sessions::delete(conn, session_id);
            Ok(new_session)
        }

        SessionMode::Research => {
            let task_id = old.task_id.as_deref()
                .ok_or_else(|| AppError::Validation("Research session has no task_id".into()))?;
            let opts = ResearchSessionOpts {
                task_id,
                agent_name: Some(&old.agent),
                model: old.model.as_deref(),
                user_prompt: None,
            };
            let new_session = start_research_session(conn, pty_state, app, mcp_state, mcp_port, &old.project_id, &opts)?;
            let _ = db::sessions::delete(conn, session_id);
            Ok(new_session)
        }
    }
}

// ── Stop session ──

pub fn stop_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    session_id: &str,
) -> Result<Session, AppError> {
    // 1. Get session, validate exists and is active
    let session = db::sessions::get(conn, session_id)?
        .ok_or_else(|| AppError::NotFound(format!("Session {session_id}")))?;

    match session.status {
        SessionStatus::Starting | SessionStatus::Running | SessionStatus::Paused => {}
        _ => {
            return Err(AppError::Validation(format!(
                "Session {session_id} is not active (status: {})",
                session.status
            )));
        }
    }

    // 2. Kill PTY
    pty::kill(pty_state, session_id)?;

    // 3. Clean up MCP state and config files
    {
        let mut guard = mcp_state.blocking_lock();
        guard.sessions.remove(session_id);
    }
    if let Some(wt) = &session.worktree_path {
        mcp::server::cleanup_mcp_config(Path::new(wt));
    }

    // 4. Auto-cleanup worktree if setting is enabled and worktree is clean
    if let Some(wt) = &session.worktree_path {
        let auto_cleanup = db::settings::get_resolved(
            conn,
            &session.project_id,
            "worktree_auto_cleanup",
        )
        .unwrap_or(None);

        if auto_cleanup.as_deref() == Some("true") {
            // Find the project to get repo path for cleanup
            if let Ok(Some(project)) = db::projects::get(conn, &session.project_id) {
                let repo_path = Path::new(&project.path);
                let wt_path = Path::new(wt);
                if git::is_worktree_clean(wt_path, None) {
                    match git::delete_worktree(repo_path, wt_path) {
                        Ok(()) => {
                            tracing::info!(worktree = wt, "Auto-cleaned worktree");
                            // Clear worktree path on associated task
                            if let Some(tid) = &session.task_id {
                                let _ = db::tasks::update_worktree(conn, tid, &session.project_id, None);
                            }
                        }
                        Err(e) => tracing::warn!(%e, worktree = wt, "Failed to auto-clean worktree"),
                    }
                }
            }
        }
    }

    // 5. Update status to Stopped
    db::sessions::update_status(conn, session_id, SessionStatus::Stopped)?;

    // 6. Pause continuous mode if this session was manually stopped
    continuous::handle_manual_stop(app, session_id);

    // 7. Emit events
    let updated = db::sessions::get(conn, session_id)?
        .ok_or_else(|| AppError::Database("Session disappeared".into()))?;
    let _ = app.emit("session-stopped", &updated);
    let _ = app.emit(
        "session-status-changed",
        &SessionStatusChanged {
            session_id: session_id.to_string(),
            old_status: session.status,
            new_status: SessionStatus::Stopped,
        },
    );

    Ok(updated)
}

// ── Stop and remove session (atomic) ──

/// Atomically stop a session and remove it from the database.
/// This avoids the race condition where `stop_session` emits `session-stopped`,
/// the frontend refreshes and re-fetches the session before `remove_session`
/// can delete it.
///
/// All cleanup logic (PTY kill, MCP, worktree, continuous mode) mirrors
/// `stop_session` exactly — the only difference is that we delete from DB
/// and emit `session-removed` instead of updating status + emitting `session-stopped`.
pub fn stop_and_remove_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    session_id: &str,
) -> Result<(), AppError> {
    // 1. Get session — if already gone, that's fine
    let session = match db::sessions::get(conn, session_id)? {
        Some(s) => s,
        None => return Ok(()),
    };

    // 2. Kill PTY if session is active
    if matches!(
        session.status,
        SessionStatus::Starting | SessionStatus::Running | SessionStatus::Paused
    ) {
        let _ = pty::kill(pty_state, session_id);
    }

    // 3. Clean up MCP state and config files
    {
        let mut guard = mcp_state.blocking_lock();
        guard.sessions.remove(session_id);
    }
    if let Some(wt) = &session.worktree_path {
        mcp::server::cleanup_mcp_config(Path::new(wt));
    }

    // 4. Auto-cleanup worktree if setting is enabled and worktree is clean
    //    (identical logic to stop_session — protects dirty worktrees)
    if let Some(wt) = &session.worktree_path {
        let auto_cleanup = db::settings::get_resolved(
            conn,
            &session.project_id,
            "worktree_auto_cleanup",
        )
        .unwrap_or(None);

        if auto_cleanup.as_deref() == Some("true") {
            if let Ok(Some(project)) = db::projects::get(conn, &session.project_id) {
                let repo_path = Path::new(&project.path);
                let wt_path = Path::new(wt);
                if git::is_worktree_clean(wt_path, None) {
                    match git::delete_worktree(repo_path, wt_path) {
                        Ok(()) => {
                            tracing::info!(worktree = wt, "Auto-cleaned worktree");
                            if let Some(tid) = &session.task_id {
                                let _ = db::tasks::update_worktree(
                                    conn, tid, &session.project_id, None,
                                );
                            }
                        }
                        Err(e) => tracing::warn!(%e, worktree = wt, "Failed to auto-clean worktree"),
                    }
                }
            }
        }
    }

    // 5. Pause continuous mode if this session was manually stopped
    continuous::handle_manual_stop(app, session_id);

    // 6. Delete from DB (full removal, not just status update)
    db::sessions::delete(conn, session_id)?;

    // 7. Emit session-removed event (NOT session-stopped — avoids stale refresh)
    let _ = app.emit(
        "session-removed",
        serde_json::json!({
            "session_id": session_id,
            "project_id": session.project_id,
        }),
    );

    Ok(())
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolate_vars_replaces_known_keys() {
        let mut vars = HashMap::new();
        vars.insert("task_id", "T-001");
        vars.insert("project_name", "my-project");

        let result = interpolate_vars("Working on {{task_id}} in {{project_name}}", &vars);
        assert_eq!(result, "Working on T-001 in my-project");
    }

    #[test]
    fn interpolate_vars_preserves_unknown_keys() {
        let vars = HashMap::new();
        let result = interpolate_vars("Hello {{unknown}}", &vars);
        assert_eq!(result, "Hello {{unknown}}");
    }

    #[test]
    fn interpolate_vars_handles_empty_template() {
        let mut vars = HashMap::new();
        vars.insert("key", "value");
        assert_eq!(interpolate_vars("", &vars), "");
    }

    #[test]
    fn interpolate_vars_multiple_occurrences() {
        let mut vars = HashMap::new();
        vars.insert("x", "1");
        let result = interpolate_vars("{{x}} and {{x}}", &vars);
        assert_eq!(result, "1 and 1");
    }

    #[test]
    fn upsert_mcp_section_appends_to_empty() {
        let section = mcp_instruction_section();
        let result = upsert_mcp_section("", &section);
        assert!(result.contains(MCP_INSTRUCTION_MARKER_START));
        assert!(result.contains(MCP_INSTRUCTION_MARKER_END));
    }

    #[test]
    fn upsert_mcp_section_appends_to_existing() {
        let existing = "# My Project\n\nSome content here.\n";
        let section = mcp_instruction_section();
        let result = upsert_mcp_section(existing, &section);
        assert!(result.starts_with("# My Project"));
        assert!(result.contains(MCP_INSTRUCTION_MARKER_START));
    }

    #[test]
    fn upsert_mcp_section_replaces_existing_marker() {
        let existing = format!(
            "# Header\n\n{}\nold content\n{}\n\n# Footer\n",
            MCP_INSTRUCTION_MARKER_START, MCP_INSTRUCTION_MARKER_END
        );
        let section = mcp_instruction_section();
        let result = upsert_mcp_section(&existing, &section);
        assert!(result.contains("# Header"));
        assert!(result.contains("# Footer"));
        assert!(result.contains("report_status"));
        // Old markers replaced, only one start marker
        assert_eq!(result.matches(MCP_INSTRUCTION_MARKER_START).count(), 1);
    }

    #[test]
    fn write_instruction_file_creates_new() {
        let tmp = tempfile::tempdir().unwrap();
        write_instruction_file(tmp.path(), "CLAUDE.md");
        let path = tmp.path().join("CLAUDE.md");
        assert!(path.exists());
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains(MCP_INSTRUCTION_MARKER_START));
    }

    #[test]
    fn write_instruction_file_preserves_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("CLAUDE.md");
        std::fs::write(&path, "# My Project Instructions\n").unwrap();
        write_instruction_file(tmp.path(), "CLAUDE.md");
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("# My Project Instructions"));
        assert!(content.contains(MCP_INSTRUCTION_MARKER_START));
    }

    #[test]
    fn agent_instruction_filename_mapping() {
        assert_eq!(agent_instruction_filename("claude-code"), Some("CLAUDE.md"));
        assert_eq!(agent_instruction_filename("codex"), Some("AGENTS.md"));
        assert_eq!(agent_instruction_filename("copilot"), Some("AGENTS.md"));
        assert_eq!(agent_instruction_filename("cursor-agent"), Some("AGENTS.md"));
        assert_eq!(agent_instruction_filename("gemini"), Some("GEMINI.md"));
        assert_eq!(agent_instruction_filename("shell"), None);
    }
}
