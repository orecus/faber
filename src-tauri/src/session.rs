use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_client_protocol as acp;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;

use crate::acp::client::{AcpClient, AcpSpawnConfig};
use crate::acp::handler;
use crate::acp::state::{AcpSessionState, AcpState};
use crate::acp::types::{AcpConfigOptionUpdatePayload, AcpErrorPayload, AcpPromptCompletePayload, AcpTokenUsagePayload, EVENT_ACP_CONFIG_OPTION_UPDATE, EVENT_ACP_ERROR, EVENT_ACP_PROMPT_COMPLETE, EVENT_ACP_TOKEN_USAGE};
use crate::agent::{self, AgentLaunchConfig};
use crate::commands::tasks::do_update_task_status;
use crate::queue;
use crate::db;
use crate::db::models::{
    NewSession, Session, SessionMode, SessionStatus, SessionTransport,
};
use crate::error::AppError;
use crate::git::{self, BranchNameVars, DEFAULT_BRANCH_PATTERN};
use crate::mcp;
use crate::mcp::McpState;
use crate::mcp::server::McpSessionData;
use crate::pty::{self, PtyState};
use crate::tasks;

// ── Agent instruction file management ──

const MCP_INSTRUCTION_MARKER_START: &str = "<!-- Faber:MCP -->";
const MCP_INSTRUCTION_MARKER_END: &str = "<!-- /Faber:MCP -->";

/// Static instruction pointing agents to the get_instructions MCP tool.
/// This never changes between sessions, so instruction files stay clean in git.
const MCP_INSTRUCTION_CONTENT: &str = "\
You have MCP tools provided by the Faber IDE. \
IMPORTANT: Call the `get_instructions` MCP tool FIRST before doing any work. \
It provides your session-specific workflow, available tools, and task context.";

/// Build the MCP system prompt string (for agents that support --system-prompt).
fn mcp_system_prompt_text() -> String {
    MCP_INSTRUCTION_CONTENT.to_string()
}

