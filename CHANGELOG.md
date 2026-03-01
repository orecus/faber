# Changelog

All notable changes to Faber will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-03-01

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
