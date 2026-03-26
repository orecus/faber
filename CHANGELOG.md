# Changelog

All notable changes to Faber will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.2] - 2026-03-xx WIP

### Added

- **Settings View** — Dedicated full-screen settings page with master-detail layout replacing the old sidebar modals. Eight organized tabs split into App-scoped (General, Terminal, Agents, Prompts) and Project-scoped (Project, Git & Worktrees, ACP Permissions, GitHub) sections. Open with **Ctrl+,** or from the command palette
- **Status Bar** — New bottom bar showing MCP status and port, GitHub auth status, top agent usage percentage, context-sensitive keyboard shortcuts, and app version
- **File Search** — File browser now preloads a project file index in the background and supports client-side filtering with highlighted search matches. Re-indexes automatically when files change
- **File Context Menu** — Right-click any file in the tree for quick actions: copy relative path, copy absolute path, reveal in file explorer, or open in an external editor (auto-detects VS Code, Cursor, Zed, Windsurf, Fleet, Sublime, Vim, Neovim)
- **Success Toasts** — Green flash notifications (3-second auto-dismiss) for confirming actions like ACP adapter installs and session renames
- **Editor Detection** — Backend probes PATH for 8 known editors and exposes `detect_editors` / `open_in_editor` IPC commands
- **Project File Indexing** — New `index_project_files` Rust command recursively indexes project files (skipping hidden dirs, node_modules, target, .git) for fast client-side search

### Changed

- **Settings Architecture** — Moved all settings from sidebar dialog modals into the new dedicated Settings view. Sidebar gear icon and Ctrl+, both navigate to the settings page. Git & Worktrees settings (branch naming, instruction files) now have their own tab instead of being buried in the Project tab
- **ToggleRow Component** — Replaced repetitive inline Checkbox + label patterns across settings tabs with a shared `ToggleRow` component using the Switch primitive
- **ACP Adapter Updates** — Install command now pins to the exact registry version (e.g., `npm install -g @package@0.24.1`), invalidates npm and registry caches after install, and extracts user-friendly error messages from npm stderr instead of dumping raw output
- **Agent Registry Logging** — Enhanced diagnostic logging throughout the registry (debug for cache hits, info for version checks) with improved error handling for non-semver formats and npm non-zero exit codes
- **Focus-Within Accessibility** — Action buttons on task cards, chat messages, dependency graph rows, quick action bar, and task body now appear on focus-within (not just hover) for keyboard accessibility
- **Session Grid Resize Handles** — Column and row resize handles now show centered dot indicators on hover for better discoverability
- **Session Pane** — Removed reorder arrows (drag-and-drop is the primary method); added brief "Saved" indicator after session rename; wider rename input field
- **Permission Dialog Urgency** — Timeout bar is thicker and the urgent state (last 30 seconds) now pulses with an animation
- **Command Palette** — Added "Go to Settings" navigation command

### Fixed

- **ACP Adapter Install on Windows** — npm install now hides the console window (CREATE_NO_WINDOW flag) to prevent a flash of a terminal window

## [0.9.1] - 2026-03-xx WIP

### Added

- **Epics** — Group related tasks under an epic. Create epics from the dashboard or task detail, assign child tasks, and track progress with a completion bar. Epic status updates automatically as children advance. Kanban columns nest children under their epic with visual indentation
- **Breakdown Sessions** — Let an AI agent decompose an epic into concrete child tasks. A dedicated session mode guides the agent through analyzing the epic and creating subtasks
- **Chat Git Controls** — A git context bar in chat sessions with branch switching, worktree creation, push, create PR, and merge — all without leaving the conversation
- **Research Completion** — Research sessions now have their own completion signal that moves tasks from Backlog to Ready without triggering the full task lifecycle
- **Thinking Level Selector** — Agents that support reasoning levels (e.g., OpenCode) show a thinking level picker in the chat toolbar
- **OpenCode Model Discovery** — Available models and thinking levels are now detected automatically from OpenCode, with grouped provider selectors in the config popover
- **Custom Priority Levels** — Define your own priority scheme per project instead of the default P0/P1/P2. Configure priority IDs, labels, colors (from the full ThemeColor palette), and sort order in project settings. Existing projects get P0/P1/P2 defaults for backward compatibility
- **Epic Filters** — Filter the Kanban board by epic; summary header shows an epic count alongside existing metrics
- **Research Complete Bar** — Shows the agent's last message in a card above the action bar, with a Close Session button alongside Continue to Implementation and Dismiss
- **Task File Conflict Resolution** — Re-enabling "Save tasks to disk" detects conflicts between files on disk and database tasks, and shows a dialog to resolve them