/// Build the MCP instruction section for agent instruction files (CLAUDE.md, etc.).
fn mcp_instruction_section() -> String {
    format!(
        "{}\n## Faber Integration\n\n{}\n{}",
        MCP_INSTRUCTION_MARKER_START,
        MCP_INSTRUCTION_CONTENT,
        MCP_INSTRUCTION_MARKER_END
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
/// Content is static (just points to get_instructions), so the file only changes on first write.
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
#[allow(clippy::too_many_arguments)]
fn inject_mcp(
    mcp_state: &Arc<TokioMutex<McpState>>,
    mcp_port: u16,
    session_id: &str,
    cwd: &Path,
    agent_name: &str,
    project_id: Option<&str>,
    task_id: Option<&str>,
    session_mode: Option<&str>,
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
                session_mode: session_mode.map(String::from),
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
        let branch = if let Some(branch) = task.branch.as_deref() {
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
    let mcp_conn = inject_mcp(mcp_state, mcp_port, &session_id, Path::new(cwd), agent_name, Some(project_id), Some(task_id), Some("task"));

    // 9. Generate user prompt from template (use provided or auto-generate)
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
        transport: SessionTransport::Pty,
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
    let mcp_conn = inject_mcp(mcp_state, mcp_port, &session_id, Path::new(cwd), agent_name, Some(project_id), None, Some("vibe"));

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
        transport: SessionTransport::Pty,
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
    let mcp_conn = inject_mcp(mcp_state, mcp_port, &session_id, Path::new(cwd), agent_name, Some(project_id), Some(opts.task_id), Some("research"));

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
        transport: SessionTransport::Pty,
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
        transport: SessionTransport::Pty,
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
        transport: SessionTransport::Pty,
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

// ── Shared ACP helpers ──

/// Common configuration for spawning an ACP session.
/// Holds everything needed to start the ACP client thread — agent validation,
/// MCP registration, and client lifecycle are all handled by `spawn_acp_session()`.
struct AcpSessionSetup {
    session_id: String,
    project_id: String,
    cwd: PathBuf,
    agent_name: String,
    model: Option<String>,
    mode: SessionMode,
    task_id: Option<String>,
    name: Option<String>,
    worktree_path: Option<String>,
    prompt_content: String,
    is_trust_mode: bool,
}

/// Validate that an agent supports ACP and return the launch spec.
fn validate_acp_agent(adapter: &dyn agent::AgentAdapter, agent_name: &str) -> Result<(String, Vec<String>), AppError> {
    if !adapter.supports_acp() {
        return Err(AppError::Validation(format!(
            "Agent '{}' does not support ACP transport",
            agent_name
        )));
    }

    let (acp_command, acp_args) = adapter.acp_launch_spec()
        .ok_or_else(|| AppError::Validation(format!(
            "Agent '{}' supports ACP but has no launch spec",
            agent_name
        )))?;

    if !adapter.detect_acp_adapter() {
        let install_hint = adapter.acp_install_command()
            .unwrap_or("npm install -g <adapter-package>");
        return Err(AppError::Validation(format!(
            "Agent '{agent_name}' requires the ACP adapter '{acp_command}' which is not installed. \
             Install it via: {install_hint}"
        )));
    }

    Ok((acp_command, acp_args))
}

/// Register an MCP session for ACP.
///
/// ACP passes MCP servers via the protocol (`session/new` `mcp_servers` param),
/// so we **remove** any existing faber sidecar entry from the agent's config file.
/// If we left the entry, agents with native ACP (e.g. Gemini) would try to launch
/// the sidecar independently at startup, blocking initialization.
///
/// Returns the MCP connection info if the MCP server is running.
#[allow(clippy::too_many_arguments)]
fn register_acp_mcp_session(
    mcp_state: &Arc<TokioMutex<McpState>>,
    mcp_port: u16,
    session_id: &str,
    cwd: &Path,
    agent_name: &str,
    project_id: Option<&str>,
    task_id: Option<&str>,
    session_mode: Option<&str>,
) -> Option<McpConnection> {
    if mcp_port == 0 {
        return None;
    }

    // Remove the faber sidecar entry from the agent's config file.
    // MCP is passed via the ACP protocol instead, so the config file entry
    // would only cause the agent to try launching the sidecar independently.
    mcp::server::cleanup_mcp_config(cwd);

    // Write instruction file for agent context
    if let Some(filename) = agent_instruction_filename(agent_name) {
        write_instruction_file(cwd, filename);
    }

    let mut guard = mcp_state.blocking_lock();
    guard.sessions.insert(session_id.to_string(), McpSessionData {
        project_id: project_id.map(String::from),
        task_id: task_id.map(String::from),
        session_mode: session_mode.map(String::from),
        ..Default::default()
    });
    let secret = guard.secret.clone();
    let url = mcp::server::build_session_mcp_url(mcp_port, session_id);
    Some(McpConnection { url, secret })
}

/// Spawn an ACP session: creates DB record, starts ACP client thread, returns Session.
///
/// Emit token usage from a PromptResponse if available.
///
/// The ACP `PromptResponse.usage` field (unstable) provides cumulative token
/// counts across all turns. We emit these as a Tauri event so the frontend
/// can display input/output/cache breakdowns.
pub fn emit_token_usage(app: &AppHandle, session_id: &str, response: &acp::PromptResponse) {
    if let Some(ref usage) = response.usage {
        tracing::debug!(
            session_id = %session_id,
            input = usage.input_tokens,
            output = usage.output_tokens,
            thought = ?usage.thought_tokens,
            cache_read = ?usage.cached_read_tokens,
            cache_write = ?usage.cached_write_tokens,
            total = usage.total_tokens,
            "ACP ← token usage"
        );
        let _ = app.emit(
            EVENT_ACP_TOKEN_USAGE,
            AcpTokenUsagePayload {
                session_id: session_id.to_string(),
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                thought_tokens: usage.thought_tokens,
                cached_read_tokens: usage.cached_read_tokens,
                cached_write_tokens: usage.cached_write_tokens,
                total_tokens: usage.total_tokens,
            },
        );
    }
}

/// This is the shared core for all ACP session types (task, vibe, research).
/// The caller is responsible for task-specific logic (worktree, task status updates).
#[allow(clippy::too_many_arguments)]
fn spawn_acp_session(
    conn: &Connection,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: &AcpState,
    setup: AcpSessionSetup,
    acp_command: String,
    acp_args: Vec<String>,
    mcp_conn: Option<McpConnection>,
) -> Result<Session, AppError> {
    // Build MCP servers for ACP passthrough
    let mcp_servers = if let Some(ref conn_info) = mcp_conn {
        build_acp_mcp_servers(&conn_info.url, &conn_info.secret)
    } else {
        vec![]
    };

    // Create session record with ACP transport
    let new_session = NewSession {
        project_id: setup.project_id.clone(),
        task_id: setup.task_id.clone(),
        name: setup.name,
        mode: setup.mode,
        transport: SessionTransport::Acp,
        agent: setup.agent_name.clone(),
        model: setup.model,
        worktree_path: setup.worktree_path,
    };
    let session = db::sessions::create_with_id(conn, &setup.session_id, &new_session)?;

    if mcp_conn.is_some() {
        let _ = db::sessions::update_mcp_connected(conn, &session.id, true);
    }

    // Build env from MCP connection
    let mut env: HashMap<String, String> = HashMap::new();
    if let Some(conn_info) = &mcp_conn {
        env.insert("FABER_MCP_URL".to_string(), conn_info.url.clone());
        env.insert("FABER_MCP_SECRET".to_string(), conn_info.secret.clone());
    }

    let pending_permissions = handler::new_pending_permissions();

    // Register the pending_permissions in the global registry so that
    // `respond_permission` can find them even when the AcpSessionState is
    // temporarily removed from AcpState during prompt() calls.
    {
        let registry: tauri::State<'_, crate::acp::state::PendingPermissionsRegistry> = app.state();
        let mut reg = registry.blocking_lock();
        reg.insert(setup.session_id.clone(), pending_permissions.clone());
    }

    let spawn_config = AcpSpawnConfig {
        command: acp_command,
        args: acp_args,
        cwd: setup.cwd.clone(),
        env,
        session_id: setup.session_id.clone(),
        project_id: setup.project_id.clone(),
        is_trust_mode: setup.is_trust_mode,
        pending_permissions: pending_permissions.clone(),
    };

    // Spawn ACP client in a dedicated thread with LocalSet (ACP uses !Send futures)
    let session_id_clone = setup.session_id.clone();
    let agent_name_clone = setup.agent_name.clone();
    let acp_state_clone = acp_state.clone();
    let app_for_task = app.clone();
    let _mcp_state_for_task = mcp_state.clone();
    let prompt_content = setup.prompt_content;
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build tokio runtime for ACP session");

        let local = tokio::task::LocalSet::new();
        local.block_on(&rt, async move {
            macro_rules! with_db {
                ($session_id:expr, $status:expr) => {
                    let db_state = app_for_task.state::<crate::db::DbState>();
                    if let Ok(conn) = db_state.lock() {
                        let _ = db::sessions::update_status(&conn, $session_id, $status);
                    }
                };
            }

            macro_rules! emit_session_stopped {
                ($sid:expr) => {
                    let db_state = app_for_task.state::<crate::db::DbState>();
                    if let Ok(conn) = db_state.lock() {
                        if let Ok(Some(session)) = db::sessions::get(&conn, $sid) {
                            let _ = app_for_task.emit("session-stopped", &session);
                            let _ = app_for_task.emit(
                                "session-status-changed",
                                &SessionStatusChanged {
                                    session_id: $sid.to_string(),
                                    old_status: SessionStatus::Running,
                                    new_status: session.status,
                                },
                            );
                        }
                    }
                };
            }

            macro_rules! emit_session_status_changed {
                ($sid:expr, $old:expr, $new:expr) => {
                    let _ = app_for_task.emit(
                        "session-status-changed",
                        &SessionStatusChanged {
                            session_id: $sid.to_string(),
                            old_status: $old,
                            new_status: $new,
                        },
                    );
                };
            }

            tracing::info!(session_id = %session_id_clone, "ACP session thread started — spawning client");

            // Spawn the ACP client
            let mut client = match AcpClient::spawn(spawn_config, app_for_task.clone()) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!(session_id = %session_id_clone, error = %e, "Failed to spawn ACP client");
                    let _ = app_for_task.emit(EVENT_ACP_ERROR, AcpErrorPayload {
                        session_id: session_id_clone.clone(),
                        error: e.to_string(),
                    });
                    with_db!(&session_id_clone, SessionStatus::Error);
                    emit_session_stopped!(&session_id_clone);
                    return;
                }
            };

            // Initialize handshake
            if let Err(e) = client.initialize().await {
                tracing::error!(session_id = %session_id_clone, error = %e, "ACP initialization failed");
                let _ = app_for_task.emit(EVENT_ACP_ERROR, AcpErrorPayload {
                    session_id: session_id_clone.clone(),
                    error: e.to_string(),
                });
                client.shutdown().await;
                with_db!(&session_id_clone, SessionStatus::Error);
                emit_session_stopped!(&session_id_clone);
                return;
            }

            // Create ACP session with MCP servers
            let acp_session = match client.new_session(&setup.cwd, mcp_servers).await {
                Ok(s) => s,
                Err(e) => {
                    tracing::error!(session_id = %session_id_clone, error = %e, "ACP session creation failed");
                    let _ = app_for_task.emit(EVENT_ACP_ERROR, AcpErrorPayload {
                        session_id: session_id_clone.clone(),
                        error: e.to_string(),
                    });
                    client.shutdown().await;
                    with_db!(&session_id_clone, SessionStatus::Error);
                    emit_session_stopped!(&session_id_clone);
                    return;
                }
            };

            let acp_session_id = acp_session.session_id.clone();

            // Persist the ACP session ID to the database for future session resume
            {
                let db_state: tauri::State<'_, crate::db::DbState> = app_for_task.state();
                if let Ok(conn) = db_state.lock() {
                    let _ = db::sessions::update_acp_session_id(&conn, &session_id_clone, &acp_session_id.to_string());
                };
            }

            // Build the initial config options by merging ACP-reported options with
            // adapter-detected ones. The ACP adapter may only report some categories
            // (e.g. model + mode but not thought_level). We supplement missing
            // categories from adapter detection and emit everything in a single event
            // (since the frontend replaces the full option set on each event).
            let mut config_options: Vec<crate::acp::types::AcpConfigOption> = Vec::new();
            let mut acp_reported_categories = std::collections::HashSet::new();

            if let Some(ref config_opts) = acp_session.config_options {
                let converted: Vec<_> = config_opts
                    .iter()
                    .map(handler::convert_config_option_public)
                    .collect();
                for opt in &converted {
                    if let Some(ref cat) = opt.category {
                        acp_reported_categories.insert(cat.clone());
                    }
                }
                config_options = converted;
            }

            // Supplement with adapter-detected options for categories ACP didn't report
            if let Some(adapter) = agent::get_adapter(&agent_name_clone) {
                let detected = adapter.detect_config_options();
                for opt in detected {
                    let cat = opt.category.as_deref().unwrap_or("");
                    if !acp_reported_categories.contains(cat) {
                        if let Some(ref c) = opt.category {
                            acp_reported_categories.insert(c.clone());
                        }
                        config_options.push(opt);
                    }
                }
            }

            if !config_options.is_empty() {
                let categories: Vec<&str> = config_options.iter()
                    .filter_map(|o| o.category.as_deref())
                    .collect();
                tracing::info!(
                    session_id = %session_id_clone,
                    option_count = config_options.len(),
                    categories = ?categories,
                    "ACP ← initial config_options (ACP + adapter supplemental)"
                );
                let _ = app_for_task.emit(
                    EVENT_ACP_CONFIG_OPTION_UPDATE,
                    AcpConfigOptionUpdatePayload {
                        session_id: session_id_clone.clone(),
                        config_options,
                    },
                );
            }

            // Store client in ACP state
            tracing::info!(
                session_id = %session_id_clone,
                acp_session_id = %acp_session_id,
                "ACP client initialized and session created — storing state"
            );
            let client = Arc::new(client);
            let shutdown_signal = Arc::new(tokio::sync::Notify::new());
            let shutdown_signal_clone = shutdown_signal.clone();
            {
                let mut state = acp_state_clone.lock().await;
                state.insert(session_id_clone.clone(), AcpSessionState {
                    client: client.clone(),
                    acp_session_id: Some(acp_session_id.clone()),
                    pending_permissions: pending_permissions.clone(),
                    shutdown_signal,
                });
            }

            // Update session status to Running and notify frontend
            with_db!(&session_id_clone, SessionStatus::Running);
            emit_session_status_changed!(&session_id_clone, SessionStatus::Starting, SessionStatus::Running);

            // Send the initial prompt (skip if empty — e.g. chat/vibe sessions waiting for user input)
            if prompt_content.is_empty() {
                tracing::info!(
                    session_id = %session_id_clone,
                    "ACP session ready — no initial prompt, waiting for user input"
                );
                // IMPORTANT: We must NOT return here. The ACP I/O driver task and any
                // spawn_local tasks are tied to this thread's LocalSet. If we return,
                // the LocalSet drops and all local tasks are aborted, killing the
                // connection. Instead, wait on the shutdown signal which is notified
                // by shutdown_acp_client when the session should end.
                shutdown_signal_clone.notified().await;
                tracing::info!(session_id = %session_id_clone, "ACP keepalive received shutdown signal — exiting");
                return;
            }

            tracing::info!(
                session_id = %session_id_clone,
                prompt_len = prompt_content.len(),
                prompt_preview = %if prompt_content.len() > 200 {
                    format!("{}…", &prompt_content[..200])
                } else {
                    prompt_content.clone()
                }.replace('\n', "\\n"),
                "ACP sending initial prompt"
            );
            let content = vec![acp::ContentBlock::Text(acp::TextContent::new(&prompt_content))];

            // Call prompt on the Arc-cloned client — no need to remove/reinsert
            // from the state map. The Arc allows concurrent cancel() calls.
            let prompt_result = Some(client.prompt(acp_session_id.clone(), content).await);

            match prompt_result {
                Some(Ok(response)) => {
                    emit_token_usage(&app_for_task, &session_id_clone, &response);
                    let stop_reason = format!("{:?}", response.stop_reason);
                    tracing::info!(
                        session_id = %session_id_clone,
                        stop_reason = %stop_reason,
                        "ACP initial prompt completed — session stays open for follow-up"
                    );
                    let _ = app_for_task.emit(EVENT_ACP_PROMPT_COMPLETE, AcpPromptCompletePayload {
                        session_id: session_id_clone.clone(),
                        stop_reason,
                    });
                    // Do NOT mark session as Finished here — the session stays open
                    // for follow-up prompts (just like send_acp_message does).
                    // Wait on shutdown signal so the spawn thread's LocalSet stays
                    // alive, keeping the ACP I/O driver and connection active.
                    shutdown_signal_clone.notified().await;
                    tracing::info!(session_id = %session_id_clone, "ACP session received shutdown signal after initial prompt");
                }
                Some(Err(e)) => {
                    tracing::error!(session_id = %session_id_clone, error = %e, "ACP prompt failed");
                    let _ = app_for_task.emit(EVENT_ACP_ERROR, AcpErrorPayload {
                        session_id: session_id_clone.clone(),
                        error: e.to_string(),
                    });
                    with_db!(&session_id_clone, SessionStatus::Error);
                    emit_session_stopped!(&session_id_clone);
                }
                None => {
                    tracing::error!(session_id = %session_id_clone, "ACP session state disappeared during prompt");
                    with_db!(&session_id_clone, SessionStatus::Error);
                    emit_session_stopped!(&session_id_clone);
                }
            }

            tracing::info!(session_id = %session_id_clone, "ACP session thread exiting");
        });
    });

    // Return the session record
    let session = db::sessions::get(conn, &session.id)?
        .ok_or_else(|| AppError::Database("Session disappeared after creation".into()))?;
    let _ = app.emit("session-started", &session);

    Ok(session)
}

