---
title: Supported Agents
description: Which AI agents work with Faber and how they differ
icon: bot
order: 3
---

# Supported Agents

Faber orchestrates multiple AI coding agents through a unified interface. Each agent runs in its own PTY terminal session with full MCP (Model Context Protocol) integration for progress reporting.

---

## Agent Overview

| Agent | CLI Command | Default Model | System Prompt | MCP Config |
|---|---|---|---|---|
| **Claude Code** | `claude` | `sonnet` | CLI flag | `.mcp.json` |
| **Codex CLI** | `codex` | `gpt-5.3-codex` | Instruction file | `.codex/mcp.json` |
| **Copilot CLI** | `copilot` | *(Copilot default)* | Instruction file | `.copilot/mcp-config.json` |
| **Cursor Agent** | `agent` / `cursor-agent` | `claude-4-opus` | Instruction file | `.cursor/mcp.json` |
| **Gemini CLI** | `gemini` | `gemini-2.5-pro` | Instruction file | `.gemini/settings.json` |
| **OpenCode** | `opencode` | *(user-specified)* | Instruction file | `opencode.json` |

All agents are auto-detected from your system PATH. You can see which agents are available in the session launcher.

---

## Claude Code

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) is Anthropic's official CLI agent.

**Supported models:** `opus`, `sonnet`, `haiku`, `sonnet[1m]`

**How it works:**
- System prompt is passed via the `--system-prompt` CLI flag
- MCP tool documentation is also written to a `CLAUDE.md` file in the working directory (using `<!-- Faber:MCP -->` markers to preserve your own content)
- MCP config is written to `.mcp.json` in the working directory
- Model is selected with the `--model` flag

---

## Codex CLI