### Changed

- **Chat Timeline** — Messages, tool calls, and thinking blocks now appear as a single unified timeline with better streaming, turn tracking, and thinking duration display
- **Agent Instructions** — MCP tool descriptions rewritten with clearer guidance, and agents now only see tools relevant to their session type (task, research, breakdown, etc.)
- **Tool Call Cards** — Richer detail in collapsed tool cards: edit operations show line counts, and more tool types (search, web fetch, etc.) display useful parameters at a glance
- **Continuous Mode** — Completed sessions now stay open so you can review the agent's output before moving on
- **Chat Narration** — Faber's own MCP tool calls (status updates, progress reports) no longer break the agent's message into separate bubbles
- **Chat Message Filtering** — System-injected content (instructions, tool definitions) is filtered from the timeline so you only see genuine messages

### Fixed

- **Chat Authentication** — Sessions no longer fail to start when an agent advertises an auth method it doesn't fully support
- **Windows Agent Launch** — Fixed npm-installed CLI agents not launching correctly on Windows
- **New Task Visibility** — Tasks created by agents (e.g., during epic breakdown) now appear on the board immediately
- **Chat Waiting Detection** — The "waiting for input" indicator now triggers reliably in chat sessions
- **MCP get_task Empty Body** — Fixed task body returning empty when tasks are only stored in the database
- **Save Tasks to Disk Toggle** — MCP tools now work correctly when file-based task storage is turned off

## [0.9.0] - 2026-03-21

### Added

- **ACP (Agent Client Protocol)** — Structured agent communication via typed JSON-RPC as an alternative to PTY sessions. Real-time streaming of messages, tool calls, thinking blocks, and plans. New `SessionTransport` layer so every session type works in either PTY or ACP mode
- **Project Chat** — Lightweight chat view for conversations with ACP agents — discuss architecture, explore ideas, or ask questions without task binding or worktree. Includes attachments, slash commands, edit-and-resend, reasoning display, and tool call visualization
- **ACP Permissions** — Per-project permission rules with glob patterns, three actions (auto-approve, ask, deny), trust mode for continuous sessions, audit log, in-session approval dialogs, and a dedicated settings tab
- **Agent Registry & Extensions** — Auto-discovery and version tracking of ACP adapters. Extensions tab (renamed from Skills & Rules) shows install status, updates, and install commands
- **ACP Session Persistence** — Resume past conversations across app restarts via `session/list` and `session/load` protocol. Chat view includes a session history sidebar with search and resume
- **Task Detail GitHub Tab** — View live GitHub issue body, labels, metadata, comment thread, and compose comments without leaving the task view
- **GitHub Copilot CLI Agent** — Added Copilot CLI as the 6th supported agent
- **Research → Implementation Flow** — Completed research sessions offer a prompt to continue to implementation, pre-filling the Launch Task dialog
- **Create Project Dialog** — Scaffold new projects from the sidebar or Welcome Screen with git init and auto-registration
- **Kanban Column Sorting** — Six sort modes (Dependencies, Priority, Newest, Oldest, Alphabetical, Agent) persisted per session
- **Kanban Column Collapsing** — Collapse columns into narrow strips showing name and task count
- **Task Card Context Menu** — Right-click for quick actions: rename, change status, set priority, assign agent, manage labels, archive/delete
- **Dashboard Filters** — Status filter toggles, per-project filter persistence, task card label badges, archive view with restore/delete, and "ready"/"blocked" counts in the summary header
- **Create Task Advanced Fields** — Labels, dependencies, and agent assignment available at task creation
- **GitHub Improvements** — Dedicated settings tab, sync confirmation dialog with field selection, issue detail panel, and shared auth gate component
- **Sidebar Branch Info** — Branch name and change count shown inline per project
- Transport selector in launch dialogs, permission notifications, agent install hints, chat close confirmation, chat draft persistence, chat waiting card, narration mode toggle

### Changed

