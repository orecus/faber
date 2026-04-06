---
title: Queue Mode
description: Run multiple tasks with automatic handoff and dependency orchestration
icon: list-checks
order: 4
---

# Queue Mode

Queue Mode lets you run multiple tasks with automatic handoff between agents. Tasks can run in parallel (Independent) or with dependency-aware orchestration that auto-merges completed work into a shared branch.

---

## Quick Start

1. Move 2 or more tasks to **Ready** status on the Kanban board
2. Click the **Queue** button in the Dashboard toolbar
3. Select and order your tasks in the queue
4. Choose a branching strategy and agent
5. Click **Start**

The first task launches immediately. When the agent calls `report_complete`, Faber marks the task as **In Review** and automatically launches the next task in the queue. The completed session stays open so you can review the agent's output.

---

## The Launch Dialog

### Strategy

Choose how tasks are executed and how branches are managed:

| Strategy | Behavior |
|---|---|
| **Independent** | Each task gets its own branch from the base branch. All tasks run in parallel. No auto-merge — you manage merge ordering. Best for unrelated work. |
| **Orchestrated** | Dependency-aware execution with auto-merge. Tasks launch when their dependencies complete, and finished work is automatically merged into a shared integration branch. Best for related work with dependencies. |

### Task Queue

The task list adapts based on your chosen strategy:

- **Independent**: A flat, reorderable list. Use checkboxes to include/exclude tasks and arrows to reorder.
- **Orchestrated**: Tasks are grouped into **execution phases**. Phase 1 contains tasks with no dependencies (they run in parallel). Phase 2 contains tasks that depend on Phase 1, and so on. Each phase starts only after the previous phase completes.

Both views show **priority badges**, **dependency counts**, and **per-task agent overrides**.

### Smart Strategy Suggestion

If your tasks have `depends_on` relationships (set manually or detected during [GitHub import](/help/github_workflow)), Faber analyzes the dependency graph and:

- **Auto-suggests Orchestrated** when tasks have dependency links
- **Auto-sorts** tasks in dependency order (dependencies run first)
- Shows an info banner explaining the detected relationships

You can always override the suggestion by clicking the other strategy.

### Agent & Model

Select which AI agent to use for all tasks in the queue. You can optionally override the default model. The agent selection works the same as the regular session launcher.

### Base Branch

Choose which branch to create task branches from. Defaults to the current HEAD.

---

## Status Bar

While Queue Mode is active, a status bar appears at the top of the Dashboard view showing:

- **Progress**: "Task 2/5 — [task title]" with a visual progress bar
- **Status indicator**: Green (running), Yellow (paused), Red (error)
- **Controls**: Pause, Resume, and Stop buttons

---

## How It Works

### Normal Flow

**Independent**: All tasks launch in parallel. As each agent calls `report_complete`, its task moves to **In Review**. The queue finishes when all tasks are done.

**Orchestrated**: Root tasks (no dependencies) launch first. When an agent completes, its branch is auto-merged into the integration branch, the task moves to **In Review**, and any newly-unblocked tasks in the next phase launch automatically.

```
Phase 1 tasks launch → agents complete → merge to integration branch
    ↓
Phase 2 tasks launch (deps satisfied) → agents complete → merge
    ↓
All phases done — queue mode finishes
```

Each task transition includes a 2-second delay to let the agent's terminal finish writing output before the session is stopped.

### Pausing

Click **Pause** to prevent auto-advancement. The currently running agent session continues working, but when it finishes, the next task will not start automatically. Click **Resume** to continue the queue.

If the agent finishes while paused, Faber remembers this — resuming will immediately advance to the next task.

### Stopping

Click **Stop** to end queue mode entirely. The currently running session is terminated and the queue is cleared.

### Error Handling

If an agent crashes (PTY exits without calling `report_complete`), Faber:

1. Marks the current queue item as **Error**
2. Pauses the queue run
3. Shows the error in the status bar

You can then investigate, fix the issue, and resume to continue with the next task.

If you manually stop a session that's part of a queue run, the run is paused (not stopped). This lets you restart from where you left off.

---

## Strategies in Detail

### Independent

```
main ──┬── feat/T-001-auth ──── (task 1 work)
       ├── feat/T-002-api ───── (task 2 work)
       └── feat/T-003-ui ────── (task 3 work)
```

Each task gets a clean branch from the base. All tasks launch in parallel. No auto-merge — you review and merge each branch independently. Ideal when tasks are unrelated.

### Orchestrated

```
main ── queue/qr_abc123 (integration branch)
           ↑ merge T-001  ↑ merge T-002  ↑ merge T-003

Phase 1: T-001 (no deps)     ← runs immediately
Phase 2: T-002 (depends on T-001) ← runs after Phase 1 completes
Phase 3: T-003 (depends on T-002) ← runs after Phase 2 completes
```

Tasks are grouped into phases based on their dependency graph. Within each phase, tasks with no mutual dependencies run in parallel. After each task completes, its branch is automatically merged into a shared **integration branch** (`queue/<run_id>`). Later phases branch from this integration branch, so they can see all previously merged work.

If a merge conflict occurs, the queue pauses and you can resolve it manually, then either **retry the merge** or **skip** the conflicted task.

---

## Task Dependencies & Ordering

Tasks can declare dependencies via the `depends_on` field in their task file frontmatter:

```yaml
---
id: T-003
title: Build UI components
depends_on:
  - T-001
  - T-002
---
```

Dependencies can also be **auto-detected** when importing GitHub issues. If an issue body contains patterns like "depends on #42" or "blocked by #15", Faber resolves these to local task IDs during import.

When you open the Queue Mode dialog with tasks that have dependencies:

1. The strategy is auto-set to **Orchestrated**
2. Tasks are grouped into execution phases based on the dependency graph
3. An info banner shows the detected dependency links

---

## Requirements

- Tasks must be in **Ready** status to appear in the queue
- Minimum 2 tasks required
- At least one agent must be installed
- The project must be a Git repository (for worktree/branch creation)