[Codex CLI](https://github.com/openai/codex) is OpenAI's open-source coding agent.

**Supported models:** `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1-codex-mini`

**How it works:**
- System prompt is written to an `AGENTS.md` file in the working directory (Codex reads this automatically)
- MCP config is written to `.codex/mcp.json`
- Model is selected with the `--model` flag

---

## Copilot CLI

[Copilot CLI](https://github.com/features/copilot/cli) is GitHub's agentic coding assistant for the terminal.

**Supported models:** `claude-sonnet-4-5`, `claude-opus-4-6`, `gpt-5.3-codex`, `gemini-3-pro`

**How it works:**
- System prompt is written to an `AGENTS.md` file in the working directory (Copilot reads this automatically)
- MCP config is written to `.copilot/mcp-config.json`
- Model is selected with the `--model=MODEL` flag
- Uses `-i` (interactive with initial prompt) to keep the session alive and ensure MCP connectivity
- Supports `--autopilot` for autonomous continuation and `--allow-all-tools` to skip tool confirmations

---

## Cursor Agent

[Cursor Agent](https://cursor.com/docs/cli/overview) is the CLI version of Cursor's AI coding assistant.

**Supported models:** `claude-4-opus`, `claude-4.5-sonnet`, `gpt-5`, `gpt-5.1`, `gemini-3-pro`, `gemini-3-flash`

**How it works:**
- System prompt is written to an `AGENTS.md` file in the working directory
- MCP config is written to `.cursor/mcp.json`
- Model is selected with the `--model` flag
- Faber checks for both `agent` and `cursor-agent` binary names during detection

---

## Gemini CLI

[Gemini CLI](https://github.com/google-gemini/gemini-cli) is Google's AI coding agent.

**Supported models:** `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-pro`, `gemini-3-flash`

**How it works:**
- System prompt is written to a `GEMINI.md` file in the working directory
- MCP config is written to `.gemini/settings.json`
- Model is selected with the `--model` flag

---

## OpenCode

[OpenCode](https://opencode.ai/docs/#install) is an open-source terminal AI assistant.

**Supported models:** None built-in — you specify the model directly in the agent config.

**How it works:**
- System prompt is written to an `AGENTS.md` file in the working directory (Faber uses `<!-- Faber:MCP -->` markers so your own edits are preserved)
- User prompt (initial task message) is passed via the `--prompt` CLI flag
- MCP config is written to `opencode.json` in the working directory
- Model is selected with the `--model` flag

---

## How System Prompts Work

Faber composes a system prompt for each session that includes your project's IDE instructions (from `.agents/prompts/prompt.md`) and MCP tool documentation. The content is **tailored to the session mode** — task sessions get completion workflow instructions, research sessions get research-specific guidance, and vibe/chat sessions get a lighter set.

How this prompt reaches the agent depends on the agent:

- **CLI flag agents** (Claude Code): The prompt is passed directly as a command-line argument (`--system-prompt`). Faber also writes MCP documentation to `CLAUDE.md` using marker comments.
- **Instruction file agents** (Codex, Copilot, Cursor, Gemini, OpenCode): The prompt is written to the agent's instruction file in the working directory (`AGENTS.md` or `GEMINI.md`). Faber uses `<!-- Faber:MCP -->` markers so your own edits to these files are preserved.

When a session ends, Faber cleans up the instruction file — removing only the Faber-managed section.

---

## MCP Integration

All agents receive MCP (Model Context Protocol) configuration that connects them back to Faber. This lets agents report their progress, file changes, and completion status in real time.

The MCP config is written to the agent's expected config location before the session starts. Faber merges its config with any existing user-defined MCP servers — only the `"faber"` entry is managed. When the session ends, only the Faber entry is removed.

### Available MCP Tools

Agents can call these tools to communicate with Faber. The tools available depend on the session mode — agents only see tools relevant to their session type.

#### Status & Progress (all sessions)

| Tool | Purpose |
|---|---|
| `report_status` | Set working status, message, and activity type. Call first when starting work. |
| `report_progress` | Report step N of M with description. Drives the progress bar in the UI. |
| `report_files_changed` | List files that were created, modified, or deleted |
| `report_error` | Report a hard blocker. The agent should stop and wait after calling this. |
| `report_waiting` | Signal that user input is needed. The session pauses until the user responds. |

#### Task Management (all sessions)

| Tool | Purpose |
|---|---|
| `get_task` | Fetch task metadata and full markdown body |
| `update_task` | Update task metadata (status, priority, labels, etc.) |
| `update_task_plan` | Update the implementation plan section of a task file |
| `create_task` | Create a new task in the current project |
| `list_tasks` | List tasks in the project with optional status/label filters |

#### Completion (session-mode-specific)

| Tool | Available in | Purpose |
|---|---|---|
| `report_complete` | Task, Queue | Signal that the task is fully done. Moves the task to **In Review**. In queue mode, auto-launches the next task. |
| `report_researched` | Research | Signal that research is complete. The user is prompted to continue to implementation. May move the task from Backlog to Ready. |

Breakdown, Vibe, and Chat sessions have no completion tool — the user drives the lifecycle.

---

## Agent Configuration

### Per-Project Defaults

In **Settings > Project**, you can set a default agent and model. All new sessions will use this agent unless overridden at launch time.

### Per-Task Overrides

Each task can specify an agent and model in its frontmatter. This takes priority over the project default.

### Model Resolution Order

When launching a session, the model is resolved in this order (highest priority first):

1. Manual override in the session launcher
2. Agent config (per-task or per-project)
3. Task-level model setting
4. Project default model
5. Agent's built-in default model

---

## Requirements

Each agent must be installed separately and available in your system PATH. See each provider's documentation for installation instructions:

- **Claude Code**: [anthropic.com/claude-code](https://docs.anthropic.com/en/docs/claude-code/overview)
- **Codex CLI**: [github.com/openai/codex](https://github.com/openai/codex)
- **Copilot CLI**: [github.com/features/copilot/cli](https://github.com/features/copilot/cli)
- **Cursor Agent**: [cursor.com/docs/cli](https://cursor.com/docs/cli/overview)
- **Gemini CLI**: [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)
- **OpenCode**: [opencode.ai/docs](https://opencode.ai/docs/#install)

You can verify which agents are detected from the session launcher — only installed agents appear as options.