// ── ACP task session ──

/// Build MCP server configuration for ACP passthrough.
///
/// Instead of writing `.mcp.json` config files (PTY approach), ACP sessions
/// pass MCP server config via the `session/new` `mcp_servers` parameter.
/// This uses the Stdio transport with the faber-mcp sidecar binary.
fn build_acp_mcp_servers(mcp_url: &str, mcp_secret: &str) -> Vec<acp::McpServer> {
    let Some(sidecar_path) = mcp::server::resolve_sidecar_path() else {
        tracing::warn!("MCP sidecar not found, ACP session will have no MCP tools");
        return vec![];
    };

    let mcp_server = acp::McpServerStdio::new("faber", sidecar_path)
        .env(vec![
            acp::EnvVariable::new("FABER_MCP_URL", mcp_url),
            acp::EnvVariable::new("FABER_MCP_SECRET", mcp_secret),
        ]);

    vec![acp::McpServer::Stdio(mcp_server)]
}

/// Options for starting an ACP task session.
pub struct AcpTaskSessionOpts<'a> {
    pub task_id: &'a str,
    pub agent_name: Option<&'a str>,
    pub model: Option<&'a str>,
    pub create_worktree: bool,
    pub base_branch: Option<&'a str>,
    pub user_prompt: Option<&'a str>,
    /// Whether this session runs in trust mode (autonomous permission handling).
    /// When true, the ACP permission policy engine uses the trust mode policy
    /// (auto_approve / deny_writes) instead of normal rule evaluation.
    /// Typically enabled for queue mode auto-launch queues.
    pub is_trust_mode: bool,
}

