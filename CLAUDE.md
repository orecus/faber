# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Faber is a cross-platform desktop app (Tauri 2 + React + TypeScript + Rust) for orchestrating AI coding agents. It wraps CLI-based agents (Claude Code, Codex CLI, Gemini CLI, OpenCode, Cursor) with a task-driven workflow: Kanban board, git worktree isolation per task, PTY terminal sessions, multi-pane session grid, GitHub integration, and continuous mode for auto-launching task queues.

**ALWAYS** use the frontend skill when designing, developing or updating frontend component or pages.

## Commands

```bash
pnpm dev              # Start Vite dev server (frontend only, HMR)
pnpm tauri dev        # Start full app (Vite + Tauri/Rust backend with hot-reload)
pnpm build            # Build frontend (tsc + vite build)
pnpm tauri build      # Package full desktop app
pnpm prepare-sidecar  # Build the faber-mcp sidecar binary (debug)

# Rust-only (from src-tauri/)
cargo build           # Build Rust backend
cargo test            # Run Rust unit tests
cargo clippy          # Lint Rust code
```

No frontend test runner is configured yet. Rust tests are inline (`#[cfg(test)]` modules).

## Architecture

### Frontend (`src/`)
- **React 19 + TypeScript 5.7 + Vite 6 + Tailwind CSS 4**
- **State**: Zustand stores — primary `appStore.ts` (projects, tasks, sessions, grid layout, active view, background tasks, MCP status, sidebar, continuous mode, GitHub data) and `updateStore.ts` (app auto-updates). `ThemeContext` manages 4 themes (dark/light x glass/flat).
- **Views** (`ViewId`): `dashboard` (Kanban), `sessions` (multi-pane xterm.js), `task-detail`, `review` (diff + PR creation), `github` (commit graph + issues), `skills-rules` (skills & rules management), `help` (in-app docs)
- **Component tree**: `ThemeProvider -> StoreInitializer -> App -> AppShell` — AppShell is a 2-column CSS Grid (`sidebar | topbar` / `sidebar | content`) containing `{ApplicationBar, Sidebar, ViewRouter}`. Sessions view stays mounted (hidden via CSS); other views mount/unmount.
- **IPC**: `invoke("command_name", { args })` for calls, `listen("event-name")` for async events (PTY output, session status changes, MCP updates, continuous mode)
- **Persisted state hooks**: `usePersistedBoolean`/`usePersistedNumber`/`usePersistedString` sync with backend settings store. Cross-component sync via `CustomEvent("persisted-setting-change")`.

### Frontend Components (`src/components/`)
- `Shell/` — AppShell, ApplicationBar (top nav tabs: Tasks/Sessions/GitHub/Skills + window controls), Sidebar (project list, session list, settings), SidebarStatusPanel (MCP + git status), RightSidebar, RightSidebarResizeHandle, SidebarResizeHandle, UsagePanel, UsageProgressBar, ViewLayout (reusable layout wrapper with `.Toolbar`), WelcomeScreen, WindowControls, ContinuousModeBar
- `Dashboard/` — DashboardView, KanbanBoard, KanbanColumn, TaskCard, FilterBar, SummaryHeader, LaunchTaskDialog, ResearchTaskDialog, LiveStatusIndicator, PriorityBadge, DependencyBadge, DependencyGraph, EmptyState
- `Sessions/` — SessionsView, SessionGrid, SessionPane, SessionsToolbar, SessionDragOverlay (drag-and-drop via `@dnd-kit/core`), SessionsEmptyState, QuickActionBar
- `TaskDetail/` — TaskDetailView, CreateTaskDialog, TaskMarkdownEditor, TaskMarkdownPreview, TaskMetadataForm
- `Review/` — ReviewView, ReviewPanel, ReviewToolbar, FileList, CreatePRDialog, ConfirmDialog, useDiffData
- `GitHub/` — GitHubView, CommitGraph, GraphCanvas, CommitRow, CommitDetailPanel, BranchFilter, BranchSwitcher, ChangesTab, IssuesTab, PullRequestsTab, PullRequestDetailPanel, useGitHubData, useGitHubIssues, usePullRequests
- `Help/` — HelpView (in-app documentation)
- `Launchers/` — SessionLauncher, ContinuousModeDialog
- `Settings/` — GeneralTab, TerminalTab, NotificationsTab, AgentsTab, ProjectsTab, PromptsTab (modal dialogs from Sidebar)
- `CommandPalette/` — CommandPalette, commandRegistry, useCommands (powered by `cmdk`)
- `SkillsRules/` — SkillsRulesView, SkillsTab, InstalledSkillsList, RulesTab
- `Files/` — FileTree, FileTreeItem, fileIcons
- `Update/` — UpdateNotification
- `ui/` — ShadCN components; `ui/orecus.io/` — Orecus.io components (Card, etc.)

