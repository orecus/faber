<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Faber" width="100" />
</p>

<h1 align="center">Faber</h1>

<p align="center">
  <strong>The AI Architect for your codebase</strong>
</p>

<p align="center">
  <a href="https://github.com/orecus/faber/releases/latest"><img src="https://img.shields.io/github/v/release/orecus/faber?label=latest&color=blue" alt="Latest Release" /></a>
  <a href="https://github.com/orecus/faber/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/orecus/faber/ci.yml?branch=main&label=CI" alt="CI Status" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform" />
  <img src="https://img.shields.io/badge/Tauri%202-Rust%20%2B%20React-orange" alt="Built with Tauri 2" />
  <a href="https://github.com/orecus/faber/blob/main/LICENSE"><img src="https://img.shields.io/github/license/orecus/faber" alt="License" /></a>
</p>

<p align="center">
  A cross-platform desktop app for orchestrating AI coding agents.<br/>
  Wraps CLI-based agents with a task-driven workflow: Kanban board, git worktree isolation, multi-pane terminal sessions, GitHub integration, skills &amp; rules management, and continuous mode.
</p>

---

<!-- TODO: Replace with actual screenshot / GIF -->
<!-- <p align="center">
  <img src="docs/assets/demo.gif" alt="Faber Demo" width="800" />
</p> -->

## Features

- **Task-driven workflow** — Kanban board with task specs, priorities, labels, dependencies, and full lifecycle management (Backlog → Ready → In Progress → In Review → Done)
- **Multi-agent support** — Claude Code, Gemini CLI, OpenAI Codex CLI, OpenCode, and Cursor Agent — all auto-detected from your PATH
- **Git worktree isolation** — each task runs in its own worktree and branch, so multiple agents can work in parallel without conflicts
- **Multi-pane session grid** — run multiple agent sessions side-by-side with drag-and-drop layout and resizable panes
- **Four session modes** — Task (structured implementation), Research (explore & plan), Vibe (freeform coding), Shell (raw terminal)
- **Continuous mode** — auto-launch a queue of ready tasks with independent or chained branching strategies
- **Skills & rules** — install and manage agent skills and project rules to extend agent capabilities
- **GitHub integration** — issue import, PR creation, commit graph visualization, and label sync
- **Review workflow** — diff viewer with file list, change summary, and PR creation dialog
- **MCP server** — embedded Model Context Protocol server for real-time agent-to-app progress reporting
- **Command palette** — quick actions via <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd>
- **Theming** — Dark/Light × Glass/Flat (4 themes)
- **Auto-updates** — in-app update notifications with one-click install
- **OS notifications** — alerts on agent completion, errors, and waiting states (click to navigate)

## Views

| View | Description |
|------|-------------|
| **Dashboard** | Kanban board — manage tasks, filter by status/priority/label, launch agent sessions |
| **Sessions** | Multi-pane terminal grid — live agent output, drag-and-drop layout, session controls |
| **GitHub** | Commit graph, issue browser, PR management |
| **Skills** | Browse, install, and manage agent skills and project rules |
| **Task Detail** | Full task editor — markdown body, metadata, dependencies, linked PRs |
| **Review** | Diff viewer — file-level changes, create PRs directly from the app |
| **Help** | In-app documentation and guides |

## Prerequisites

### All Platforms

