import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Download, ExternalLink, Flag, RotateCcw, Terminal, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AgentIcon } from "../../lib/agentIcons";
import { Badge } from "../ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import {
  type ThemeColor,
  gradientHexColors,
} from "../ui/orecus.io/lib/color-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { sectionHeadingClass, ToggleRow } from "./shared";

import type { AgentInfo } from "../../types";

// ── Permission flag mapping per agent ──

const PERMISSION_FLAGS: Record<
  string,
  { flag: string; label: string; description: string }
> = {
  "claude-code": {
    flag: "--dangerously-skip-permissions",
    label: "Skip Permission Prompts",
    description:
      "The CLI will not ask for confirmation before running commands.",
  },
  codex: {
    flag: "--dangerously-bypass-approvals-and-sandbox",
    label: "Bypass Approvals & Sandbox",
    description:
      "The CLI will execute all actions without confirmation or sandboxing.",
  },
  gemini: {
    flag: "--yolo",
    label: "YOLO Mode",
    description:
      "The CLI will execute all actions without confirmation.",
  },
};

// ── Agent accent color mapping ──

const AGENT_ACCENT: Record<string, ThemeColor> = {
  "claude-code": "orange",
  codex: "emerald",
  gemini: "blue",
  opencode: "green",
};

/** Build the flags array from UI state, to persist via upsert_agent_config. */
function buildFlagsArray(
  agentName: string,
  skipPerms: boolean,
  customFlags: string,
): string[] {
  const flags: string[] = [];
  const permInfo = PERMISSION_FLAGS[agentName];
  if (skipPerms && permInfo) flags.push(permInfo.flag);
  if (customFlags.trim()) {
    flags.push(...customFlags.trim().split(/\s+/));
  }
  return flags;
}

/** Persist the agent config to the agent_configs table (global scope). */
function saveAgentConfig(agentName: string, flags: string[]) {
  invoke("upsert_agent_config", {
    scope: "global",
    scopeId: null,
    agentName,
    model: null,
    flags,
  }).catch(() => {});
}

// ── Agent Card ──