- **Continuous Mode** — Now supports ACP transport with trust mode policies
- **Session Pane ACP Rendering** — ACP sessions render as chat with permission-request visual states
- **Consolidated Diff Views** — Shared `DiffView` component replaces duplicated ReviewView and ChangesTab implementations
- **Settings Consolidation** — Merged Notifications into General settings; GitHub sync settings moved to dedicated tab
- **Bundle Optimization** — Vendor chunk splitting and `startTransition` for smoother view switches
- **Welcome Screen** — Agent section redesigned as card grid with live detection status
- Smart back navigation, launcher dialog consolidation, task detail title in header bar, ACP session styling, chat two-column layout, ACP badge on all agent cards

### Fixed

- **Skill Install Shell** — Fixed shell closing immediately
- **GitHub Multi-Account Auth** — Fixed parsing for multi-source authentication
- **Research Session Completion** — No longer incorrectly advances task status beyond "ready"
- **Chat Sessions Filtered from Grid** — Chat sessions only appear in the Chat view

## [0.8.1] - 2026-03-06

### Added

- **Merge Branch Dialog** — Merge button in the Review view now opens a dialog where you can choose which branch to merge into, instead of always targeting main
- **Remote Detection** — Push, Create PR, Pull, and Push buttons are automatically disabled for local-only repos (no git remote), with "No remote configured" empty states in the Issues and Pull Requests tabs
- **Merge Status Detection** — Merge button detects when a branch has already been merged and disables itself with a "Merged" label
- **Delete Branch with Worktree** — Worktree delete confirmation dialog now includes an optional "Also delete branch" checkbox to clean up the branch alongside the worktree
- **Parallel Continuous Mode** — Independent branching strategy now launches all task sessions simultaneously instead of sequentially, with per-task error handling that doesn't pause the entire run
- **Continuous Mode Dismiss Flow** — Sessions stay alive after completion so users can review agent summaries; a new "Dismiss" action in the bar closes all related sessions at once
- **Continuous Mode Bar in Sessions** — The continuous mode progress bar now appears in both the Tasks and Sessions views
- **Task Detail Redesign** — Redesigned TaskDetail view with task activity log stored in DB, GitHub comments display, and direct GitHub issue creation from the app
- **Task Detail Actions** — Status-aware action buttons in the task detail toolbar: Start Task / Research (backlog/ready), View Session (in-progress), Create PR (in-review), Archive / Reopen (done/archived)
- **Kanban Dependency Nesting** — Tasks with dependencies are now visually nested (indented) under their parent in all Kanban columns, with ghost parent cards shown for cross-column dependencies
- **MCP Task Management Tools** — New `update_task` and `list_tasks` MCP tools allowing agents to update task metadata and query project tasks with status/label filters
- **Prompt Templates & Quick Actions** — Unified configurable prompt template system with `{{variable}}` interpolation for all session types (task, research, continuous). Quick Action buttons appear on active session panes on hover, sending one-click prompts to agents. Manage templates and actions from the new Prompts settings dialog in the sidebar
- **Plugins Tab** — New plugins management tab in Skills & Rules view for browsing and managing agent plugins
- **Rule Editor & Tree Panel** — Dedicated rule editor with tree-based navigation panel for organizing and editing rules
- **Create Rule Dialog** — Dialog for creating new rules with template support

### Changed

- **Activity History UX** — All long entries (>50 chars) are now expandable with a Lucide chevron icon on the right; text size bumped from 11px to 12px; label stays truncated when expanded with full text shown below; removed internal scrollbar so the panel grows naturally; date separator now shows for every session group (including the first) with date-only format (no time)
- **Create Issue Button Consolidation** — Removed duplicate "Create Issue" toolbar button; kept only the "+" button in the sidebar GitHub Issue section, which is now hidden when the repo has no remote configured
- **Unified MCP Prompt Injection** — Consolidated duplicated MCP tool description blocks into a single shared constant across all session types
- **Continuous Mode Prompts** — Updated prompts to use MCP `get_task` tool instead of file-based task injection, with explicit autonomous mode and `report_complete` instructions
- **Continuous Mode Dialog** — Updated description and strategy labels to clarify parallel vs sequential behavior
- **Sidebar Projects** — Added visual separators and color dots between sidebar projects, moved expand/collapse chevron to right side, dimmed empty state text, and persisted open/closed state across app restarts
- **GitHub Changes Tab** — Added collapsible Committed/Changes sections
- **Usage API Polling** — Reduced from 60s to 5min to avoid 429 rate limit errors
- **Skills & Rules Backend Overhaul** — Major refactor of skills commands with new plugin system support and expanded backend capabilities
- **Rules Tab Redesign** — Simplified and reorganized Rules tab UI with tree panel navigation and inline editor
- **Skills & Rules View** — Updated view layout with Plugins tab alongside Skills and Rules

