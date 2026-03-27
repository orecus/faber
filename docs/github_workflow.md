---
title: GitHub Workflow
description: How task-worktree-GitHub syncing works
icon: git-pull-request
order: 2
---

# GitHub Workflow — Task, Worktree & Issue Sync

Faber connects your local task workflow to GitHub issues and pull requests. This document explains how syncing works and what each setting controls.

---

## Overview

The workflow follows a natural progression:

```
GitHub Issue  -->  Import as Task  -->  Worktree + Branch  -->  PR  -->  Merge  -->  Task Done
```

By default, syncing is **one-way**: you import GitHub issues as tasks and work on them locally. When you enable **GitHub Sync**, changes flow back — status updates close/reopen issues, PRs reference the originating issue, and merged PRs automatically mark tasks as done.

### The Git View

The **Git** view is organized into four tabs:

| Tab | What it shows |
|---|---|
| **Changes** | Uncommitted and staged file diffs in the project (default tab) |
| **Commits** | Visual commit graph with branch/merge lines and commit details |
| **Issues** | GitHub issues — browse and import as local tasks |
| **Pull Requests** | GitHub PRs — browse, review, merge, and close |

A shared toolbar at the top provides **Pull**, **Push**, and **Sync** buttons that apply regardless of which tab is active.

---

## Importing GitHub Issues

From the **Issues** tab in the Git view, you can browse open issues and import them as local tasks. Each imported task stores a reference to the original issue (e.g. `owner/repo#42`) in its `github_issue` field.

Importing is always available and does not require any sync settings to be enabled. Re-importing the same issue is a no-op — duplicates are detected automatically.

### Dependency Detection

When importing issues, Faber scans each issue's body for dependency references. The following patterns are recognized (case-insensitive):

- `depends on #42`
- `blocked by #15`
- `requires #7`
- `after #3`

Cross-repository references are also supported: `depends on other/repo#99`.

If the referenced issue has already been imported (or is being imported in the same batch), Faber resolves the reference to a local task ID and populates the task's `depends_on` field automatically. Unresolved references (issues not imported) are silently skipped.

These dependency relationships are used by **Continuous Mode** to suggest a branching strategy and automatically sort the task queue. See the [Continuous Mode](/help/continuous_mode) documentation for details.

---

## Git Operations

The shared toolbar at the top of the Git view provides direct access to common git operations without leaving the IDE.

### Pull & Push

- **Pull** — Fetches from origin and fast-forwards the current branch. If the working tree has uncommitted changes or the branch has diverged (cannot fast-forward), Pull will show an error. Commit or stash your changes first.
- **Push** — Pushes the current branch to origin. Uses `gh auth git-credential` for authentication, so you only need `gh auth login` once.

Both buttons show ahead/behind badges when your local branch differs from the remote. These counts are refreshed automatically when you open the Git view and after each operation.

---

## Changes Tab

The **Changes** tab is the default tab when you open the Git view. It shows all uncommitted and staged file changes in the current project directory — similar to a built-in `git status` + `git diff` viewer.

### File List

The left panel lists changed files, grouped into:

- **Staged files** — files added to the index (`git add`)
- **Changed files** — unstaged modifications, new files, and deletions

Click any file to view its diff in the right panel. Use the **stage/unstage toggle** on each file to move it between staged and changed.

### Diff Viewer

The right panel shows the diff for the selected file. Toggle between two display modes using the toolbar button:

- **Split** (side-by-side) — old and new versions shown in parallel columns
- **Unified** (line-by-line) — interleaved additions and deletions in a single column

### Toolbar

- **File count** — shows the total number of changed files
- **Split / Unified** — toggles the diff display mode
- **Refresh** — re-reads the working directory for changes

---

## Commits Tab

### Branch Switching

Click the **branch badge** (with the chevron indicator) in the Commits tab toolbar to open the branch switcher. It shows:

- **Local branches** — branches that exist on your machine
- **Remote branches** — branches on origin that don't have a local counterpart yet

Selecting a remote branch automatically creates a local tracking branch. The switcher includes a search field to filter branches by name.

Branch switching is blocked if your working tree has uncommitted changes — commit or stash first.

### Commit Graph

The Commits tab shows a visual commit graph with branch/merge lines. You can toggle between showing all branches or only the current branch using the toggle buttons in the toolbar.

Click any commit to open the detail panel showing the full commit message, author info, parent hashes, and changed files.

---

## Issues Tab