function AgentCard({ agent }: { agent: AgentInfo }) {
  const [expanded, setExpanded] = useState(false);
  const [skipPerms, setSkipPerms] = useState(false);
  const [customFlags, setCustomFlags] = useState("");
  const [loaded, setLoaded] = useState(false);

  const permInfo = PERMISSION_FLAGS[agent.name];
  const accentColor = AGENT_ACCENT[agent.name] ?? "primary";
  const accentHex =
    gradientHexColors[accentColor]?.start ?? gradientHexColors.primary.start;

  // Load persisted config from agent_configs table
  useEffect(() => {
    invoke<{ flags: string[] } | null>("get_agent_config", {
      agentName: agent.name,
      projectId: "__global__",
      taskId: null,
    })
      .then((config) => {
        if (config?.flags) {
          const permFlag = PERMISSION_FLAGS[agent.name]?.flag;
          if (permFlag && config.flags.includes(permFlag)) {
            setSkipPerms(true);
          }
          const custom = config.flags.filter((f) => f !== permFlag);
          if (custom.length > 0) setCustomFlags(custom.join(" "));
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [agent.name]);

  const handleSkipPermsChange = useCallback(
    (checked: boolean) => {
      setSkipPerms(checked);
      const flags = buildFlagsArray(agent.name, checked, customFlags);
      saveAgentConfig(agent.name, flags);
    },
    [agent.name, customFlags],
  );

  const handleFlagsChange = useCallback(
    (value: string) => {
      setCustomFlags(value);
      const flags = buildFlagsArray(agent.name, skipPerms, value);
      saveAgentConfig(agent.name, flags);
    },
    [agent.name, skipPerms],
  );

  const handleReset = useCallback(() => {
    setSkipPerms(false);
    setCustomFlags("");
    invoke("delete_agent_config", {
      scope: "global",
      scopeId: null,
      agentName: agent.name,
    }).catch(() => {});
  }, [agent.name]);

  // Build the command preview
  const previewParts = [agent.command];
  if (skipPerms && permInfo) previewParts.push(permInfo.flag);
  if (customFlags.trim()) previewParts.push(customFlags.trim());
  const commandPreview = previewParts.join(" ");

  if (!loaded) return null;

  return (
    <div className="rounded-lg bg-muted/20 ring-1 ring-border/30 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => agent.installed && setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${
          agent.installed ? "cursor-pointer hover:bg-accent/30" : ""
        }`}
      >
        {/* Agent icon with accent tint */}
        <div
          className="flex items-center justify-center size-8 rounded-md shrink-0"
          style={{ backgroundColor: `${accentHex}15` }}
        >
          <AgentIcon agent={agent.name} size={17} className="shrink-0" />
        </div>

        {/* Name + command */}
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">
            {agent.display_name}
          </span>
          <span className="text-xs text-muted-foreground font-mono truncate">
            {agent.command}
          </span>
        </div>

        {/* Status + actions */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`size-1.5 rounded-full shrink-0 ${agent.installed ? "bg-success" : "bg-destructive"}`}
          />
          <span className={`text-xs ${agent.installed ? "text-success" : "text-destructive"}`}>
            {agent.installed ? "Detected" : "Not found"}
          </span>

          {!agent.installed && agent.cli_install_url && (
            <a
              href={agent.cli_install_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <Download size={10} />
              Install
            </a>
          )}

          {agent.installed && (
            <ChevronDown
              size={14}
              className={`text-muted-foreground transition-transform duration-150 shrink-0 ${expanded ? "rotate-180" : ""}`}
            />
          )}
        </div>
      </button>

      {/* CLI install hint — shown when agent is NOT installed */}
      {!agent.installed && agent.cli_install_hint && (
        <div className="border-t border-border/30 px-3.5 py-2.5">
          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
            <Terminal size={12} className="shrink-0 text-muted-foreground" />
            <code className="flex-1 select-all text-xs text-dim-foreground font-mono">
              {agent.cli_install_hint}
            </code>
            {agent.cli_install_url && (
              <a
                href={agent.cli_install_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                title="Open install page"
              >
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Expanded body */}
      {expanded && agent.installed && (
        <div className="border-t border-border/30 px-3.5 py-3 flex flex-col gap-4">
          {/* Permissions toggle */}
          {permInfo && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Permissions
                </span>
                <Badge
                  variant="destructive"
                  className="text-2xs uppercase tracking-wide px-1.5 py-0"
                >
                  Security
                </Badge>
              </div>
              <ToggleRow
                label={permInfo.label}
                description={permInfo.description}
                checked={skipPerms}
                onChange={handleSkipPermsChange}
              />
            </div>
          )}

          {/* Custom flags */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">
              Custom Flags
            </span>
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <Flag className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                value={customFlags}
                onChange={(e) => handleFlagsChange(e.target.value)}
                placeholder={"e.g., --verbose --model opus"}
              />
            </InputGroup>
            <div className="text-2xs text-muted-foreground mt-1">
              Additional flags appended to every {agent.display_name} session.
            </div>
          </div>

          {/* Command preview + reset */}
          <div className="flex items-center gap-2 rounded-md bg-muted/30 px-2.5 py-2">
            <TerminalSquare size={13} className="shrink-0 text-muted-foreground" />
            <code className="flex-1 text-xs font-mono text-dim-foreground truncate select-all">
              {commandPreview}
            </code>
            <Button
              variant="ghost"
              size="icon-xs"
              hoverEffect="none"
              clickEffect="none"
              onClick={handleReset}
              title={`Reset ${agent.display_name} config`}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw size={12} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agents Tab ──

export function AgentsTab({ agents }: { agents: AgentInfo[] }) {
  const firstInstalled = agents.find((a) => a.installed)?.name ?? "";
  const [defaultAgent, setDefaultAgent] = useState(firstInstalled);

  useEffect(() => {
    invoke<string | null>("get_setting", { key: "default_agent" })
      .then((v) => {
        if (v) {
          setDefaultAgent(v);
        } else if (firstInstalled) {
          setDefaultAgent(firstInstalled);
          invoke("set_setting", {
            key: "default_agent",
            value: firstInstalled,
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }, [firstInstalled]);

  const handleAgentChange = useCallback((value: string) => {
    setDefaultAgent(value);
    invoke("set_setting", { key: "default_agent", value }).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {/* Default agent selector */}
      <section>
        <div className={sectionHeadingClass}>Default Agent</div>
        <div className="max-w-80">
          <Select
            value={defaultAgent}
            onValueChange={(val) => {
              if (val) handleAgentChange(val);
            }}
            items={agents.map((a) => ({
              value: a.name,
              label: `${a.display_name}${a.installed ? "" : " (not installed)"}`,
            }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.name} value={a.name}>
                  <span className="inline-flex items-center gap-2">
                    <AgentIcon agent={a.name} size={14} />
                    {a.display_name}
                    {a.installed ? "" : " (not installed)"}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Agent cards */}
      <section>
        <div className={sectionHeadingClass}>Agent Configuration</div>
        <div className="flex flex-col gap-2">
          {agents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </div>
      </section>
    </div>
  );
}
