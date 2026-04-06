use tauri::Manager;
#[allow(unused_imports)]
use tracing::{error, info, warn};

mod acp;
mod agent;
mod commands;
mod config_watcher;
mod queue;
mod db;
mod error;
mod font_detector;
mod git;
mod github;
mod logging;
mod mcp;
mod project_config;
mod pty;
mod session;
mod task_logger;
mod task_watcher;
mod tasks;
mod usage;

/// Managed state holding the log directory path.
pub(crate) struct LogDir(pub std::path::PathBuf);

/// On macOS, GUI apps launched from Finder/Dock inherit a minimal system PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`) that doesn't include directories where
/// CLI tools are typically installed (Homebrew, npm globals, cargo, etc.).
/// They also miss environment variables set in shell profiles (e.g. GITHUB_TOKEN).
///
/// This function runs the user's default login shell to resolve their full PATH
/// and important environment variables, then applies them to the current process
/// so that `is_command_in_path()`, PTY spawns, `gh auth`, and any other child
/// processes see the same environment as a terminal.
#[cfg(target_os = "macos")]
fn fix_path_env() {
    use std::process::Command;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // Environment variables to capture from the user's login shell.
    // PATH is essential for finding CLI tools.
    // GitHub/GH tokens are needed for `gh` CLI authentication when set as env vars.
    // EDITOR/VISUAL are used by git and other tools.
    const VARS_TO_CAPTURE: &[&str] = &[
        "PATH",
        "GITHUB_TOKEN",
        "GH_TOKEN",
        "GH_HOST",
        "EDITOR",
        "VISUAL",
    ];

    // Build a shell command that prints each var with a unique marker prefix.
    // Using a marker avoids capturing MOTD or shell greeting output.
    let print_commands: Vec<String> = VARS_TO_CAPTURE
        .iter()
        .map(|var| format!("echo __FABER_{var}__=${{{var}}}"))
        .collect();
    let shell_cmd = print_commands.join("; ");

    // Run a login+interactive shell that prints the vars, then exits.
    // `-l` sources profile files (.zprofile, .bash_profile, etc.).
    // `-i` sources rc files (.zshrc, .bashrc) where tools like nvm/volta add
    // themselves. `-c` runs a command and exits.
    let output = Command::new(&shell)
        .args(["-l", "-i", "-c", &shell_cmd])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut resolved_count = 0u32;

        for var in VARS_TO_CAPTURE {
            let marker = format!("__FABER_{var}__=");
            if let Some(line) = stdout.lines().find(|l| l.starts_with(&marker)) {
                let value = line.trim_start_matches(&marker);
                if !value.is_empty() {
                    if *var == "PATH" {
                        tracing::info!(entries = value.matches(':').count() + 1, "macOS: Resolved shell PATH");
                    } else {
                        tracing::info!(var, "macOS: Resolved shell env var");
                    }
                    std::env::set_var(var, value);
                    resolved_count += 1;
                }
            }
        }

        if resolved_count > 0 {
            return;
        }
    }
    tracing::warn!("macOS: Could not resolve shell environment, using system defaults");
}

