# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Faber is a cross-platform desktop app (Tauri 2 + React + TypeScript + Rust) for orchestrating AI coding agents. It wraps CLI-based agents (Claude Code, Codex CLI, Copilot CLI, Cursor Agent, Gemini CLI, OpenCode) with a task-driven workflow: Kanban board, git worktree isolation per task, PTY terminal sessions, multi-pane session grid, GitHub integration, and continuous mode for auto-launching task queues.

**ALWAYS** use the frontend skill when designing, developing or updating frontend components or pages.

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
- **State**: Zustand stores — primary `appStore.ts` and `updateStore.ts`. `ThemeContext` manages 4 themes (dark/light x glass/flat).
- **Views** (`ViewId`): `dashboard`, `sessions`, `task-detail`, `review`, `github`, `skills-rules`, `help`
- **Component tree**: `ThemeProvider -> StoreInitializer -> App -> AppShell` — AppShell is a 2-column CSS Grid. Sessions view stays mounted (hidden via CSS); other views mount/unmount.
- **IPC**: `invoke("command_name", { args })` for calls, `listen("event-name")` for async events (PTY output, session status, MCP updates, continuous mode)

### Backend (`src-tauri/src/`)
- **Database** (`db/`): SQLite with WAL mode, migrations in `db/migrations.rs`. IDs: `<prefix>_<timestamp_hex>_<counter_hex>`.
- **Commands** (`commands/`): Tauri IPC commands returning `Result<T, AppError>`.
- **Session orchestration** (`session.rs`): Launches agents in PTY, composes system prompts, manages worktree+branch creation, injects MCP config.
- **Git** (`git.rs`): Worktree create/list/delete, branch naming, diffs.
- **PTY** (`pty.rs`): Spawns pseudo-terminals via `portable-pty`, streams output via Tauri events.
- **Agent adapters** (`agent/`): Detects installed CLI agents, maps to commands + default models.
- **MCP server** (`mcp/`): Embedded HTTP server (axum) on `127.0.0.1:<random_port>`. Sidecar binary (`bin/faber-mcp.rs`) acts as stdio-to-HTTP bridge for agent MCP configs.
- **Continuous Mode** (`continuous.rs`): Auto-launches a queue of ready tasks. Two branching strategies: `independent` and `chained`.
- **Project config** (`project_config.rs`): File-based project settings via `.agents/faber.json`. See [Settings Architecture](#settings-architecture).
- **Config watcher** (`config_watcher.rs`): Watches `.agents/faber.json` for external edits, re-syncs DB.

### Key Entry Points
- `src/store/appStore.ts` — Zustand store (central frontend state + actions + initialization)
- `src-tauri/src/lib.rs` — Tauri app init & command registration
- `src-tauri/src/session.rs` — Session orchestration
- `src-tauri/src/mcp/server.rs` — MCP HTTP server + config writer

## Type Definitions

Frontend types in `src/types.ts` mirror Rust models in `src-tauri/src/db/models.rs`. Keep them in sync when changing data models.

Key enums: `TaskStatus` (backlog|ready|in-progress|in-review|done|archived), `SessionMode` (task|vibe|shell|research), `SessionStatus` (starting|running|paused|stopped|finished|error), `Priority` (P0|P1|P2), `ViewId` (dashboard|sessions|task-detail|review|github|skills-rules|help).

## Settings Architecture

Faber uses a **two-level settings system**: global (app-wide) and project-scoped (per-project).

### Global settings
- Stored in SQLite `settings` table with `scope = "global"`, `scope_id = NULL`
- Examples: theme, notification preferences, terminal font
- Frontend reads/writes via `usePersistedBoolean`/`usePersistedString`/`usePersistedNumber` hooks, which call `get_setting`/`set_setting` IPC commands
- Cross-component sync via `CustomEvent("persisted-setting-change")`

### Project settings
- **Source of truth**: `.agents/faber.json` in the project root
- DB `settings` table (scope = "project") acts as a **fast-read cache**, kept in sync
- Config struct: `ProjectConfig` in `project_config.rs` — covers default agent/model, branch naming, GitHub sync, ACP permissions, and more
- All fields use `#[serde(default)]` so missing keys use defaults without failing
- Unknown keys are preserved via an `extra: serde_json::Map` catch-all field (forward compatibility)

### Resolution cascade
Project scope is checked first, then global fallback — see `db::settings::get_resolved()`.

### Write path
UI updates flow: load current `ProjectConfig` from disk → update field → atomic write to `faber.json` (write to `.tmp`, rename) → sync to DB cache.

### File watcher
`config_watcher.rs` watches `.agents/faber.json` for external changes (manual edits, git checkout). Debounces 500ms, ignores the app's own writes (2-second window). On change: reloads config, syncs to DB, emits `project-config-changed` Tauri event. Frontend reloads project info and dispatches `persisted-setting-change` for hooks to re-read.

### Project open lifecycle
On `open_project`: if `.agents/faber.json` exists, load and sync to DB. If missing, build from current DB values and write the file (migration path). Then start config watcher.

### Key files
- `src-tauri/src/project_config.rs` — `ProjectConfig` struct, load/save/sync helpers
- `src-tauri/src/config_watcher.rs` — File watcher registry with debounce
- `src-tauri/src/db/settings.rs` — DB read/write/resolve helpers
- `src-tauri/src/commands/github.rs` — `get_project_setting`/`set_project_setting` IPC commands

## Logging

The backend uses `tracing` + `tracing-subscriber` + `tracing-appender` for structured logging with daily file rotation.

### Setup
Configured in `src-tauri/src/logging.rs`. Initialized early in `lib.rs` before any tracing calls. Two output layers:
- **Stderr** — compact format with ANSI colors (for development)
- **File** — full timestamps, no colors, written to `{app_data_dir}/logs/faber.YYYY-MM-DD.log`

Log files rotate daily, keeping the **7 most recent** files. Override log levels at runtime via the `RUST_LOG` environment variable.

### Default levels
- `info` for app code (`faber_lib`)
- `warn` for noisy external crates (`hyper`, `tower`, `axum`, `tungstenite`)

### Guidelines
When adding or modifying Rust code, include useful log statements:
- **`info!`** for significant operations: session launches, project opens, migrations, agent detection
- **`warn!`** for recoverable issues: missing sidecar, fallback paths, failed cleanup
- **`error!`** for failures that need attention: DB errors, PTY spawn failures, ACP init failures
- **`debug!`** for internal state changes: watcher events, config syncs, detailed flow

Use structured fields for context:
```rust
info!(session_id = %id, agent = %agent_name, "Session launched");
warn!(%e, project_id, "Config sync to DB failed");
error!(session_id = %id, error = %e, "PTY spawn failed");
```

### Key files
- `src-tauri/src/logging.rs` — Logging initialization and configuration
- Log directory accessible via `get_log_directory` / `open_log_directory` IPC commands

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

### State management (Frontend)
- **Selectors**: Always use `useAppStore((s) => s.fieldName)` — never subscribe to the whole store.
- **MCP data**: `TaskCard` and `SessionPane` read their own MCP data via selectors and are wrapped with `React.memo` so MCP updates only re-render the affected card/pane.
- **Initialization**: `StoreInitializer` in `main.tsx` calls `initialize()` once — sets up Tauri event listeners, loads projects/agents/shells, watches `activeProjectId` changes.
- **Per-project caching**: `projectSessions`, `projectWorktrees`, `projectGitData`, `projectAttention` — keyed by project ID.
- **No immer**: State mutations use simple spreads/filters.

### TypeScript
Strict mode enabled (`noUnusedLocals`, `noUnusedParameters`). Functional components with hooks, `useCallback` for handlers.

<!-- Faber:MCP -->
## Faber Integration

You have MCP tools provided by the Faber IDE for reporting your progress. You MUST use them throughout your workflow:

- `report_status(status, message, activity?)` — Call when you start working (status: "working"). Optional activity: "researching", "exploring", "planning", "coding", "testing", "debugging", "reviewing".
- `report_progress(current_step, total_steps, description)` — Call before each step
- `report_files_changed(files)` — Call after modifying files
- `report_error(error, details?)` — Call if you encounter an error or blocker
- `report_waiting(question)` — Call if you need user input
- `report_complete(summary)` — Call ONLY when the task is fully complete. In continuous mode, this advances to the next task. Do NOT call prematurely
- `get_task(task_id?)` — Fetch task metadata and body. Omit task_id to get current session's task.
- `update_task(task_id?, status?, priority?, title?, labels?, depends_on?, github_issue?, github_pr?)` — Update task metadata (status, priority, labels, etc.). Omit task_id to use current session's task.
- `update_task_plan(plan, task_id?)` — Update the implementation plan in the task file.
- `create_task(title, body?, priority?, labels?, depends_on?)` — Create a new task in the current project (always created as backlog).
- `list_tasks(status?, label?)` — List all tasks in the current project with optional filters. Returns compact metadata (no body).

Always call `report_status` first, then `report_progress` as you work, and `report_complete` when done.
<!-- /Faber:MCP -->