/// Start a task session using ACP (Agent Client Protocol) transport.
///
/// This mirrors `start_task_session()` but uses structured JSON-RPC over stdio
/// instead of PTY + MCP config files. MCP servers are passed via ACP's
/// `session/new` `mcpServers` parameter for seamless integration.
#[allow(clippy::too_many_arguments)]
pub fn start_acp_task_session(
    conn: &Connection,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: &AcpState,
    mcp_port: u16,
    project_id: &str,
    opts: &AcpTaskSessionOpts<'_>,
) -> Result<Session, AppError> {
    // 1. Fetch project
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    // 2. Fetch task
    let task = db::tasks::get(conn, opts.task_id, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Task {}", opts.task_id)))?;

    // 3. Resolve agent
    let agent_name = opts.agent_name
        .or(task.agent.as_deref())
        .or(project.default_agent.as_deref())
        .unwrap_or("claude-code");

    let adapter = agent::get_adapter(agent_name)
        .ok_or_else(|| AppError::NotFound(format!("Agent adapter: {agent_name}")))?;

    // Validate agent supports ACP
    let (acp_command, acp_args) = validate_acp_agent(adapter.as_ref(), agent_name)?;

    // 4. Resolve agent config cascade
    let agent_config = db::agent_configs::resolve(conn, Some(opts.task_id), project_id, agent_name)?;

    // 5. Determine model
    let model = opts.model
        .map(String::from)
        .or_else(|| agent_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| task.model.clone())
        .or_else(|| project.default_model.clone());

    // 6. Optionally create worktree
    let (worktree_path, _branch_name) = if opts.create_worktree {
        let branch = if let Some(branch) = task.branch.as_deref() {
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
                    task_id: Some(opts.task_id),
                    task_slug: Some(&slug),
                },
            )
        };

        let repo_path = Path::new(&project.path);
        let worktree = git::create_worktree(repo_path, &branch, opts.base_branch, None)?;
        let _ = db::tasks::update_worktree(conn, opts.task_id, project_id, Some(&worktree.path));
        (Some(worktree.path), branch)
    } else {
        (None, String::new())
    };

    let cwd = worktree_path.as_deref().unwrap_or(&project.path);

    // 7. Pre-generate session ID for MCP URL
    let session_id = db::generate_id("sess");

    // 8. Register MCP session data (no config file writing for ACP)
    let mcp_conn = register_acp_mcp_session(
        mcp_state, mcp_port, &session_id, Path::new(cwd),
        agent_name, Some(project_id), Some(opts.task_id), Some("task"),
    );

    // 9. Generate user prompt
    let worktree_hint = worktree_path.as_deref().map(|wt| {
        format!(
            "You are working in worktree {wt}, read the task by using the provided MCP tools \
             and work on the task within the assigned worktree."
        )
    }).unwrap_or_default();

    let user_prompt_str = if opts.user_prompt.is_none_or(|s| s.trim().is_empty()) {
        let template = crate::commands::prompts::get_session_prompt(conn, "task");
        let mut vars = HashMap::new();
        vars.insert("task_id", opts.task_id);
        vars.insert("worktree_hint", worktree_hint.as_str());
        interpolate_vars(&template.prompt, &vars)
    } else {
        let trimmed = opts.user_prompt.unwrap().trim().to_string();
        if worktree_hint.is_empty() { trimmed } else { format!("{trimmed} {worktree_hint}") }
    };

    // 11. Spawn ACP session using shared helper
    let setup = AcpSessionSetup {
        session_id,
        project_id: project_id.to_string(),
        cwd: PathBuf::from(cwd),
        agent_name: agent_name.to_string(),
        model,
        mode: SessionMode::Task,
        task_id: Some(opts.task_id.to_string()),
        name: Some(task.id.clone()),
        worktree_path: worktree_path.clone(),
        prompt_content: user_prompt_str,
        is_trust_mode: opts.is_trust_mode,
    };
    let session = spawn_acp_session(conn, app, mcp_state, acp_state, setup, acp_command, acp_args, mcp_conn)?;

    // 12. Update task status to in-progress
    let (github_sync_ctx, todos_update) = match do_update_task_status(conn, project_id, opts.task_id, "in-progress") {
        Ok((task, sync_ctx, todos)) => {
            let _ = app.emit("task-updated", &task);
            (sync_ctx, todos)
        }
        Err(e) => { tracing::error!(%e, task_id = opts.task_id, "Failed to mark task as in-progress"); (None, None) }
    };
    if let Some(t) = todos_update { t.write(); }

    if let Some(ctx) = github_sync_ctx {
        crate::commands::tasks::execute_github_sync(ctx);
    }

    Ok(session)
}

// ── ACP vibe session ──

/// Options for starting an ACP vibe session.
pub struct AcpVibeSessionOpts<'a> {
    pub agent_name: Option<&'a str>,
    pub model: Option<&'a str>,
    pub create_worktree: bool,
    pub base_branch: Option<&'a str>,
    pub user_prompt: Option<&'a str>,
}

