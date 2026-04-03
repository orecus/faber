---
title: ACP Permissions
description: Control what ACP agents can do with granular permission rules
icon: shield
order: 5
---

# ACP Permissions

When an ACP agent needs to perform a privileged action — reading a file, writing a file, or running a terminal command — the permission system decides whether to allow it automatically, prompt you for approval, or deny it outright.

## How It Works

Each permission request is evaluated against your rules in order of specificity:

1. **Exact match** — A rule matching both the capability type and the file path or command pattern.
2. **Capability match** — A rule matching the capability type with no path filter (applies to all paths).
3. **Project default** — The default policy you've set for the project.
4. **Global fallback** — If nothing else matches, the action defaults to "Ask".

The result is one of three actions:

| Action | Behavior |
|---|---|
| **Auto-Approve** | The agent proceeds silently — no dialog shown |
| **Ask** | A permission dialog appears in the session for you to approve or deny |
| **Deny** | The request is rejected silently |

## In-Session Permission Dialog

When a request requires your approval, a **permission card** appears at the top of the chat pane:

- A **countdown timer** shows how long you have to respond (default: 2 minutes). The progress bar depletes over time and turns red in the last 30 seconds.
- The card shows the **capability type** (File Read, File Write, or Terminal) with a colored icon, plus the specific file path or command.
- **Approve** — Allow this action.
- **Deny** — Block this action.
- **"Always allow" checkbox** — Check this before approving to create a permanent auto-approve rule for this capability, so you won't be asked again.

If the timer expires without a response, the request is automatically denied.

## Floating Permission Banner

When a session has pending permission requests and you're in a different view (Dashboard, GitHub, etc.), a **floating banner** appears at the top of the screen showing how many requests are waiting. Click it to navigate directly to the session.

## Permission Notifications

OS notifications fire when agents request permissions (if the "Input Needed" notification is enabled in Settings). Click the notification to jump to the session.

## Settings

Open **Settings → ACP Permissions** to configure the permission system for your current project.

### Default Policy

The fallback action when no rule matches a request:

- **Ask (safest)** — Show a dialog for every unmatched request. This is the default.
- **Auto-Approve** — Silently approve unmatched requests. Use this if you fully trust the agent.
- **Deny** — Silently deny unmatched requests.

### Trust Mode

Controls permission behavior during **autonomous operation** (queue mode, auto-launched task queues):

- **Auto-approve all** — No permission dialogs when running autonomously.
- **Use normal rules** — Apply the same rule set as interactive sessions.
- **Deny write operations** — Allow reads but block all writes in autonomous mode. Useful for safe queue runs.

### Permission Timeout

How long a permission dialog waits before auto-denying (10–600 seconds, default 120). Increase this if you need more time to review requests, or decrease it for faster autonomous fallback.

### Permission Rules

Create granular rules to control agent access:

| Field | Options |
|---|---|
| **Capability** | File Read, File Write, Terminal, or All |
| **Path Pattern** | Optional glob pattern (e.g. `src/**`, `*.config.js`). Leave empty for all paths. |
| **Action** | Auto-Approve, Ask, or Deny |

Rules are evaluated most-specific-first. For example, a rule denying writes to `*.env` takes priority over a general auto-approve rule for File Write.

Click the trash icon on any rule to delete it. Use "Reset all" to remove all rules for the project.

### Recent Decisions (Audit Log)

The settings tab shows the last 5 permission decisions with:
- A colored indicator (green = approved, red = denied)
- The capability and file path or command
- The outcome (auto-approved, approved, denied, or auto-denied)

This helps you see what agents have been doing and tune your rules accordingly.

## Transport Selector

When launching a task or research session, agents with ACP support show a **Terminal / Chat** toggle in the launch dialog:

- **Terminal (PTY)** — Classic terminal session with raw output.
- **Chat (ACP)** — Structured chat UI with tool call visualization and permission management.

The toggle defaults to Chat when the selected agent has ACP installed. Switching agents automatically updates the default based on their ACP support.

> **Tip:** Project Chat always uses ACP — the transport selector only appears in task and research launch dialogs.