### Backend (`src-tauri/src/`)
- **Database** (`db/`): SQLite with WAL mode, migrations in `db/migrations.rs`. Tables: projects, tasks, sessions, settings, agent_configs. IDs: `<prefix>_<timestamp_hex>_<counter_hex>`.
- **Commands** (`commands/`): Tauri IPC commands returning `Result<T, AppError>`. Modules: `projects`, `tasks`, `sessions`, `settings`, `pty`, `git`, `mcp`, `agents`, `continuous`, `github`, `fonts`, `docs`, `updates`, `files`, `skills`, `usage`.
- **Session orchestration** (`session.rs`): Launches agents in PTY, composes system prompts for task/vibe/shell/research modes, manages worktree+branch creation, injects MCP config.
- **Git** (`git.rs`): Worktree create/list/delete, branch naming (`feat/{{task_id}}-{{task_slug}}`), diffs.
- **PTY** (`pty.rs`): Spawns pseudo-terminals via `portable-pty`, streams output in 4KB chunks via Tauri events, handles resize/write/kill.
- **Task files** (`tasks.rs`): Parses markdown with YAML frontmatter, watches for changes via `notify`, syncs with DB.
- **Agent adapters** (`agent/`): Detects installed CLI agents (claude, codex, gemini, opencode, cursor), maps to commands + default models.
- **MCP server** (`mcp/`): Embedded HTTP server (axum) on `127.0.0.1:<random_port>` for agent-to-app communication. See [MCP Server](#mcp-server) section.
- **Continuous Mode** (`continuous.rs`): Auto-launches a queue of ready tasks sequentially. Two branching strategies: `independent` (each task its own branch) and `chained` (each branches from the previous). Emits `continuous-mode-update` and `continuous-mode-finished` Tauri events.
- **GitHub** (`github.rs`): GitHub CLI (`gh`) integration — auth check, issue listing/import, PR management, label syncing.
- **Credentials** (`credentials.rs`): Keyring abstraction for secure API key storage via the `keyring` crate.
- **Font detection** (`font_detector.rs`): Cross-platform monospace/terminal/Nerd Font detection via `font-kit`.
- **Task logger** (`task_logger.rs`): Logs agent activity history to task files.
- **Task watcher** (`task_watcher.rs`): Watches task markdown files for external changes and syncs with DB.
- **MCP sidecar** (`bin/faber-mcp.rs`): Separate binary compiled as a Tauri sidecar. Acts as a stdio-to-HTTP bridge — agents launch it via their MCP config and it forwards JSON-RPC messages to the Faber HTTP server.

### Key Entry Points
- `src/store/appStore.ts` — Zustand store (central frontend state + actions + initialization)
- `src/store/updateStore.ts` — App update store
- `src-tauri/src/lib.rs` — Tauri app init & command registration
- `src-tauri/src/session.rs` — session orchestration
- `src-tauri/src/git.rs` — git utilities
- `src-tauri/src/mcp/server.rs` — MCP HTTP server + config writer
- `src-tauri/src/continuous.rs` — continuous mode orchestrator

### Key Utility Files
- `src/lib/ptyBuffer.ts` — Global ring buffer (512KB/session) for terminal content replay on view switch
- `src/lib/graphLayout.ts` — Multi-pass column assignment for git commit graph
- `src/lib/notifications.ts` — OS notification subsystem (MCP complete/error/waiting events)
- `src/lib/platform.ts` — Custom title bar drag region, platform detection
- `src/lib/agentIcons.tsx` — Agent name to icon mapping
- `src/lib/terminalTheme.ts` — xterm.js theme config
- `src/lib/taskGraphLayout.ts` — Layout engine for task dependency graph
- `src/lib/taskSort.ts` — Task sorting utilities
- `src/lib/agentDescriptions.ts` — Agent description text
- `src/lib/utils.ts` — General utility functions
- `src/utils/color-utils.ts` — Glass/solid style helpers (`glassStyles`)

## Type Definitions

Frontend types in `src/types.ts` mirror Rust models in `src-tauri/src/db/models.rs`. Keep them in sync when changing data models.

Key enums: `TaskStatus` (backlog|ready|in-progress|in-review|done|archived), `SessionMode` (task|vibe|shell|research), `SessionStatus` (starting|running|paused|stopped|finished|error), `Priority` (P0|P1|P2), `ViewId` (dashboard|sessions|task-detail|review|github|skills-rules|help).

## Conventions

### Styling — Tailwind CSS

**All new and updated components must use Tailwind CSS classes.** Do not use inline `style={{}}` for new code. Existing components with inline styles should be migrated to Tailwind when touched.

- **Tailwind v4** with ShadCN CSS variables, OKLch color space
- **ShadCN vars are the source of truth.** Use standard Tailwind utilities: `bg-background`, `bg-card`, `bg-popover`, `bg-accent`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-primary`, `text-destructive`, etc.
- **Custom semantic tokens:** `text-dim-foreground` (between foreground and muted), `text-success` / `bg-success`, `text-warning` / `bg-warning`
- **Glass/solid switching:** Use `useTheme()` → `isGlass` boolean. For panels: `<Card type={isGlass ? "normal" : "solid"}>` (Orecus.io Card). For shell containers (sidebar, status bar, tab bar): `glassStyles[isGlass ? "subtle" : "solid"]` from `color-utils.ts`
- **Panel borders:** Use `ring-1 ring-border/40` for subtle panel containers, `border-border` for structural dividers (border-b, border-l, etc.)
- **Inline style vars:** When CSS vars are needed in inline styles, use bare ShadCN names: `var(--primary)`, `var(--success)`, `var(--destructive)`, `var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, `var(--card)`, `var(--background)`, `var(--warning)`, `var(--dim-foreground)`
- Tailwind `animate-spin` for spinners; use `<Loader2>` from lucide-react
- Theme selectors: `[data-theme^="dark"]`, `[data-theme^="light"]`
- Main CSS file: `src/styles/main.css`
- ShadCN UI components in `src/components/ui/`, Orecus.io components in `src/components/ui/orecus.io/`

### Error handling (Rust)
Custom `AppError` enum with `From` conversions. All commands return `Result<T, AppError>`.

### State (Rust)
Mutex-wrapped state (`PtyState`, `DbState`) for thread safety. MCP state uses `Arc<TokioMutex<McpState>>`. Continuous mode uses `Arc<TokioMutex<ContinuousState>>`.

### TypeScript
Strict mode enabled (`noUnusedLocals`, `noUnusedParameters`). Functional components with hooks, `useCallback` for handlers.

## State Management — Zustand

Global state lives in the Zustand store (`src/store/appStore.ts`). A second store (`src/store/updateStore.ts`) manages app updates. Components subscribe to exactly the fields they need via selectors, preventing unnecessary re-renders.

### Reading state

```tsx
import { useAppStore } from "../../store/appStore";

// Subscribe to specific fields (component re-renders only when these change)
const tasks = useAppStore((s) => s.tasks);
const setActiveView = useAppStore((s) => s.setActiveView);
```

### Actions

Call named action methods directly — no `dispatch`:

```tsx
const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

addBackgroundTask("Saving task");
try {
  await invoke("some_command", { ... });
} finally {
  removeBackgroundTask("Saving task");
}
```

### Key patterns

- **Selectors**: Always use `useAppStore((s) => s.fieldName)` — never subscribe to the whole store.
- **MCP data**: `TaskCard` and `SessionPane` read their own MCP data via `useAppStore(s => s.mcpStatus[sessionId])` and are wrapped with `React.memo`. This ensures MCP updates (1-2s/agent) only re-render the affected card/pane.
- **Initialization**: `StoreInitializer` in `main.tsx` calls `useAppStore.getState().initialize()` once on mount. This sets up Tauri event listeners (PTY, MCP, continuous mode, task updates), loads projects/agents/shells, initializes notifications, and watches `activeProjectId` changes via `subscribeWithSelector`.
- **Sidebar persistence**: `setSidebarWidth` fire-and-forget `invoke("set_setting", ...)` with 300ms debounce.
- **Per-project caching**: `projectSessions`, `projectWorktrees`, `projectGitData`, `projectAttention` — keyed by project ID for multi-project support.
- **No immer**: State mutations use simple spreads/filters. No deep nesting.

### Background Task Tracking

The store maintains a `backgroundTasks: string[]` array. A `FloatingStatusToast` in AppShell displays the most recent task with a spinner.

Currently tracked operations: agent detection, shell detection, project loading, project info fetching, session listing, task syncing, worktree creation + session launch.

The `SidebarStatusPanel` (bottom of Sidebar) shows MCP server status and git branch info.

## MCP Server

An embedded HTTP server (axum) provides MCP (Model Context Protocol) tools that AI agents can call to report progress back to the IDE.

### Architecture
- Single server started at app launch, listening on `127.0.0.1:<random_port>`
- Session routing via URL path: `POST /session/{session_id}/mcp`
- **Sidecar binary** (`faber-mcp`): Compiled as a Tauri sidecar, acts as a stdio-to-HTTP bridge. Agent MCP configs point to this binary, which forwards JSON-RPC messages to the HTTP server. This avoids agents needing direct HTTP access.
- Agent config (`.mcp.json`, `.gemini/settings.json`, `.codex/mcp.json`) auto-injected into the working directory before PTY spawn, pointing to the sidecar
- Session ID pre-generated before DB insert so the MCP URL can be written to config

### MCP Tools
Agents can call: `report_status`, `report_progress`, `report_files_changed`, `report_error`, `report_complete`, `report_waiting`, `get_task`, `update_task`, `update_task_plan`, `create_task`, `list_tasks`. Each tool updates in-memory `McpSessionData` and emits a Tauri event (`mcp-status-update`, `mcp-progress-update`, `mcp-files-changed`, `mcp-error`, `mcp-complete`, `mcp-waiting`).

### Frontend Integration
- The Zustand store `initialize()` method listens for MCP events and stores per-session state in `mcpStatus: Record<string, McpSessionState>`
- `SessionPane` and `TaskCard` read their own MCP data via store selectors (wrapped with `React.memo`)
- `SidebarStatusPanel` shows MCP server port + connected count via `get_mcp_info` IPC command
- OS notifications fire on MCP complete, error, and waiting events (click-to-navigate)

### Key Files
- `src-tauri/src/mcp/protocol.rs` — JSON-RPC 2.0 + MCP types
- `src-tauri/src/mcp/tools.rs` — Tool definitions with JSON Schema
- `src-tauri/src/mcp/server.rs` — Axum server, handlers, config writer
- `src-tauri/src/bin/faber-mcp.rs` — Sidecar binary (stdio-to-HTTP bridge)
- `src-tauri/src/commands/mcp.rs` — `get_mcp_info` IPC command

<!-- Faber:MCP -->
## Faber Integration

You have MCP tools provided by the Faber IDE for reporting your progress. You MUST use them throughout your workflow:

- `report_status(status, message, activity?)` — Call when you start working (status: "working"). Optional activity: "researching", "exploring", "planning", "coding", "testing", "debugging", "reviewing".
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


Always call `report_status` first, then `report_progress` as you work, and `report_complete` when done.
<!-- /Faber:MCP -->