/// Start a vibe session using ACP transport.
///
/// Like `start_vibe_session()` but uses structured chat UI instead of PTY terminal.
#[allow(clippy::too_many_arguments)]
pub fn start_acp_vibe_session(
    conn: &Connection,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: &AcpState,
    mcp_port: u16,
    project_id: &str,
    opts: &AcpVibeSessionOpts<'_>,
) -> Result<Session, AppError> {
    // 1. Fetch project
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    // 2. Resolve agent
    let agent_name = opts
        .agent_name
        .or(project.default_agent.as_deref())
        .unwrap_or("claude-code");

    let adapter = agent::get_adapter(agent_name)
        .ok_or_else(|| AppError::NotFound(format!("Agent adapter: {agent_name}")))?;

    // Validate agent supports ACP
    let (acp_command, acp_args) = validate_acp_agent(adapter.as_ref(), agent_name)?;

    // 3. Resolve agent config
    let agent_config = db::agent_configs::resolve(conn, None, project_id, agent_name)?;

    // 4. Determine model
    let model = opts
        .model
        .map(String::from)
        .or_else(|| agent_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| project.default_model.clone());

    // 5. Optionally create worktree
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

    let cwd = worktree_path.as_deref().unwrap_or(&project.path);

    // 6. Pre-generate session ID for MCP URL
    let session_id = db::generate_id("sess");

    // 7. Register MCP session data
    let mcp_conn = register_acp_mcp_session(
        mcp_state, mcp_port, &session_id, Path::new(cwd),
        agent_name, Some(project_id), None, Some("vibe"),
    );

    // 8. User prompt (pass through as-is for vibe sessions).
    // If no prompt is provided, prompt_content is empty — spawn_acp_session
    // will skip the initial prompt and wait for user input via ChatInput.
    let prompt_content = opts.user_prompt
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_default();

    // 9. Spawn ACP session
    let setup = AcpSessionSetup {
        session_id,
        project_id: project_id.to_string(),
        cwd: PathBuf::from(cwd),
        agent_name: agent_name.to_string(),
        model,
        mode: SessionMode::Vibe,
        task_id: None,
        name: None,
        worktree_path: worktree_path.clone(),
        prompt_content,
        is_trust_mode: false,
    };

    spawn_acp_session(conn, app, mcp_state, acp_state, setup, acp_command, acp_args, mcp_conn)
}

// ── ACP chat session (project-scoped) ──

/// Options for starting a project-scoped ACP chat session.
pub struct AcpChatSessionOpts<'a> {
    pub agent_name: Option<&'a str>,
    pub model: Option<&'a str>,
    pub user_prompt: Option<&'a str>,
}

/// Start a project-scoped chat session using ACP transport.
///
/// Unlike vibe sessions, chat sessions always run in the project root (no worktree),
/// and are intended for general project discussions rather than coding tasks.
#[allow(clippy::too_many_arguments)]
pub fn start_acp_chat_session(
    conn: &Connection,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: &AcpState,
    mcp_port: u16,
    project_id: &str,
    opts: &AcpChatSessionOpts<'_>,
) -> Result<Session, AppError> {
    tracing::info!(project_id = %project_id, agent = ?opts.agent_name, "Starting project chat session");

    // 1. Fetch project
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;
    tracing::debug!(project_name = %project.name, project_path = %project.path, "Fetched project for chat");

    // 2. Resolve agent
    let agent_name = opts
        .agent_name
        .or(project.default_agent.as_deref())
        .unwrap_or("claude-code");
    tracing::debug!(agent_name = %agent_name, "Resolved agent for chat session");

    let adapter = agent::get_adapter(agent_name)
        .ok_or_else(|| {
            tracing::error!(agent_name = %agent_name, "Agent adapter not found");
            AppError::NotFound(format!("Agent adapter: {agent_name}"))
        })?;

    // Validate agent supports ACP
    let (acp_command, acp_args) = validate_acp_agent(adapter.as_ref(), agent_name)
        .map_err(|e| {
            tracing::error!(agent_name = %agent_name, error = %e, "ACP validation failed for chat session");
            e
        })?;
    tracing::debug!(acp_command = %acp_command, acp_args = ?acp_args, "ACP agent validated");

    // 3. Resolve agent config
    let agent_config = db::agent_configs::resolve(conn, None, project_id, agent_name)?;

    // 4. Determine model
    let model = opts
        .model
        .map(String::from)
        .or_else(|| agent_config.as_ref().and_then(|c| c.model.clone()))
        .or_else(|| project.default_model.clone());
    tracing::debug!(model = ?model, "Resolved model for chat session");

    // 5. Always run in project root — no worktree for chat sessions
    let cwd = &project.path;

    // 6. Pre-generate session ID for MCP URL
    let session_id = db::generate_id("sess");
    tracing::debug!(session_id = %session_id, cwd = %cwd, "Pre-generated session ID for chat");

    // 7. Register MCP session data
    let mcp_conn = register_acp_mcp_session(
        mcp_state, mcp_port, &session_id, Path::new(cwd),
        agent_name, Some(project_id), None, Some("chat"),
    );
    tracing::debug!(mcp_port = mcp_port, has_mcp = mcp_conn.is_some(), "MCP session registered for chat");

    // 8. User prompt (pass through; empty = wait for user input via ChatInput)
    let prompt_content = opts.user_prompt
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_default();

    // 9. Spawn ACP session
    tracing::info!(
        session_id = %session_id,
        agent = %agent_name,
        model = ?model,
        cwd = %cwd,
        "Spawning ACP chat session"
    );
    let setup = AcpSessionSetup {
        session_id,
        project_id: project_id.to_string(),
        cwd: PathBuf::from(cwd),
        agent_name: agent_name.to_string(),
        model,
        mode: SessionMode::Chat,
        task_id: None,
        name: Some(format!("{} chat", project.name)),
        worktree_path: None,
        prompt_content,
        is_trust_mode: false,
    };

    spawn_acp_session(conn, app, mcp_state, acp_state, setup, acp_command, acp_args, mcp_conn)
}

