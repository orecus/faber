---
title: Getting Started
description: Overview of Faber and how to use it
icon: book-open
order: 0
---

# Getting Started with Faber

Faber is a desktop application for orchestrating AI coding agents. It provides a unified interface to manage tasks, run agent sessions, review changes, and integrate with GitHub — all from one place.

## Core Concepts

### Projects

A **project** is a local Git repository you've added to Faber. Each project has its own tasks, sessions, worktrees, and settings. Switch between projects using the sidebar on the left.

To add a project, click the **+** button in the sidebar's project list and select a folder. You can also drag-and-drop a folder onto the app window.

### Tasks

Tasks live on the **Dashboard** (the Kanban board). Each task has a status that moves through the board columns:

| Status | Meaning |
|---|---|
| **Backlog** | Not yet planned |
| **Ready** | Ready to work on |
| **In Progress** | An agent session is actively working on it |
| **In Review** | Work is done, awaiting review |
| **Done** | Completed |

Tasks are stored as Markdown files with YAML frontmatter in your project's `.agents/tasks/` directory, so they travel with your repo.

You can set a **priority** (P0 / P1 / P2) and add **dependencies** between tasks using the `depends_on` field. Dependencies are visible directly on task cards — a link icon shows the count, and clicking it reveals a popover listing all linked tasks with their statuses. Blocked tasks (with unmet dependencies) are dimmed and show a lock icon.

### Sessions

A **session** is an AI agent (or plain terminal) running in a PTY. There are four ways to start one:

- **Launch a task** — Click the play button on a task card in the Dashboard. Faber creates an isolated git worktree and branch, injects the task context into the agent's system prompt, and connects MCP progress reporting. The task moves to "In Progress".
- **Research a task** — Click the lightbulb icon on a "Backlog" task card. This launches a lightweight agent session to analyze and plan the task without changing its status or creating a worktree. The agent reads the task file and collaborates with you to explore the problem space before committing to implementation. When the research completes, a prompt appears offering to continue directly to implementation — launching a full task session with worktree isolation while the research findings are preserved in the task file.
- **New Agent** — Click "New Agent" in the Sessions toolbar. This starts a free-form agent session with no specific task — good for exploration, prototyping, or asking questions. You can optionally create a worktree for it.
- **Terminal** — Click "Terminal" in the Sessions toolbar. This opens a plain shell with no agent, useful for running commands manually.

Sessions appear in the **Sessions** view as a multi-pane grid. You can resize panes, maximize individual sessions, and drag-and-drop to rearrange them.

### Worktrees

When you launch a task session, Faber automatically creates a **git worktree** — an isolated copy of your repo on its own branch. This means multiple agents can work on different tasks simultaneously without conflicts. The branch naming pattern is configurable per project (default: `feat/{{task_id}}-{{task_slug}}`).

### MCP Integration

Faber runs a local MCP (Model Context Protocol) server that agents use to report their progress. This powers the live status indicators on task cards and session panes — you can see what step an agent is on, what files it changed, and whether it needs input.

## Views

Navigate between views using the top bar tabs or the command palette.

### Dashboard (Tasks)

The Dashboard has two display modes, toggled from the **Board | Tree** switch in the toolbar:

#### Board View (Kanban)

The default Kanban board for managing tasks. From here you can:

- Create, edit, and delete tasks
- Drag tasks between columns to change status
- Launch agent sessions on tasks using the play button (visible on hover)
- Research backlog tasks using the lightbulb button (analyzes the task without changing status)
- Filter tasks by priority, label, or agent
- See live MCP status on in-progress task cards (only active sessions show the status footer)

Task cards adapt to their column:

| Column | Card Style |
|---|---|
| **Backlog** | Tree-node style with indentation for dependency chains |
| **Ready** | Default cards |
| **In Progress** | Detailed cards with progress bar and live MCP status footer |
| **In Review** | Default cards with "View session" button |
| **Done** | Compact single-line cards to save space |

Tasks within each column are **topologically sorted** — blockers appear above the tasks that depend on them.

#### Tree View

A collapsible outline showing the parent/child dependency hierarchy. Root tasks (no dependencies) appear at the top level, and tasks that depend on them are nested underneath with tree guide lines.

Each row shows the task's priority, status, title, agent, and live MCP status. You can expand/collapse subtrees, and use the **Expand All / Collapse All** controls. Action buttons (Play, Research, View) appear on hover, just like in the Board view.

The Tree view is especially useful when you have many tasks with dependency relationships and want to see the full hierarchy at a glance.

### Sessions

A multi-pane terminal grid showing all active agent sessions. Features:

