import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Flag, RotateCcw, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AgentIcon } from "../../lib/agentIcons";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";
import { Card, CardContent } from "../ui/orecus.io/cards/card";
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
import { sectionHeadingClass } from "./shared";

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
      "Adds --dangerously-skip-permissions flag. The CLI will not ask for confirmation before running commands.",
  },
  codex: {
    flag: "--dangerously-bypass-approvals-and-sandbox",
    label: "Bypass Approvals & Sandbox",
    description:
      "Adds --dangerously-bypass-approvals-and-sandbox flag. The CLI will execute all actions without confirmation or sandboxing.",
  },
  gemini: {
    flag: "--yolo",
    label: "YOLO Mode",
    description:
      "Adds --yolo flag. The CLI will execute all actions without confirmation.",
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
          // Custom flags = all flags except the known permission flag
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
    <Card
      type="normal"
      radius="lg"
      border
      accentBar="top"
      accentBarVariant="solid"
      accentColor={accentColor}
    >
      {/* Card header */}
      <CardContent
        onClick={() => agent.installed && setExpanded(!expanded)}
        className={`group flex items-center justify-between ${agent.installed ? "cursor-pointer" : ""}`}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center size-8 rounded-md shrink-0 transition-colors duration-150"
            style={{ backgroundColor: `${accentHex}18` }}
          >
            <AgentIcon agent={agent.name} size={18} className="shrink-0" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-foreground">
                {agent.display_name}
              </span>
              <div
                className={`size-1.5 rounded-full shrink-0 ${agent.installed ? "bg-success" : "bg-destructive"}`}
              />
            </div>
            <span className="text-[11px] text-muted-foreground font-mono truncate">
              {agent.command}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Badge
            variant={agent.installed ? "secondary" : "destructive"}
            className={`text-[11px] font-medium ${agent.installed ? "bg-emerald-500/10 text-success" : ""}`}
          >
            {agent.installed ? "Detected" : "Not found"}
          </Badge>
          {agent.installed && (
            <ChevronDown
              size={14}
              className="text-muted-foreground transition-transform duration-150 shrink-0"
              style={{
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          )}
        </div>
      </CardContent>

      {/* Card body — only shown when expanded */}
      {expanded && agent.installed && (
        <div className="border-t border-border px-6 py-4 flex flex-col gap-5">
          {/* Permissions section */}
          {permInfo && (
            <section>
              <div className="flex items-baseline gap-2 mb-2.5">
                <span className={`${sectionHeadingClass} mb-0`}>
                  Permissions
                </span>
                <Badge
                  variant="destructive"
                  className="text-[10px] uppercase tracking-wide"
                >
                  Security
                </Badge>
              </div>
              <label className="flex items-start gap-2.5 p-2.5 rounded-[var(--radius-element)] bg-background border border-border cursor-pointer">
                <Checkbox
                  checked={skipPerms}
                  onCheckedChange={(checked) =>
                    handleSkipPermsChange(checked === true)
                  }
                  className="mt-0.5"
                />
                <div>
                  <div className="text-[13px] font-medium text-foreground">
                    {permInfo.label}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 leading-[1.4]">
                    {permInfo.description}
                  </div>
                </div>
              </label>
            </section>
          )}

          {/* Custom flags section */}
          <section>
            <div className={`${sectionHeadingClass} mb-2.5`}>Custom Flags</div>
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <Flag className="size-4" />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                value={customFlags}
                onChange={(e) => handleFlagsChange(e.target.value)}
                placeholder={"e.g., --verbose --model opus"}
              />
            </InputGroup>
            <div className="text-[11px] text-muted-foreground mt-1.5">
              Additional flags to pass to the {agent.display_name} CLI. Separate
              multiple flags with spaces.
            </div>
          </section>

          {/* Command preview section */}
          <section>
            <div className={`${sectionHeadingClass} mb-2.5`}>
              Command Preview
            </div>
            <InputGroup className="cursor-default">
              <InputGroupAddon align="inline-start">
                <TerminalSquare className="size-4" />
              </InputGroupAddon>
              <InputGroupInput
                readOnly
                value={commandPreview}
                className="font-mono cursor-default"
              />
            </InputGroup>
            <div className="text-[11px] text-muted-foreground mt-1.5">
              This is the base command used when launching a new session. The
              session prompt and project-specific overrides will be appended
              automatically.
            </div>
          </section>

          {/* Reset button */}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              leftIcon={<RotateCcw className="size-3.5" />}
            >
              Reset {agent.display_name}
            </Button>
          </div>
        </div>
      )}
    </Card>
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
          // No persisted setting — auto-select first detected CLI and persist it
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
        <div className="flex flex-col gap-3 p-1">
          {agents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </div>
      </section>
    </div>
  );
}