- [Rust](https://rustup.rs/) (stable, 1.77+)
- [Node.js](https://nodejs.org/) (v22+)
- [pnpm](https://pnpm.io/) (v9+)
- [Git](https://git-scm.com/)

### Linux — Debian/Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf
```

### Linux — Fedora/RHEL

```bash
sudo dnf install \
  gtk3-devel \
  webkit2gtk4.1-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  patchelf
```

### Linux — Arch Linux

```bash
sudo pacman -S \
  gtk3 \
  webkit2gtk-4.1 \
  libappindicator-gtk3 \
  librsvg \
  patchelf
```

### macOS

Xcode Command Line Tools (pre-installed on most systems):

```bash
xcode-select --install
```

If macOS states that the application is damaged and is refusing to start, you can try overriding the quarantine attribute:

```bash
xattr -d com.apple.quarantine /Applications/Faber.app
```

### Windows

- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10 1803+ and Windows 11)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload

## Getting Started

```bash
# Clone the repository
git clone https://github.com/orecus/faber.git
cd faber

# Install frontend dependencies
pnpm install

# Start the dev server (frontend + Tauri backend with hot-reload)
pnpm tauri dev
```

`pnpm tauri dev` automatically builds the MCP sidecar binary before starting (via `beforeDevCommand` in `tauri.conf.json`). If you need to rebuild the sidecar manually:

```bash
pnpm prepare-sidecar        # Build mcp sidecar to src-tauri/binaries/
```

## Build

```bash
# Build the full desktop app (produces platform-specific installers)
pnpm tauri build
```

The production build also prepares the sidecar automatically (release profile).

Build outputs:

| Platform | Formats | Path |
|----------|---------|------|
| Linux | `.deb`, `.rpm`, `.AppImage` | `src-tauri/target/release/bundle/` |
| macOS | `.dmg`, `.app` | `src-tauri/target/release/bundle/` |
| Windows (installer) | `.exe` (NSIS) | `src-tauri/target/release/bundle/nsis/` |
| Windows (portable) | `faber.exe` | `src-tauri/target/release/` |

### Frontend only

```bash
pnpm build       # Type-check + Vite build
pnpm dev         # Vite dev server with HMR (no Tauri backend)
pnpm preview     # Preview production build locally
```

### Rust backend only

```bash
cd src-tauri
cargo build      # Build
cargo test       # Run tests
cargo clippy     # Lint
```

## Supported Agents

Faber detects and wraps these CLI agents (must be installed separately):

| Agent | CLI Command | Default Model | MCP Config | Install |
|-------|------------|---------------|------------|---------|
| **Claude Code** | `claude` | `sonnet` | `.mcp.json` | `npm i -g @anthropic-ai/claude-code` |
| **Gemini CLI** | `gemini` | `gemini-2.5-pro` | `.gemini/settings.json` | `npm i -g @google/gemini-cli` |
| **OpenAI Codex CLI** | `codex` | `gpt-5.3-codex` | `.codex/mcp.json` | `npm i -g @openai/codex` |
| **OpenCode** | `opencode` | *(user-specified)* | `opencode.json` | `npm i -g opencode-ai` |
| **Cursor Agent** | `agent` / `cursor-agent` | `claude-4-opus` | `.cursor/mcp.json` | [cursor.com](https://cursor.com/) |

See [docs/supported_agents.md](docs/supported_agents.md) for detailed configuration and MCP integration info.

## Project Structure

```
faber/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── Shell/          # AppShell, ApplicationBar, Sidebar, WindowControls
│   │   ├── Dashboard/      # KanbanBoard, TaskCard, FilterBar, LaunchTaskDialog
│   │   ├── Sessions/       # SessionGrid, SessionPane, SessionsToolbar
│   │   ├── TaskDetail/     # TaskDetailView, CreateTaskDialog, MarkdownEditor
│   │   ├── Review/         # ReviewView, DiffViewer, CreatePRDialog
│   │   ├── GitHub/         # CommitGraph, IssuesTab, CommitDetailPanel
│   │   ├── SkillsRules/    # SkillsRulesView, SkillsTab, RulesTab
│   │   ├── Help/           # In-app documentation
│   │   ├── CommandPalette/ # Command palette (cmdk)
│   │   ├── Launchers/      # SessionLauncher, ContinuousModeDialog
│   │   ├── Settings/       # Settings modal tabs
│   │   ├── Update/         # UpdateNotification
│   │   └── ui/             # ShadCN + Orecus.io primitives
│   ├── store/              # Zustand stores (appStore, updateStore)
│   ├── contexts/           # ThemeContext
│   ├── hooks/              # Custom hooks (usePersistedState, useDashboardFilters)
│   ├── lib/                # Utilities (ptyBuffer, graphLayout, notifications, platform)
│   ├── utils/              # Helpers (color-utils, pickProjectFolder)
│   ├── styles/             # Tailwind CSS main stylesheet
│   └── types.ts            # TypeScript types (mirrors Rust models)
├── src-tauri/              # Rust backend
│   └── src/
│       ├── commands/       # Tauri IPC command handlers
│       ├── db/             # SQLite database (migrations, models, queries)
│       ├── agent/          # Agent adapters (Claude, Codex, Gemini, OpenCode, Cursor)
│       ├── mcp/            # MCP HTTP server + config writer
│       ├── bin/            # faber-mcp sidecar binary
│       ├── session.rs      # Session orchestration
│       ├── git.rs          # Git worktree management
│       ├── pty.rs          # PTY process manager
│       ├── tasks.rs        # Task file parser/watcher
│       ├── continuous.rs   # Continuous mode orchestrator
│       ├── github.rs       # GitHub CLI integration
│       ├── credentials.rs  # Secure credential storage (keyring)
│       └── font_detector.rs # Cross-platform font detection
├── docs/                   # Documentation
│   ├── supported_agents.md # Agent details and configuration
│   ├── continuous_mode.md  # Continuous mode guide
│   └── github_workflow.md  # GitHub integration guide
├── scripts/                # Build scripts (prepare-sidecar)
├── .agents/tasks/          # Task spec files (markdown + YAML frontmatter)
├── .github/workflows/      # CI/CD pipelines
└── REQUIREMENTS.md         # Full product specification
```

## Documentation

Detailed guides are available in the [`docs/`](docs/) folder.

## CI/CD

GitHub Actions workflows are in `.github/workflows/`:

- **`ci.yml`** — Runs on push to `main` and pull requests. Rust tests + clippy on all platforms, then builds and uploads artifacts.
- **`release.yml`** — Triggered on tag push (`v*`). Builds all platforms and creates a draft GitHub Release with installer artifacts. Can also be triggered manually via `workflow_dispatch`.

### Version numbers

The app version is defined in **three files** that must be kept in sync:

| File | Field | Example |
|------|-------|---------|
| `package.json` | `"version"` | `"0.6.0"` |
| `src-tauri/Cargo.toml` | `version` under `[package]` | `"0.6.0"` |
| `src-tauri/tauri.conf.json` | `"version"` | `"0.6.0"` |

All three must match. The Tauri build reads from `tauri.conf.json` for the app bundle, `Cargo.toml` for the Rust binary, and `package.json` for the frontend/npm context.

We follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **PATCH** (`0.5.0` → `0.5.1`) — Bug fixes, minor tweaks
- **MINOR** (`0.5.1` → `0.6.0`) — New features, backward-compatible changes
- **MAJOR** (`0.6.0` → `1.0.0`) — Breaking changes, major milestones

### Creating a release

1. **Update the version** in all three files:

   ```bash
   # Edit these files and set the new version:
   #   package.json            →  "version": "0.7.0"
   #   src-tauri/Cargo.toml    →  version = "0.7.0"
   #   src-tauri/tauri.conf.json → "version": "0.7.0"
   ```

2. **Commit the version bump:**

   ```bash
   git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
   git commit -m "chore: bump version to 0.7.0"
   ```

3. **Create and push a tag** (must start with `v`):

   ```bash
   git tag v0.7.0
   git push origin main --tags
   ```

4. **The release workflow runs automatically.** It builds for all platforms (Linux, macOS, Windows), signs the binaries, and creates a **draft** GitHub Release with these artifacts:

   | Platform | Artifacts |
   |----------|-----------|
   | Windows | NSIS installer (`.exe`), portable `faber.exe` |
   | macOS | Universal `.dmg` (ARM + Intel) |
   | Linux | `.deb`, `.rpm`, `.AppImage` |

5. **Publish the release** — Go to [GitHub Releases](../../releases), review the draft, edit the release notes if needed, and click **Publish**.

> **Note:** The release is created as a draft so you can review and edit the release notes before making it public. The auto-updater endpoint (`latest.json`) only picks up published (non-draft) releases.

### Manual release trigger

You can also trigger the release workflow manually from the GitHub Actions UI via `workflow_dispatch`, providing a tag name (e.g., `v0.7.0`). The tag must already exist.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | [Tauri 2](https://v2.tauri.app/) |
| Frontend | [React 19](https://react.dev/) + [TypeScript 5.7](https://www.typescriptlang.org/) |
| Bundler | [Vite 6](https://vite.dev/) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) + [ShadCN UI](https://ui.shadcn.com/) |
| State management | [Zustand 5](https://zustand.docs.pmnd.rs/) |
| Terminal emulator | [xterm.js 6](https://xtermjs.org/) |
| Backend | [Rust](https://www.rust-lang.org/) (2021 edition) |
| Database | SQLite (WAL mode) |
| MCP server | [Axum](https://github.com/tokio-rs/axum) |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes
4. Push to your fork and open a Pull Request

Please ensure `cargo clippy` and `pnpm build` pass before submitting.

## Thanks To

Thank you to the following projects for insperation, references and ideas.

- [maestro](https://github.com/its-maestro-baby/maestro) - For inspiration, references, and ideas.
- [svgl.app](https://svgl.app/) - For Logos
- [codexmonitor.app](https://www.codexmonitor.app/) - For inspiration and ideas.

And of course, Anthropic Claude Opus 4.6 for doing the majority of the work. :)

## License

See [LICENSE](LICENSE) for details.
