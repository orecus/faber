---
title: Extensions
description: Manage agent rules, install skills, and browse Claude Code plugins
icon: puzzle
order: 6
---

# Extensions

The Extensions view lets you manage three kinds of agent customization: **Rules** (instruction files that tell agents how to behave), **Skills** (reusable packages from the skills.sh registry), and **Plugins** (Claude Code marketplace extensions).

Open it from the **Extensions** tab in the top bar, or via the command palette.

---

## Rules

Rules are Markdown files that live in your project (or globally in your home directory) and provide instructions to AI agents. Each agent reads specific files:

| Agent | Instruction File |
|---|---|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |
| Cursor | `.cursorrules` |
| Copilot | `.github/copilot-instructions.md` |

Use these files to set coding standards, architectural guidelines, preferred libraries, or any other project-specific context you want the agent to follow.

### Rules Layout

The Rules tab has a two-panel layout:

- **Left panel** — A tree view organized by agent, showing both project-level and global rule files. A green dot indicates the file exists; gray means it hasn't been created yet.
- **Right panel** — A full editor for the selected rule file with syntax highlighting, save indicator, and keyboard shortcuts.

Only agents that are currently installed on your system appear in the tree.

### Editing Rules

1. Open **Extensions → Rules**
2. Select a rule file from the tree panel on the left
3. Edit the content in the editor on the right
4. Press **Ctrl+S** (or **Cmd+S** on macOS) to save

### Creating New Rules

If a rule file doesn't exist yet, you can create one:

- Click the **+ New Rule** button in the tree panel header
- Choose the agent and scope (project or global)
- The file is created with a starter template and opens in the editor

### Project vs Global Rules

| Scope | Location | Availability |
|---|---|---|
| **Project** | `<project root>/` (e.g., `CLAUDE.md`) | Only this project |
| **Global** | `~/` (e.g., `~/CLAUDE.md`) | All projects |

Project rules take precedence — agents typically read the project-level file first.

### How Rules Work with Sessions

When you launch a session, Faber automatically appends an **MCP integration section** to the agent's instruction file. This section (wrapped in `<!-- Faber:MCP -->` markers) gives the agent access to Faber's progress-reporting and task management tools. The content is tailored to the session mode — task sessions include completion workflow instructions, research sessions include research-specific guidance, etc. Your custom content is always preserved — Faber only touches the marked section.

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

1. Open **Extensions → Skills**
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

## Plugins

The Plugins tab lets you browse, install, and manage extensions from Claude Code plugin marketplaces. This tab requires **Claude Code CLI** to be installed — it is disabled if Claude Code is not detected on your system.

### Browsing Plugins

The Plugins tab shows a searchable, filterable grid of all extensions available from your configured marketplace sources. Each card shows:

- Extension name and author
- Description
- Component badges (skills, agents, commands, hooks, MCP, LSP)
- Extension type badge (Skill, Agent, LSP, MCP, Hook, Command, or Mixed)
- Install count (from marketplace data)
- Installed status and scope

### Filtering

Two filter dimensions are available:

- **Type** — Filter by extension type (Plugins, Skills, Agents, LSP, MCP, Hooks, Commands, Mixed). Only shown when multiple types exist.
- **Category** — Filter by category (Development, Productivity, Integrations, Security, etc.). Categories come from marketplace metadata.

Both filters can be combined, and the search bar works alongside them.

### Installing & Managing

- Click a card to open the **detail panel** on the right, which shows full metadata, action buttons, and the plugin's README
- Click **Install** to install an extension (installs to user scope by default)
- Click **Update** on an installed extension to pull the latest version
- Click **Uninstall** to remove an extension

All operations run via `claude plugin install|uninstall|update` under the hood.

### Marketplace Sources

Collapse the **Marketplace Sources** section at the bottom to manage where Faber discovers plugins:

- **Add source** — Enter a GitHub repository URL or `owner/repo` shorthand
- **Remove** — Hover over a source and click the unplug icon
- **Refresh** — Update all marketplace catalogs to fetch the latest plugin lists

The official Claude Code marketplace is configured by default. Community marketplaces (like [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)) can be added for additional extensions.

### Extension Types

Plugins can contain different types of components. Faber infers the extension type from what's inside:

| Type | Contents |
|---|---|
| **Skill** | Skills directory with skill definitions |
| **Agent** | Agent definitions |
| **LSP** | Language Server Protocol integration |
| **MCP** | Model Context Protocol server |
| **Hook** | Lifecycle hooks |
| **Command** | Custom CLI commands |
| **Mixed** | Multiple component types |
| **Plugin** | Default (no specific components detected) |

---

## Prerequisites

| Feature | Requirement |
|---|---|
| Rules | No external dependencies |
| Skills | **npm / npx** for installing and removing skills (`npx skills add/remove`) |
| Plugins | **Claude Code CLI** (`claude` command) for all plugin operations |

## File Size Limits

| Resource | Max Size |
|---|---|
| Rule files | 2 MB |
| Skill content (SKILL.md) | 1 MB |
| Plugin README | 2 MB |
