---
title: Skills & Rules
description: Manage agent instruction files and install reusable skills
icon: puzzle
order: 4
---

# Skills & Rules

The Skills & Rules view gives you control over two things: **Rules** (instruction files that tell agents how to behave in your project) and **Skills** (reusable extensions you can install from the skills.sh registry).

Open it from the **Skills** tab in the top bar, or via the command palette.

---

## Rules

Rules are Markdown files that live in your project root and provide instructions to AI agents. Each agent reads a specific file:

| Agent | Instruction File |
|---|---|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |
| Cursor | `.cursorrules` |
| Copilot | `.github/copilot-instructions.md` |

Use these files to set coding standards, architectural guidelines, preferred libraries, or any other project-specific context you want the agent to follow.

### Editing Rules

1. Open **Skills → Rules** tab
2. Select an instruction file from the chip buttons at the top — a green dot means the file already exists, gray means it doesn't yet
3. Edit the content in the text area
4. Press **Ctrl+S** (or **Cmd+S** on macOS) or click **Save**

If a file doesn't exist yet, click **Create {filename}** to initialize it with a starter template.

### How Rules Work with Sessions

When you launch a session, Faber automatically appends an **MCP integration section** to the agent's instruction file. This section (wrapped in `<!-- Faber:MCP -->` markers) gives the agent access to Faber's progress-reporting tools. Your custom content is always preserved — Faber only touches the marked section.

If the instruction file contained nothing but the MCP section (i.e., you never added custom content), Faber cleans it up when the session ends.

---

## Skills

Skills are pre-built code packages that extend what AI agents can do. They come from the [skills.sh](https://skills.sh) registry, maintained by Vercel Labs.

Skills are installed as directories containing a `SKILL.md` file (metadata and instructions) along with supporting files.

### Scope

| Scope | Location | Availability |
|---|---|---|
| **Project** | `<project>/.claude/skills/` | Only this project |
| **Global** | `~/.claude/skills/` | All projects |

### Searching & Installing

1. Open **Skills → Skills** tab
2. Type a search query (e.g., "python", "testing", "deploy")
3. Browse results — each shows the skill name, install count, and source repo
4. Click the skill name to open its page on skills.sh
5. Click **Install** for project-level install, or **Global** for a global install

Installation runs `npx skills add` under the hood, so **npm/npx must be installed** on your system.

### Browsing Installed Skills

Below the search area, you'll see two sections:

- **Project Skills** — installed in this project's `.claude/skills/` directory
- **Global Skills** — installed in `~/.claude/skills/`, shared across all projects

Click a skill to expand it and view its full `SKILL.md` documentation. Hover over a skill and click the trash icon to remove it.

### How Agents Use Skills

Agents that support the `.claude/skills/` convention (like Claude Code) automatically discover and load installed skills at runtime. Faber manages installation and browsing — the agent handles loading.

---

## Prerequisites

- **npm / npx** — Required for installing and removing skills (`npx skills add/remove`)
- **Network access** — Skill search queries the skills.sh API

## File Size Limits

| Resource | Max Size |
|---|---|
| Instruction files | 2 MB |
| Skill content (SKILL.md) | 1 MB |