/// Resume an existing ACP session by loading it from the agent.
///
/// This spawns a fresh ACP client, initializes it, then calls `session/load`
/// instead of `session/new`. The agent replays conversation history via
/// `SessionUpdate` notifications, which the handler routes to the frontend.
#[allow(clippy::too_many_arguments)]
pub fn resume_acp_chat_session(
    conn: &Connection,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: &AcpState,
    mcp_port: u16,
    project_id: &str,
    agent_name: &str,
    acp_session_id_to_resume: &str,
    use_session_mode: bool,
) -> Result<Session, AppError> {
    tracing::info!(
        project_id = %project_id,
        agent = %agent_name,
        acp_session_id = %acp_session_id_to_resume,
        "Resuming ACP chat session"
    );

    // 1. Fetch project
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    // 2. Validate agent supports ACP
    let adapter = agent::get_adapter(agent_name)
        .ok_or_else(|| AppError::NotFound(format!("Agent adapter: {agent_name}")))?;
    let (acp_command, acp_args) = validate_acp_agent(adapter.as_ref(), agent_name)?;

    // 3. Pre-generate Faber session ID
    let session_id = db::generate_id("sess");
    let cwd = PathBuf::from(&project.path);

    // 4. Register MCP session
    let mcp_conn = register_acp_mcp_session(
        mcp_state, mcp_port, &session_id, &cwd,
        agent_name, Some(project_id), None, Some("chat"),
    );

    // 5. Build MCP servers for ACP passthrough
    let mcp_servers = if let Some(ref conn_info) = mcp_conn {
        build_acp_mcp_servers(&conn_info.url, &conn_info.secret)
    } else {
        vec![]
    };

    // 6. Resolve model from agent config
    let agent_config = db::agent_configs::resolve(conn, None, project_id, agent_name)?;
    let model = agent_config.as_ref().and_then(|c| c.model.clone())
        .or_else(|| project.default_model.clone());

    // 7. Create session record
    // When target is "session", use Vibe mode so it appears in the Sessions grid
    // (which filters out chat-mode sessions). Otherwise use Chat mode for ChatView.
    let (mode, name) = if use_session_mode {
        (SessionMode::Vibe, Some(format!("{} session", project.name)))
    } else {
        (SessionMode::Chat, Some(format!("{} chat", project.name)))
    };
    let new_session = NewSession {
        project_id: project_id.to_string(),
        task_id: None,
        name,
        mode,
        transport: SessionTransport::Acp,
        agent: agent_name.to_string(),
        model,
        worktree_path: None,
    };
    let session = db::sessions::create_with_id(conn, &session_id, &new_session)?;

    if mcp_conn.is_some() {
        let _ = db::sessions::update_mcp_connected(conn, &session.id, true);
    }

    // 8. Build env from MCP connection
    let mut env: HashMap<String, String> = HashMap::new();
    if let Some(conn_info) = &mcp_conn {
        env.insert("FABER_MCP_URL".to_string(), conn_info.url.clone());
        env.insert("FABER_MCP_SECRET".to_string(), conn_info.secret.clone());
    }

    let pending_permissions = handler::new_pending_permissions();
    {
        let registry: tauri::State<'_, crate::acp::state::PendingPermissionsRegistry> = app.state();
        let mut reg = registry.blocking_lock();
        reg.insert(session_id.clone(), pending_permissions.clone());
    }

    let spawn_config = AcpSpawnConfig {
        command: acp_command,
        args: acp_args,
        cwd: cwd.clone(),
        env,
        session_id: session_id.clone(),
        project_id: project_id.to_string(),
        is_trust_mode: false,
        pending_permissions: pending_permissions.clone(),
    };

    // 9. Spawn ACP client in dedicated thread — use load_session instead of new_session
    let session_id_clone = session_id.clone();
    let acp_state_clone = acp_state.clone();
    let app_for_task = app.clone();
    let acp_sid_to_resume = acp_session_id_to_resume.to_string();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build tokio runtime for ACP resume session");

        let local = tokio::task::LocalSet::new();
        local.block_on(&rt, async move {
            macro_rules! with_db {
                ($session_id:expr, $status:expr) => {
                    let db_state = app_for_task.state::<crate::db::DbState>();
                    if let Ok(conn) = db_state.lock() {
                        let _ = db::sessions::update_status(&conn, $session_id, $status);
                    }
                };
            }

            macro_rules! emit_session_stopped {
                ($sid:expr) => {
                    let db_state = app_for_task.state::<crate::db::DbState>();
                    if let Ok(conn) = db_state.lock() {
                        if let Ok(Some(session)) = db::sessions::get(&conn, $sid) {
                            let _ = app_for_task.emit("session-stopped", &session);
                            let _ = app_for_task.emit(
                                "session-status-changed",
                                &SessionStatusChanged {
                                    session_id: $sid.to_string(),
                                    old_status: SessionStatus::Running,
                                    new_status: session.status,
                                },
                            );
                        }
                    }
                };
            }

            // Spawn the ACP client
            let mut client = match AcpClient::spawn(spawn_config, app_for_task.clone()) {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!(session_id = %session_id_clone, error = %e, "Failed to spawn ACP client for resume");
                    let _ = app_for_task.emit(EVENT_ACP_ERROR, AcpErrorPayload {
                        session_id: session_id_clone.clone(),
                        error: e.to_string(),
                    });
                    with_db!(&session_id_clone, SessionStatus::Error);
                    emit_session_stopped!(&session_id_clone);
                    return;
                }
            };

            // Initialize handshake
            if let Err(e) = client.initialize().await {
                tracing::error!(session_id = %session_id_clone, error = %e, "ACP initialization failed for resume");
                let _ = app_for_task.emit(EVENT_ACP_ERROR, AcpErrorPayload {
                    session_id: session_id_clone.clone(),
                    error: e.to_string(),
                });
                client.shutdown().await;
                with_db!(&session_id_clone, SessionStatus::Error);
                emit_session_stopped!(&session_id_clone);
                return;
            }

            // Load existing session (instead of creating a new one)
            let acp_session_id: acp::SessionId = acp_sid_to_resume.into();
            let load_result = client.load_session(
                acp_session_id.clone(),
                &cwd,
                mcp_servers,
            ).await;

            if let Err(e) = load_result {
                tracing::error!(session_id = %session_id_clone, error = %e, "ACP session/load failed");
                let _ = app_for_task.emit(EVENT_ACP_ERROR, AcpErrorPayload {
                    session_id: session_id_clone.clone(),
                    error: e.to_string(),
                });
                client.shutdown().await;
                with_db!(&session_id_clone, SessionStatus::Error);
                emit_session_stopped!(&session_id_clone);
                return;
            }

            let load_response = load_result.unwrap();

            // Persist the ACP session ID
            {
                let db_state: tauri::State<'_, crate::db::DbState> = app_for_task.state();
                if let Ok(conn) = db_state.lock() {
                    let _ = db::sessions::update_acp_session_id(&conn, &session_id_clone, &acp_session_id.to_string());
                };
            }

            // Emit initial mode from LoadSessionResponse (if present)
            if let Some(ref modes) = load_response.modes {
                let _ = app_for_task.emit(
                    crate::acp::types::EVENT_ACP_MODE_UPDATE,
                    crate::acp::types::AcpModeUpdatePayload {
                        session_id: session_id_clone.clone(),
                        mode: modes.current_mode_id.to_string(),
                    },
                );
            }

            // Store client in ACP state
            tracing::info!(
                session_id = %session_id_clone,
                acp_session_id = %acp_session_id,
                "ACP session loaded — storing state"
            );
            let client = Arc::new(client);
            let shutdown_signal = Arc::new(tokio::sync::Notify::new());
            let shutdown_signal_clone = shutdown_signal.clone();
            {
                let mut state = acp_state_clone.lock().await;
                state.insert(session_id_clone.clone(), AcpSessionState {
                    client,
                    acp_session_id: Some(acp_session_id),
                    pending_permissions: pending_permissions.clone(),
                    shutdown_signal,
                });
            }

            // Update session status to Running
            with_db!(&session_id_clone, SessionStatus::Running);
            let _ = app_for_task.emit(
                "session-status-changed",
                &SessionStatusChanged {
                    session_id: session_id_clone.clone(),
                    old_status: SessionStatus::Starting,
                    new_status: SessionStatus::Running,
                },
            );

            // Wait for shutdown signal (keepalive)
            tracing::info!(
                session_id = %session_id_clone,
                "ACP resumed session ready — waiting for user input"
            );
            shutdown_signal_clone.notified().await;
            tracing::info!(session_id = %session_id_clone, "ACP resume keepalive received shutdown signal — exiting");
        });
    });

    // Notify frontend so it refreshes the session list
    let _ = app.emit("session-started", &session);

    Ok(session)
}