- Resize the grid layout (1×1, 2×1, 2×2, 3×2, etc.)
- Maximize a single pane to full size
- Drag-and-drop panes to reorder
- Each pane shows the agent name and MCP status overlay
- **Quick Action Bar** — hover over an active agent session to reveal floating action buttons (Commit, Fix Errors, Summarize, etc.) that send one-click prompts to the agent. Configure actions in Settings > Prompts.
- Terminal output is buffered so you can switch views and come back without losing output

### GitHub

GitHub integration view with two tabs:

- **Commits** — A visual commit graph for your current branch with commit details
- **Issues** — Browse and import GitHub issues as Faber tasks

Requires the [GitHub CLI](https://cli.github.com/) (`gh`) to be installed and authenticated.

### Review

Diff viewer for reviewing changes made by agents. Shows file-by-file diffs and lets you create pull requests directly from Faber.

### Help

The documentation viewer you're reading right now.

## Command Palette

Press **Ctrl+K** (or **Cmd+K** on macOS) to open the command palette. It provides quick access to everything in the app:

### Navigation

- **Go to Dashboard** — Switch to the Kanban board
- **Go to Sessions** — Switch to the session grid
- **Go to GitHub** — Switch to the GitHub view
- **Go to Review** — Switch to the review/diff view

### Projects

All your projects are listed. Select one to switch to it.

### Tasks

All non-archived tasks in the current project are listed. Select one to open its detail view.

### Sessions

All active sessions are listed. Select one to focus its pane in the session grid.

### Actions

- **New Vibe Session** — Start a free-form agent session
- **Create New Task** — Open the new task dialog
- **Open Terminal** — Launch a plain shell session

The palette shows your **recent commands** when the search field is empty. Use the arrow keys to navigate and Enter to select.

## Settings

Open settings from the gear icon in the sidebar. Settings are organized into tabs:

### General

- **Color Mode** — Switch between Dark and Light themes
- **Glass Effect** — Toggle the translucent glass UI style (not available on macOS)
- **Show Project Icons** — Show or hide project icons in the sidebar
- **Updates** — Check for app updates, enable auto-checking, and set the check frequency (hourly to daily). An advanced option lets you point to a custom update endpoint.

### Terminal

- **Default Shell** — Choose which shell to use for sessions (system default or a specific installed shell)
- **Font Family** — Pick a terminal font from embedded fonts (JetBrains Mono), installed Nerd Fonts, or system fonts
- **Font Size** — Adjust terminal text size (8–32px)
- **Zoom Level** — Scale the terminal view (50%–200%)
- **Line Height** — Adjust line spacing (1.0–2.0)
- **Reset to Defaults** — Restore all terminal settings to their defaults

### Notifications

- **Enable Notifications** — Master toggle for all OS notifications
- **Session Complete** — Notify when an agent finishes its work
- **Session Error** — Notify when an agent encounters an error
- **Input Needed** — Notify when an agent is waiting for your input

Clicking a notification takes you directly to the relevant session.

### Agents

- **Default Agent** — Choose which AI agent to use by default (Claude Code, Codex CLI, Gemini CLI, OpenCode, or Cursor)
- **Per-agent settings** (for installed agents):
  - **Skip Permissions** — Run the agent in fully autonomous mode (agent-specific flag)
  - **Custom Flags** — Add extra CLI flags to the agent command
  - **Command Preview** — See the exact command that will be executed

### Prompts

Manage prompt templates and quick actions:

- **Session Prompts** — Default prompts used when launching task, research, continuous, and task-continue sessions. Each template supports `{{variable}}` interpolation (e.g., `{{task_id}}`, `{{worktree_hint}}`). Session prompts are protected (cannot be deleted) but fully customizable.
- **Quick Actions** — Action buttons that appear on active session panes when you hover over them. Click a quick action to send the prompt directly to the agent. Built-in actions include "Commit", "Fix Errors", and "Summarize". You can add, edit, and delete custom actions with configurable labels, icons, and prompts.
- **Reset to Defaults** — Restore all templates and actions to their built-in defaults.

### Projects

Per-project configuration:

- **Project Icon** — Set an SVG icon for the project
- **Tab Color** — Choose a color for the project's sidebar tab
- **Default Agent / Model** — Override the global default for this project
- **Branch Naming Pattern** — Customize the worktree branch format using `{{task_id}}` and `{{task_slug}}` variables
- **Instruction File** — Point to a custom instruction file (relative to project root) for agent system prompts
- **GitHub Sync** — Configure automatic syncing between task statuses and GitHub issues/PRs (see the [GitHub Workflow](github_workflow) guide for details)
- **Delete Project** — Remove the project from Faber (does not delete files on disk)
