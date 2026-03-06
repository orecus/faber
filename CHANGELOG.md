# Changelog

All notable changes to Faber will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] - 2026-03-xx

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