// ── ACP research session ──

/// Options for starting an ACP research session.
pub struct AcpResearchSessionOpts<'a> {
    pub task_id: &'a str,
    pub agent_name: Option<&'a str>,
    pub model: Option<&'a str>,
    pub user_prompt: Option<&'a str>,
}

/// Start a research session using ACP transport.
///
/// Like `start_research_session()` but uses structured chat UI instead of PTY terminal.
/// Research sessions always run in the project root (no worktree creation).
#[allow(clippy::too_many_arguments)]
pub fn start_acp_research_session(
    conn: &Connection,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: &AcpState,
    mcp_port: u16,
    project_id: &str,
    opts: &AcpResearchSessionOpts<'_>,
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

    // Validate agent supports ACP
    let (acp_command, acp_args) = validate_acp_agent(adapter.as_ref(), agent_name)?;

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

    // 8. Register MCP session data
    let mcp_conn = register_acp_mcp_session(
        mcp_state, mcp_port, &session_id, Path::new(cwd),
        agent_name, Some(project_id), Some(opts.task_id), Some("research"),
    );

    // 9. Generate user prompt from template (research-focused)
    let prompt_content = if opts.user_prompt.is_none_or(|s| s.trim().is_empty()) {
        let template = crate::commands::prompts::get_session_prompt(conn, "research");
        let mut vars = HashMap::new();
        vars.insert("task_id", opts.task_id);
        interpolate_vars(&template.prompt, &vars)
    } else {
        opts.user_prompt.unwrap().to_string()
    };

    // 10. Spawn ACP session — NOTE: no task status change for research mode
    let setup = AcpSessionSetup {
        session_id,
        project_id: project_id.to_string(),
        cwd: PathBuf::from(cwd),
        agent_name: agent_name.to_string(),
        model,
        mode: SessionMode::Research,
        task_id: Some(opts.task_id.to_string()),
        name: Some(task.id.clone()),
        worktree_path: None,
        prompt_content,
        is_trust_mode: false,
    };

    spawn_acp_session(conn, app, mcp_state, acp_state, setup, acp_command, acp_args, mcp_conn)
}

// ── Breakdown session (epic decomposition) ──

/// Options for starting a breakdown session (PTY).
pub struct BreakdownSessionOpts<'a> {
    pub task_id: &'a str,
    pub agent_name: Option<&'a str>,
    pub model: Option<&'a str>,
    pub user_prompt: Option<&'a str>,
}

/// Start a breakdown session for an epic task (PTY transport).
///
/// Breakdown sessions run in the project root (no worktree) and use a specialized
/// prompt to decompose an epic into child tasks via the `create_task` MCP tool.
#[allow(clippy::too_many_arguments)]
pub fn start_breakdown_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    mcp_port: u16,
    project_id: &str,
    opts: &BreakdownSessionOpts<'_>,
) -> Result<Session, AppError> {
    // 1. Fetch project
    let project = db::projects::get(conn, project_id)?
        .ok_or_else(|| AppError::NotFound(format!("Project {project_id}")))?;

    // 2. Fetch task (must be an epic)
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
    let mcp_conn = inject_mcp(mcp_state, mcp_port, &session_id, Path::new(cwd), agent_name, Some(project_id), Some(opts.task_id), Some("breakdown"));

    // 9. Generate user prompt from template (breakdown-focused)
    let user_prompt_str = if opts.user_prompt.is_none_or(|s| s.trim().is_empty()) {
        let template = crate::commands::prompts::get_session_prompt(conn, "breakdown");
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
        mode: SessionMode::Breakdown,
        transport: SessionTransport::Pty,
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

    // 14. Emit event — NO task status update (breakdown mode)
    let session = db::sessions::get(conn, &session.id)?
        .ok_or_else(|| AppError::Database("Session disappeared after creation".into()))?;
    let _ = app.emit("session-started", &session);

    Ok(session)
}

/// Options for starting an ACP breakdown session.
pub struct AcpBreakdownSessionOpts<'a> {
    pub task_id: &'a str,
    pub agent_name: Option<&'a str>,
    pub model: Option<&'a str>,
    pub user_prompt: Option<&'a str>,
}

/// Start a breakdown session using ACP transport.
#[allow(clippy::too_many_arguments)]
pub fn start_acp_breakdown_session(
    conn: &Connection,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: &AcpState,
    mcp_port: u16,
    project_id: &str,
    opts: &AcpBreakdownSessionOpts<'_>,
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

    // Validate agent supports ACP
    let (acp_command, acp_args) = validate_acp_agent(adapter.as_ref(), agent_name)?;

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

    // 8. Register MCP session data
    let mcp_conn = register_acp_mcp_session(
        mcp_state, mcp_port, &session_id, Path::new(cwd),
        agent_name, Some(project_id), Some(opts.task_id), Some("breakdown"),
    );

    // 9. Generate user prompt from template (breakdown-focused)
    let prompt_content = if opts.user_prompt.is_none_or(|s| s.trim().is_empty()) {
        let template = crate::commands::prompts::get_session_prompt(conn, "breakdown");
        let mut vars = HashMap::new();
        vars.insert("task_id", opts.task_id);
        interpolate_vars(&template.prompt, &vars)
    } else {
        opts.user_prompt.unwrap().to_string()
    };

    // 10. Spawn ACP session
    let setup = AcpSessionSetup {
        session_id,
        project_id: project_id.to_string(),
        cwd: PathBuf::from(cwd),
        agent_name: agent_name.to_string(),
        model,
        mode: SessionMode::Breakdown,
        task_id: Some(opts.task_id.to_string()),
        name: Some(task.id.clone()),
        worktree_path: None,
        prompt_content,
        is_trust_mode: false,
    };

    spawn_acp_session(conn, app, mcp_state, acp_state, setup, acp_command, acp_args, mcp_conn)
}

// ── Relaunch session ──

