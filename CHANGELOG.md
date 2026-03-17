# Changelog

All notable changes to Faber will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-03-xx - WIP

### Added

- **ACP (Agent Client Protocol) Support** — Full support for structured agent communication via ACP as an alternative to PTY-based sessions. Agents can now communicate through a typed JSON-RPC protocol with real-time streaming of messages, tool calls, thinking blocks, and plans. Includes a new `SessionTransport` layer (`pty` | `acp`) so every session type (task, research, continuous) can run in either mode
- **Project Chat** — New lightweight chat view (Chat tab in the top bar) for interactive conversations with ACP-capable agents. No task binding or worktree — just open a conversation about your project, discuss architecture, explore ideas, or ask questions. Features message attachments, slash commands, edit-and-resend, thinking/reasoning display, and inline tool call visualization
- **ACP Permission System** — Granular permission framework controlling what agents can do. Per-project rules with glob pattern matching for file paths and commands, three actions (auto-approve, ask, deny), trust mode overrides for continuous mode, permission request timeout, and a full audit log. In-session permission dialogs appear when agents request access, with an option to create permanent rules
- **ACP Permissions Settings Tab** — New settings tab for managing permission rules, viewing the audit log, and configuring trust mode policy and timeout
- **Floating Permission Banner** — Fixed banner appears when any session has pending permission requests, showing count and which sessions need approval with click-to-navigate
- **Agent Registry & Extensions Tab** — Auto-discovery and version tracking of ACP adapters from a public registry. The Extensions tab (renamed from Skills & Rules) shows adapter installation status, available updates, and install commands. Badge on the tab shows count of available updates
- **Chat UI Primitives** — Reusable AI chat element library (`ai-elements/`) with message bubbles, reasoning blocks, chain-of-thought visualization, code snippets, attachments, plans, shimmer loading, and toolbar components
- **Transport Selector** — Launch Task and Research dialogs now show a PTY/ACP transport toggle when the selected agent has an ACP adapter installed, defaulting to ACP when available
- **Permission Notifications** — OS notifications fire when agents request permissions (uses the "waiting" notification toggle), with click-to-navigate
- **Agent Install Hints** — Agent cards in settings now show CLI install commands and links for agents that aren't installed yet
- **Chat Close Confirmation** — Closing the chat session now shows a confirmation dialog to prevent accidental loss of conversation history
- **Task Detail GitHub Tab** — Restructured TaskDetailView with top-level tabs (Task Details, Agent Activity, GitHub). For tasks imported from GitHub issues, the new GitHub tab shows the live issue body, state badge, labels, metadata, full comment thread, and a comment composer — all without leaving the task view
- **GitHub Copilot CLI Agent** — Added Copilot CLI (`copilot`) as the 6th supported agent with Rust adapter, MCP config (`.copilot/mcp-config.json`), `AGENTS.md` instruction file mapping, frontend icons/colors, and documentation
- **Sidebar Branch Info** — Branch name and change count shown inline in each sidebar project entry (e.g. `● ProjectName · main 3∆`), with auto-refresh on project load, switch, and MCP events
- **GitHub Settings Tab** — Dedicated GitHub settings tab accessible from the Git view toolbar, with label mapping color swatches, all 6 status mappings, proper Select components, and one-click "Create default labels" setup
- **GitHub Sync Dialog** — Safe confirmation dialog for GitHub issue sync with granular field selection (title, body, status, labels), replacing the previous instant sync. Configurable default checkbox states in GitHub Settings
- **GitHub Auth Gate** — Shared `GitHubAuthGate` component replacing duplicated auth/remote checks in Issues and Pull Requests tabs
- **GitHub Issue Detail Panel** — Click any issue in the Issues tab to preview its full body, labels, assignees, and comment thread in a right-side detail panel (matching the Pull Requests detail pattern), with one-click import and "Open in GitHub" actions
- **Promote Session MCP Tool** — New `promote_session` MCP tool allowing agents to transition from research to implementation mode. After promotion, completing the session moves the task to in-review instead of being a no-op

### Changed

- **Continuous Mode ACP Support** — Continuous mode can now launch task sessions using ACP transport, with trust mode policies controlling permission behavior during auto-launched runs
- **Session Pane ACP Rendering** — Session panes detect ACP sessions and render the ChatPane instead of a terminal, with permission-request visual states (warning ring, pulsing header) alongside existing MCP waiting/error states
- **Extensions View** — Renamed "Skills & Rules" to "Extensions" with a new Agents tab alongside Skills and Rules for managing ACP adapters
- **Task Detail Actions** — Backlog/ready tasks now show "View Session" button when a session is already active, instead of always showing Start/Research actions
- **Consolidated Diff Views** — Extracted shared `DiffView` and `DiffToolbar` components from the duplicated ReviewView and ChangesTab implementations. Both views now use the same adaptive component with context-specific actions (worktree: push/merge/PR/delete; main repo: compact inline toolbar)
- **Smart Back Navigation** — Review view back button now returns to the previous view (Git, Sessions, etc.) instead of always going to Dashboard, via new `previousView` state tracking
- **GitHub Tab Badges** — Issues and Pull Requests tabs in the Git view now show a subtle GitHub icon to visually distinguish GitHub-dependent features from local-only git tabs
- **Settings Consolidation** — Merged Notifications into General settings with internal tabs (Appearance, Notifications, Updates, System), reducing sidebar settings icons from 5 to 4. Extracted GitHub sync settings from Projects tab into the new GitHub Settings tab
- **Git Data Refresh** — Renamed the git data "Sync" button to "Refresh" to avoid confusion with GitHub issue sync
- **Bundle Optimization** — Split vendor dependencies into cache-friendly manual chunks (xterm, diff, markdown, ui, react) and wrapped view switches in `startTransition` so React keeps the current view visible while lazy chunks load
- **Welcome Screen Agents** — Redesigned supported agents section from inline badges to a 3-per-row card grid showing agent icon, description, and live detection status (checkmark/empty circle). Removed manual path input

### Fixed

- **Skill Install Shell** — Fixed skill install shell closing immediately by spawning an interactive shell
- **GitHub Multi-Account Auth** — Fixed `gh auth status` parsing to handle per-account blocks for multi-source authentication
- **Research Session Completion** — Research sessions no longer incorrectly advance task status beyond "ready". Completing a research session on an already-ready or in-progress task is now a no-op instead of moving it to in-review
- **Chat Sessions Filtered from Grid** — Chat sessions are excluded from the Sessions grid view, appearing only in their dedicated Chat view

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