The **Issues** tab lets you browse open GitHub issues and import them as local tasks. See [Importing GitHub Issues](#importing-github-issues) below for details on how importing works, including automatic dependency detection.

---

## Pull Requests Tab

The **Pull Requests** tab provides a full PR browser so you can review, merge, and close pull requests without leaving Faber.

### State Filter

A toggle bar at the top lets you filter PRs by state:

- **Open** — currently open PRs (default)
- **Closed** — closed and merged PRs
- **All** — every PR regardless of state

The PR count updates to reflect the active filter.

### PR List

Each row in the list shows:

| Column | Description |
|---|---|
| **State icon** | Green (open), purple (merged), or red (closed) |
| **Number** | PR number (e.g. `#42`) |
| **Title** | PR title, truncated if long |
| **Draft badge** | Shown if the PR is a draft |
| **Labels** | Colored label pills matching the repository's label colors |
| **Branch pill** | Source and target branch (e.g. `feat/login → main`) |
| **Review status** | Approved, changes requested, or review required |
| **Diff stats** | Lines added / removed (`+120 -45`) |
| **Author** | GitHub username |
| **Updated** | Relative timestamp (e.g. `2h ago`) |

### Detail Panel

Click any PR to open the detail panel on the right. From here you can:

- Read the full PR description
- See review status, check status, and merge requirements
- **Merge** the PR — choose a merge method (merge commit, squash, or rebase)
- **Close** the PR without merging
- **Open on GitHub** — jump to the PR in your browser

### Authentication

The Pull Requests tab requires `gh` CLI to be installed and authenticated. If authentication is missing or token scopes are insufficient, a warning is shown with instructions to fix it.

---

## The Worktree Workflow

When you start a session on a task, Faber can create an isolated git worktree with a dedicated branch. The branch name follows your project's naming pattern (default: `feat/{task_id}-{task_slug}`).

This gives each task its own working directory, so agents can make changes without interfering with your main branch or other tasks.

### From task to PR

1. **Start a session** on a task — a worktree and branch are created
2. The agent works in the worktree, making commits
3. Open the **Review** view to inspect changes
4. Click **Create PR** — the branch is pushed and a pull request is opened
5. If the task has a linked GitHub issue, the PR body is pre-populated with `Closes #42`
6. The PR URL is saved on the task for merge tracking

---

## GitHub Sync Settings

All sync behavior is controlled per-project in **Settings > Project > GitHub Sync** (the Project tab in the Settings view).

The master toggle defaults to **OFF**. Nothing is written to GitHub until you explicitly enable it.

### Master Toggle

| Setting | Default | What it does |
|---|---|---|
| **Enable GitHub Sync** | OFF | Gates all sync behavior. When off, Faber never writes to GitHub. |

When the master toggle is on, the following individual settings become available:

### Issue Lifecycle

| Setting | Default | What it does |
|---|---|---|
| **Auto-close issues** | ON | When a task moves to **Done** (and has no linked PR), the GitHub issue is closed with a comment. If the task *does* have a linked PR, closing is skipped — GitHub handles it via the `Closes #N` reference when the PR merges. |
| **Auto-reopen issues** | ON | When a task moves *back* from Done/Archived to an active status, the GitHub issue is reopened. |

### Pull Requests

| Setting | Default | What it does |
|---|---|---|
| **Add "Closes #N" to PR body** | ON | When creating a PR for a task with a linked GitHub issue, the PR description is pre-populated with `Closes #42`. You can always edit or remove this before submitting. |
| **Auto-detect merged PRs** | ON | When you click **Refresh** in the Review view, Faber checks whether the task's linked PR has been merged. If it has, the task is automatically moved to Done. |

### Label Sync

| Setting | Default | What it does |
|---|---|---|
| **Sync status labels** | OFF | When a task changes status, the corresponding label is added to the GitHub issue and the previous status label is removed. Requires a label mapping (see below). |

#### Configuring Label Mapping

When label sync is enabled, click **Fetch Labels** to load your repository's labels. Then assign a label to each task status:

| Task Status | Example Label |
|---|---|
| backlog | `status:backlog` |
| ready | `status:ready` |
| in-progress | `status:wip` |
| in-review | `status:review` |
| done | `status:done` |

Leave a status set to "None" to skip label changes for that transition. Labels that don't exist on the repository will cause a logged (but non-fatal) error.

---

## How Syncing Behaves in Practice

### Scenario 1: Basic workflow (sync OFF)

You import issues, work on them locally, and manage GitHub manually. Faber is a local task manager only.

### Scenario 2: Sync ON, working with PRs

1. Import issue `#42` as task `T-005`
2. Start a session — worktree created on `feat/T-005-fix-login`
3. Agent completes work, you open Review
4. Create PR — body says `Closes #42`, PR URL saved on the task
5. Merge the PR on GitHub
6. Click Refresh in Review — Faber detects the merge, moves task to Done
7. Since the task has a linked PR, Faber does **not** call `gh issue close` — GitHub already closed it via the `Closes #42` reference

### Scenario 3: Sync ON, no PR (manual workflow)

1. Import issue `#15` as task `T-008`
2. Work on it directly (no worktree/PR)
3. Drag task to Done on the Kanban board
4. Faber runs `gh issue close 15` with a comment

### Scenario 4: Moving a task back

1. Task `T-008` is Done, issue `#15` is closed
2. You realize more work is needed and drag it back to In Progress
3. Faber runs `gh issue reopen 15`

### Scenario 5: Label sync

1. Label sync is ON with mapping: `in-progress` = `status:wip`, `in-review` = `status:review`
2. Task moves from Ready to In Progress
3. Faber adds `status:wip` to issue `#42`
4. Task moves to In Review
5. Faber removes `status:wip` and adds `status:review`

---

## Error Handling

All GitHub sync operations are **best-effort**. If a `gh` CLI call fails (network issue, permission problem, rate limit), the error is logged but the local task operation always succeeds. You'll never be blocked from managing tasks locally because of a GitHub API failure.

---

## Requirements

- [GitHub CLI (`gh`)](https://cli.github.com/) must be installed and authenticated (`gh auth login`)
- The project must be a Git repository with a GitHub remote
- You can verify your setup from **Settings > GitHub** (auth status check)