/// Create a `Command` that won't spawn a visible console window on Windows.
///
/// In release builds the app uses `windows_subsystem = "windows"` (no parent
/// console), so every `Command::new()` would flash a cmd window. Adding the
/// `CREATE_NO_WINDOW` creation flag prevents this.
pub(crate) fn cmd_no_window(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Apply platform-native window vibrancy effects.
///
/// On Windows the window starts with `decorations: false` + `transparent: true`
/// to avoid the opaque softbuffer surface bug, then Acrylic is applied via
/// `window-vibrancy::apply_acrylic()`.
/// See: https://github.com/tauri-apps/tauri/issues/8632
///
/// On macOS, `macOSPrivateApi: true` + `transparent: true` enables
/// `NSVisualEffectView` vibrancy via the `window-vibrancy` crate.
/// Note: macOS 26 Tahoe changed ObjC method type encodings (signed →
/// unsigned), requiring `objc2`'s `relax-sign-encoding` feature (tao#1171).
fn apply_vibrancy(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_acrylic;
        match apply_acrylic(window, Some((255, 255, 255, 0))) {
            Ok(_) => info!("Windows: Acrylic vibrancy applied"),
            Err(e) => warn!(?e, "Windows: Acrylic vibrancy failed"),
        }
    }

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
        match apply_vibrancy(window, NSVisualEffectMaterial::HudWindow, None, None) {
            Ok(_) => info!("macOS: HudWindow vibrancy applied"),
            Err(e) => warn!(?e, "macOS: vibrancy failed"),
        }
    }

    let _ = window.set_shadow(true);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Fix PATH on macOS so CLI agent detection and PTY spawns work
            #[cfg(target_os = "macos")]
            fix_path_env();

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).expect("failed to create app data dir");

            // Initialize file-based logging (must happen before any tracing calls)
            let log_dir = logging::init(&data_dir);
            info!(path = %log_dir.display(), "Logging initialized");
            info!(
                version = env!("CARGO_PKG_VERSION"),
                os = std::env::consts::OS,
                arch = std::env::consts::ARCH,
                "Starting Faber"
            );
            app.manage(LogDir(log_dir));

            // Use a separate database for debug builds to avoid conflicts
            // when running dev (`tauri dev`) alongside a production install.
            let db_name = if cfg!(debug_assertions) {
                "faber-dev.db"
            } else {
                "faber.db"
            };
            let db_path = data_dir.join(db_name);
            let db_state = db::init(&db_path).expect("failed to initialize database");
            info!(path = %db_path.display(), "Database initialized");

            // Clean up sessions orphaned by a previous crash/force-quit.
            // PTY processes don't survive app restart, so any "active" sessions are stale.
            {
                let conn = db_state.lock().expect("failed to lock db for cleanup");
                match db::sessions::cleanup_orphaned(&conn) {
                    Ok(0) => {}
                    Ok(n) => info!(count = n, "Cleaned up orphaned sessions"),
                    Err(e) => error!(%e, "Failed to clean up orphaned sessions"),
                }
            }

            app.manage(db_state);
            app.manage(pty::new_state());
            app.manage(queue::new_state());
            app.manage(task_watcher::new_state());
            app.manage(config_watcher::new_state());
            app.manage(acp::state::new_state());
            app.manage(acp::state::new_pending_permissions_registry());

            // Initialize usage registry for agent quota tracking
            let usage_registry = std::sync::Arc::new(
                tokio::sync::Mutex::new(usage::registry::UsageRegistry::new()),
            );
            app.manage(usage_registry);

            // Start embedded MCP server for agent status reporting
            let app_handle = app.handle().clone();
            match tauri::async_runtime::block_on(mcp::server::start_mcp_server(app_handle)) {
                Ok(mcp_state) => {
                    app.manage(mcp_state);
                }
                Err(e) => {
                    error!(%e, "Failed to start MCP server (continuing without it)");
                }
            }

            // Apply native vibrancy effect to the main window
            if let Some(window) = app.get_webview_window("main") {
                apply_vibrancy(&window);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::create_project,
            commands::projects::add_project,
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::update_project,
            commands::projects::remove_project,
            commands::projects::get_project_info,
            commands::projects::read_instruction_file,
            commands::projects::get_project_branches,
            commands::projects::resolve_project_icon,
            commands::projects::read_svg_icon,
            commands::git::list_branches,
            commands::git::create_branch,
            commands::git::create_worktree,
            commands::git::list_worktrees,
            commands::git::delete_worktree,
            commands::git::get_worktree_disk_usage,
            commands::git::get_changed_files,
            commands::git::get_file_diff,
            commands::git::get_branch_files,
            commands::git::get_branch_diff,
            commands::git::commit_staged,
            commands::git::commit_amend,
            commands::git::stage_file,
            commands::git::unstage_file,
            commands::git::discard_file,
            commands::git::get_last_commit_message,
            commands::git::get_staged_diff,
            commands::git::push_branch,
            commands::git::create_pull_request,
            commands::git::merge_worktree_branch,
            commands::git::get_project_branch,
            commands::git::has_remote,
            commands::git::is_branch_merged,
            commands::git::git_commit_log,
            commands::git::git_refs_for_commit,
            commands::git::git_refs_batch,
            commands::git::git_commit_detail,
            commands::git::git_head_hash,
            commands::git::get_sync_status,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::list_all_branches,
            commands::git::checkout_branch,
            commands::tasks::list_tasks,
            commands::tasks::get_task,
            commands::tasks::sync_tasks,
            commands::tasks::create_task,
            commands::tasks::update_task_status,
            commands::tasks::get_task_file_content,
            commands::tasks::save_task_content,
            commands::tasks::set_task_type,
            commands::tasks::delete_task,
            commands::tasks::detect_task_conflicts,
            commands::tasks::resolve_task_conflicts,
            commands::tasks::get_task_activity,
            commands::tasks::get_project_priorities,
            commands::tasks::start_task_watcher,
            commands::tasks::stop_task_watcher,
            commands::tasks::start_config_watcher,
            commands::tasks::stop_config_watcher,
            commands::pty::spawn_pty,
            commands::pty::write_pty,
            commands::pty::resize_pty,
            commands::pty::kill_pty,
            commands::pty::list_pty_sessions,
            commands::agents::list_agents,
            commands::agents::check_agent_installed,
            commands::agents::install_acp_adapter,
            commands::agents::fetch_acp_registry,
            commands::agents::get_agent_config,
            commands::agents::upsert_agent_config,
            commands::agents::delete_agent_config,
            commands::sessions::start_task_session,
            commands::sessions::start_vibe_session,
            commands::sessions::start_shell_session,
            commands::sessions::start_skill_install_session,
            commands::sessions::start_research_session,
            commands::sessions::start_breakdown_session,
            commands::sessions::start_chat_session,
            commands::sessions::send_acp_message,
            commands::sessions::cancel_acp_session,
            commands::sessions::stop_acp_session,
            commands::sessions::get_acp_capabilities,
            commands::sessions::set_acp_mode,
            commands::sessions::set_acp_config_option,
            commands::sessions::get_acp_terminal_output,
            commands::sessions::list_agent_sessions,
            commands::sessions::resume_acp_session,
            commands::sessions::relaunch_session,
            commands::sessions::rename_session,
            commands::sessions::stop_session,
            commands::sessions::stop_and_remove_session,
            commands::sessions::remove_session,
            commands::sessions::list_sessions,
            commands::sessions::get_session,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::get_all_settings,
            commands::settings::list_installed_agents,
            commands::settings::list_available_shells,
            commands::prompts::get_prompt_templates,
            commands::prompts::set_prompt_templates,
            commands::prompts::reset_prompt_templates,
            commands::fonts::get_available_fonts,
            commands::fonts::check_font_available,
            commands::mcp::get_mcp_info,
            commands::github::check_gh_auth,
            commands::github::list_github_issues,
            commands::github::import_github_issues,
            commands::github::close_github_issue,
            commands::github::reopen_github_issue,
            commands::github::fetch_repo_labels,
            commands::github::create_repo_label,
            commands::github::check_pr_merged,
            commands::github::set_task_github_pr,
            commands::github::list_pull_requests,
            commands::github::get_pr_detail,
            commands::github::merge_pull_request,
            commands::github::close_pull_request,
            commands::github::create_github_issue,
            commands::github::update_github_issue,
            commands::github::fetch_github_issue,
            commands::github::fetch_issue_comments,
            commands::github::post_issue_comment,
            commands::github::get_project_setting,
            commands::github::set_project_setting,
            commands::docs::list_docs,
            commands::docs::get_doc_content,
            commands::docs::get_log_directory,
            commands::docs::open_log_directory,
            commands::updates::check_for_updates,
            commands::updates::download_and_install_update,
            commands::updates::get_app_version,
            commands::queue::validate_queue_deps,
            commands::queue::start_queue_mode,
            commands::queue::pause_queue_mode,
            commands::queue::resume_queue_mode,
            commands::queue::stop_queue_mode,
            commands::queue::dismiss_queue_mode,
            commands::queue::get_queue_mode_status,
            commands::queue::get_integration_branch,
            commands::queue::resolve_merge_conflict,
            commands::queue::skip_conflicted_task,
            commands::queue::cleanup_integration_branch,
            commands::queue::push_integration_branch,
            commands::usage::get_agent_usage,
            commands::files::list_directory,
            commands::files::index_project_files,
            commands::files::open_file_in_os,
            commands::files::detect_editors,
            commands::files::open_in_editor,
            commands::plugins::list_plugins,
            commands::plugins::get_plugin_readme,
            commands::plugins::install_plugin,
            commands::plugins::uninstall_plugin,
            commands::plugins::toggle_plugin,
            commands::plugins::update_plugin,
            commands::plugins::add_marketplace,
            commands::plugins::remove_marketplace,
            commands::plugins::update_marketplaces,
            commands::skills::list_instruction_files,
            commands::skills::read_instruction_file_content,
            commands::skills::save_instruction_file,
            commands::skills::list_rule_files,
            commands::skills::read_rule_file_content,
            commands::skills::save_rule_file,
            commands::skills::create_rule_file,
            commands::skills::list_installed_skills,
            commands::skills::read_skill_content,
            commands::skills::search_skills,
            commands::skills::remove_skill,
            commands::acp_permissions::list_permission_rules,
            commands::acp_permissions::create_permission_rule,
            commands::acp_permissions::delete_permission_rule,
            commands::acp_permissions::reset_permission_rules,
            commands::acp_permissions::get_permission_log,
            commands::acp_permissions::respond_permission,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Kill all active PTY sessions (and their process trees) on exit.
            // Without this, agent CLIs and their faber-mcp sidecar children
            // can survive as orphans — especially on Windows where process
            // tree cleanup is not automatic.
            if let Some(pty_state) = app_handle.try_state::<pty::PtyState>() {
                pty::kill_all(&pty_state);
            }

            // Kill all active ACP agent subprocesses (and their process trees).
            // ACP agents use `kill_on_drop(true)` but that's best-effort and
            // only kills the direct child — not grandchildren like faber-mcp
            // sidecars. Explicit tree killing ensures nothing lingers.
            if let Some(acp_state) = app_handle.try_state::<acp::state::AcpState>() {
                let mut sessions = acp_state.blocking_lock();
                for (id, session_state) in sessions.drain() {
                    if let Some(pid) = session_state.client.pid() {
                        pty::kill_process_tree(pid, &id);
                        info!(session_id = %id, pid, "Killed ACP agent process tree on app exit");
                    }
                }
            }
        }
    });
}