/// Relaunch a stopped/finished/error session with the same configuration.
/// Creates a new session record and PTY (or ACP client). For task sessions,
/// reuses the existing worktree instead of creating a new one.
#[allow(clippy::too_many_arguments)]
pub fn relaunch_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: Option<&AcpState>,
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
            let mcp_conn = inject_mcp(mcp_state, mcp_port, &new_session_id, Path::new(cwd), agent_name, Some(&old.project_id), old.task_id.as_deref(), Some(old.mode.as_str()));

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

            // Create session record (preserve original mode and transport)
            let new_session = NewSession {
                project_id: old.project_id.clone(),
                task_id: Some(task_id.to_string()),
                name: old.name.clone().or_else(|| Some(task.id.clone())),
                mode: old.mode,
                transport: old.transport,
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
            let new_session = if old.transport == SessionTransport::Acp {
                let acp = acp_state.ok_or_else(|| AppError::Validation(
                    "ACP state required for relaunching ACP vibe session".into(),
                ))?;
                let opts = AcpVibeSessionOpts {
                    agent_name: Some(&old.agent),
                    model: old.model.as_deref(),
                    create_worktree: false,
                    base_branch: None,
                    user_prompt: None,
                };
                start_acp_vibe_session(conn, app, mcp_state, acp, mcp_port, &old.project_id, &opts)?
            } else {
                let opts = VibeSessionOpts {
                    agent_name: Some(&old.agent),
                    model: old.model.as_deref(),
                    create_worktree: false,
                    base_branch: None,
                    user_prompt: None,
                };
                start_vibe_session(conn, pty_state, app, mcp_state, mcp_port, &old.project_id, &opts)?
            };
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
            let new_session = if old.transport == SessionTransport::Acp {
                let acp = acp_state.ok_or_else(|| AppError::Validation(
                    "ACP state required for relaunching ACP research session".into(),
                ))?;
                let opts = AcpResearchSessionOpts {
                    task_id,
                    agent_name: Some(&old.agent),
                    model: old.model.as_deref(),
                    user_prompt: None,
                };
                start_acp_research_session(conn, app, mcp_state, acp, mcp_port, &old.project_id, &opts)?
            } else {
                let opts = ResearchSessionOpts {
                    task_id,
                    agent_name: Some(&old.agent),
                    model: old.model.as_deref(),
                    user_prompt: None,
                };
                start_research_session(conn, pty_state, app, mcp_state, mcp_port, &old.project_id, &opts)?
            };
            let _ = db::sessions::delete(conn, session_id);
            Ok(new_session)
        }

        SessionMode::Chat => {
            let acp = acp_state.ok_or_else(|| AppError::Validation(
                "ACP state required for relaunching chat session".into(),
            ))?;
            let opts = AcpChatSessionOpts {
                agent_name: Some(&old.agent),
                model: old.model.as_deref(),
                user_prompt: None,
            };
            let new_session = start_acp_chat_session(conn, app, mcp_state, acp, mcp_port, &old.project_id, &opts)?;
            let _ = db::sessions::delete(conn, session_id);
            Ok(new_session)
        }

        SessionMode::Breakdown => {
            let task_id = old.task_id.as_deref()
                .ok_or_else(|| AppError::Validation("Breakdown session has no task_id".into()))?;
            let new_session = if old.transport == SessionTransport::Acp {
                let acp = acp_state.ok_or_else(|| AppError::Validation(
                    "ACP state required for relaunching ACP breakdown session".into(),
                ))?;
                let opts = AcpBreakdownSessionOpts {
                    task_id,
                    agent_name: Some(&old.agent),
                    model: old.model.as_deref(),
                    user_prompt: None,
                };
                start_acp_breakdown_session(conn, app, mcp_state, acp, mcp_port, &old.project_id, &opts)?
            } else {
                let opts = BreakdownSessionOpts {
                    task_id,
                    agent_name: Some(&old.agent),
                    model: old.model.as_deref(),
                    user_prompt: None,
                };
                start_breakdown_session(conn, pty_state, app, mcp_state, mcp_port, &old.project_id, &opts)?
            };
            let _ = db::sessions::delete(conn, session_id);
            Ok(new_session)
        }
    }
}

// ── ACP shutdown helper ──

/// Shutdown an ACP session synchronously (for use from sync contexts).
/// Spawns a blocking task to cleanly shut down the ACP client.
///
/// If `app` is provided, also removes the session from the
/// `PendingPermissionsRegistry` so stale entries don't accumulate.
pub fn shutdown_acp_client(acp_state: &AcpState, session_id: &str, app: Option<&AppHandle>) {
    // Clean up the pending permissions registry (synchronous, quick)
    if let Some(app) = app {
        let registry: tauri::State<'_, crate::acp::state::PendingPermissionsRegistry> = app.state();
        let mut reg = registry.blocking_lock();
        reg.remove(session_id);
    }

    let acp_state = acp_state.clone();
    let session_id = session_id.to_string();

    // Use a blocking task to shut down the ACP client
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to build tokio runtime for ACP shutdown");

        rt.block_on(async move {
            let mut state = acp_state.lock().await;
            if let Some(session_state) = state.remove(&session_id) {
                // Signal the keepalive thread (for sessions without an initial prompt)
                // to exit so its LocalSet drops cleanly.
                session_state.shutdown_signal.notify_one();

                // Cancel any in-progress prompt
                if let Some(ref acp_sid) = session_state.acp_session_id {
                    let _ = session_state.client.cancel(acp_sid.clone()).await;
                }

                // Try to get exclusive ownership for clean shutdown
                match Arc::try_unwrap(session_state.client) {
                    Ok(mut client) => {
                        client.shutdown().await;
                    }
                    Err(arc) => {
                        // Another reference still exists (prompt in progress).
                        // Kill the process tree as fallback — the Arc will clean up
                        // when the last reference is dropped.
                        if let Some(pid) = arc.pid() {
                            crate::pty::kill_process_tree(pid, "acp-agent");
                        }
                        tracing::warn!(session_id = %session_id, "ACP client still referenced — killed process tree");
                    }
                }
                tracing::info!(session_id = %session_id, "ACP session shut down");
            }
        });
    });
}

// ── Stop session ──

pub fn stop_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: Option<&AcpState>,
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

    // 2. Kill PTY or shutdown ACP client depending on transport
    match session.transport {
        SessionTransport::Pty => {
            pty::kill(pty_state, session_id)?;
        }
        SessionTransport::Acp => {
            if let Some(acp) = acp_state {
                shutdown_acp_client(acp, session_id, Some(app));
            }
        }
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

    // 6. Pause queue mode if this session was manually stopped
    queue::handle_manual_stop(app, session_id);

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
/// All cleanup logic (PTY kill, MCP, worktree, queue mode) mirrors
/// `stop_session` exactly — the only difference is that we delete from DB
/// and emit `session-removed` instead of updating status + emitting `session-stopped`.
pub fn stop_and_remove_session(
    conn: &Connection,
    pty_state: &PtyState,
    app: &AppHandle,
    mcp_state: &Arc<TokioMutex<McpState>>,
    acp_state: Option<&AcpState>,
    session_id: &str,
) -> Result<(), AppError> {
    // 1. Get session — if already gone, that's fine
    let session = match db::sessions::get(conn, session_id)? {
        Some(s) => s,
        None => return Ok(()),
    };

    // 2. Kill PTY or shutdown ACP client if session is active
    if matches!(
        session.status,
        SessionStatus::Starting | SessionStatus::Running | SessionStatus::Paused
    ) {
        match session.transport {
            SessionTransport::Pty => {
                let _ = pty::kill(pty_state, session_id);
            }
            SessionTransport::Acp => {
                if let Some(acp) = acp_state {
                    shutdown_acp_client(acp, session_id, Some(app));
                }
            }
        }
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

    // 5. Pause queue mode if this session was manually stopped
    queue::handle_manual_stop(app, session_id);

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
        assert!(result.contains("get_instructions"));
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
        assert!(content.contains("get_instructions"));
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