### Fixed

- **Continuous Mode Stuck Bar** — Fixed continuous mode bar remaining visible after manually stopping a session by properly emitting cleanup events
- **User-Friendly Error Messages** — Improved error messages across the entire app with contextual hints and formatting
- **Redundant Agent Detection** — Fixed unnecessary agent detection when opening the Rules tab
- **Build Warnings** — Resolved Rust clippy warnings and frontend build warnings
- **Project Switch State Reset** — Reset stale task view and activeTaskId when switching projects to prevent "Task not found" errors
- **Kanban Task Ordering** — Fixed DFS tree ordering for in-column task nesting so children always appear directly after their actual parent
- **GitHub Issue Import DB Lock** — Released DB lock during GitHub issue import file I/O to prevent blocking other Tauri commands during batch imports
- **GitHub Sync Safety** — Disabled GitHub sync button when task has unsaved changes to prevent syncing stale content
- **TODOS.md Regeneration** — Always regenerate TODOS.md after GitHub issue import, even when all selected issues are skipped
- **Session Pane Bottom Gap** — Terminal area background now matches the xterm theme, eliminating the visible gap below the last terminal row
- **Obsolete Settings Menu Cleanup** — Removed unused `SettingsMenu.tsx` dropdown component; all settings are now accessed from the sidebar icon bar

## [0.8.0] - 2026-03-03

### Added

- **Skills & Rules Management** — Define, attach, and manage reusable skills and rules for AI agents per project
- **Continuous Mode** — Auto-launch a queue of ready tasks sequentially with independent or chained branching strategies
- **GitHub Integration** — Full GitHub view with commit graph visualization, issues import, PR creation, pull requests tab, issue-task sync, and changes tab
- **Diff Viewer & Review View** — Review agent changes with a built-in diff viewer and create PRs directly from the app
- **Command Palette** — Ctrl/Cmd+K quick-access command palette powered by cmdk
- **OS Notifications** — Native desktop notifications for MCP events (complete, error, waiting) with click-to-navigate
- **Task Log/History** — Track agent activity history per task
- **Worktree Auto-Cleanup Setting** — Configurable setting to automatically clean up git worktrees
- **Session Naming** — Custom names for terminal sessions
- **Task Dependency Graph** — Visual dependency badges and graph for task relationships
- **Task File Sync** — Markdown task files on disk with YAML frontmatter, watched and synced with the database

### Changed

- **Version Number Display** — App version shown in the UI

### Fixed

- **Session Stop Race Condition** — Fixed stop-and-remove race condition causing orphaned processes
- **PTY Exit Status Sync** — PTY process exit now correctly updates session status in the database
- **Task Description Bug** — Fixed task description not saving correctly
- **Terminal/Shell Stopped Issue** — Resolved terminals stopping unexpectedly
- **Process Closing Order** — Fixed process ending order to prevent hangs on session close
- **GitHub Auth Issues** — Resolved `gh` CLI authentication problems
- **macOS Terminal Path Issues** — Fixed PATH resolution on macOS terminals
- **macOS Build Issues** — Resolved OpenSSL and build configuration issues on macOS

### Security

- **Credential Storage** — Secure API key storage via the OS keyring (keyring crate)

### Performance

- **PTY Output Buffering** — Ring buffer (512KB/session) for efficient terminal content replay on view switch
- **Memo-Wrapped Components** — MCP-consuming components wrapped with React.memo for targeted re-renders

### Infrastructure

- **SQLite with WAL Mode** — Database with write-ahead logging for concurrent read performance
- **MCP Sidecar Binary** — Separate compiled binary acting as stdio-to-HTTP bridge for agent MCP communication
- **Backend File Logging** — Structured backend logging with UI-accessible log files
