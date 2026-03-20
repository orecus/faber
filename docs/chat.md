---
title: Project Chat
description: Interactive conversations with ACP-capable agents
icon: message-circle
order: 1
---

# Project Chat

Project Chat is a conversational interface for talking to an ACP-capable agent about your project — no task binding, no worktree, just an open conversation. Use it to discuss architecture, explore ideas, plan features, or ask questions.

## Starting a Chat

Open the **Chat** tab in the top bar. If no chat session is active, you'll see the agent selection screen:

1. **Pick an agent** — Only agents with both the CLI and ACP adapter installed are selectable. Each card shows "CLI" and "ACP" status badges.
2. **Click "Start Chat"** — This launches an ACP session scoped to your current project.

> **Note:** Chat requires an ACP-capable agent (e.g. Claude Code with the ACP adapter). If none are installed, a warning banner explains what's needed.

Only one chat session can be active per project at a time. If you switch away and come back, the existing session is automatically resumed.

## The Chat Interface

### Toolbar

The toolbar shows:
- The agent name and a **status badge** — Connecting, Ready, Working (animated), Waiting (animated), Error, Completed, or Stopped.
- A **narration mode toggle** (Split / Inline) — controls how agent messages are displayed. See [Narration Modes](#narration-modes) below.
- A **Close** button — ends the session after a confirmation dialog.

### Sending Messages

Type in the input area at the bottom and press Enter to send. While the agent is working, the send button becomes a red stop button to cancel the current operation.

**Draft persistence** — If you type a message and switch to another view, your draft is saved and restored when you return.

### Slash Commands

Type `/` at the start of your message to see available commands:

- `/plan` — Ask the agent to create a plan
- `/status` — Check current progress
- `/files` — List relevant or changed files

Agents may also provide their own commands dynamically, shown with a sparkle icon.

### File Mentions

Type `@` anywhere in your message to browse project files. A suggestion overlay shows matching files and directories — select one to insert its path into your message.

### Attachments

If the agent supports file or image attachments, a paperclip button appears in the input toolbar. You can attach:
- **Images** (PNG, JPG, GIF, WebP, BMP, SVG) — shown as thumbnail previews
- **Files** — attached as context for the agent

### Model & Mode Selection

The input toolbar includes:
- **Mode selector** — Switch between agent modes (if the agent reports multiple modes)
- **Model selector** — Choose which AI model to use, with search and grouping by provider
- **Config options** — A gear icon for additional agent-specific settings
- **Context usage** — A compact indicator showing how much of the agent's context window is used, with cost information on hover

## Understanding the Timeline

Messages are organized into **turns** — each user message starts a new turn, and everything the agent does until your next message belongs to that turn.

### Agent Turn Blocks

Each agent turn shows a chain-of-thought timeline of what the agent did:

| Step Type | Display |
|---|---|
| **File read** | File path with line count |
| **File edit** | Inline diff with +/- line stats, expandable |
| **File delete** | Red-accented card with strikethrough filename |
| **Command execution** | `$ command` with expandable terminal output and exit code |
| **Search** | Query with result count, expandable |
| **Thinking** | "Thought for N seconds" with expandable reasoning text |
| **Web fetch** | URL with expandable response content |

Special indicators within turns:
- **Progress reports** — Compact progress bar showing step counts
- **Files changed** — Badge list of affected files with create/modify/delete labels
- **Errors** — Red callout cards
- **Waiting for input** — Pulsing warning card with the agent's question
- **Task created/updated** — Collapsible card showing task details

When a turn has more than 5 steps, the middle items collapse into a summary row. The first 2 and last 2 steps always remain visible.

### Narration Modes

The toolbar toggle controls how multi-step agent responses are displayed:

- **Split turns** (default) — Each agent message gets its own turn block with its associated tool calls grouped chronologically. Best for following the agent's reasoning step by step.
- **Inline** — All tool calls appear in a single block, with intermediate agent messages rendered as inline narration between steps. The final message is the primary response. Best for a compact view.

## Thinking & Reasoning

When an agent includes thinking/reasoning in its response, a collapsible "Thought for N seconds" block appears above the message. Click to expand and read the agent's internal reasoning. These blocks are open while streaming and collapse when complete.

## Waiting for Input

When the agent needs your input, two things happen:

1. A **Waiting Card** slides up above the input area showing the agent's question. You can dismiss it, and it reappears if the agent sends a new question.
2. The toolbar status badge changes to **Waiting** with an animated warning style.

Simply type your response in the input area to continue the conversation.

## Plan & Activity

When the agent sends plan updates, a **plan queue** widget appears showing plan entries with pending/in-progress/completed indicators and an overall progress counter.

An **Activity Bar** side panel (toggle from the toolbar) provides:
- **Plan** — Full plan view with progress bar
- **Files** — Aggregated list of all files the agent has edited, created, or deleted, with per-file diff stats

## Edit and Resend

Hover over any of your sent messages to reveal a pencil icon. Click it to copy that message back into the input area for editing and resending.

## Closing a Chat

Click the **Close** button in the toolbar. A confirmation dialog warns that conversation history will be lost. Confirming ends the session and returns to the agent selection screen.

## ACP Permissions

When an agent requests a privileged action (file write, terminal command), a permission dialog appears inline in the chat. See the [ACP Permissions](acp_permissions) guide for details on how permissions work, how to configure rules, and trust mode policies.
