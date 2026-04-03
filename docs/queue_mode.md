---
title: Queue Mode
description: Queue tasks and run them sequentially with automatic handoff
icon: list-checks
order: 4
---

# Queue Mode

Queue Mode lets you queue multiple tasks and run them sequentially with automatic handoff between agents. When one task finishes, the next one starts automatically — no manual intervention needed.

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

### Task Queue

All tasks in **Ready** status are listed with checkboxes. You can:

- **Uncheck** tasks you don't want to include (minimum 2 required)
- **Reorder** tasks using the up/down arrows
- See **priority badges** and **dependency counts** for each task

### Branching Strategy

| Strategy | Behavior |
|---|---|
| **Independent** | Each task gets its own branch from the base branch. Tasks are isolated from each other. Best for unrelated work. |
| **Chained** | Each task branches from the previous task's branch. Changes accumulate. Best for sequential work where later tasks build on earlier ones. |

### Smart Strategy Suggestion

If your tasks have `depends_on` relationships (set manually or detected during [GitHub import](/help/github_workflow)), Faber analyzes the dependency graph and:

- **Auto-suggests Chained** when tasks have dependency links
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

```
Task 1 (running) → agent completes → mark "in-review" → stop session
    ↓
Task 2 (running) → agent completes → mark "in-review" → stop session
    ↓
Task 3 (running) → agent completes → mark "in-review" → stop session
    ↓
All done — queue mode finishes
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

## Branching Strategies in Detail

### Independent

```
main ──┬── feat/T-001-auth ──── (task 1 work)
       ├── feat/T-002-api ───── (task 2 work)
       └── feat/T-003-ui ────── (task 3 work)
```

Each task gets a clean branch from the base. No task can see another task's changes. This is ideal when tasks are unrelated and can be reviewed/merged independently.

### Chained

```
main ── feat/T-001-auth ── feat/T-002-api ── feat/T-003-ui
         (task 1 work)      (task 2 work)     (task 3 work)
```

Each task branches from the previous task's branch. Later tasks can see and build on earlier changes. This is ideal when tasks form a sequence — for example, "set up auth" → "build API endpoints using auth" → "build UI using the API".

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

1. The strategy is auto-set to **Chained**
2. Tasks are auto-sorted so dependencies run before dependents
3. An info banner shows the detected dependency links

---

## Requirements

- Tasks must be in **Ready** status to appear in the queue
- Minimum 2 tasks required
- At least one agent must be installed
- The project must be a Git repository (for worktree/branch creation)
