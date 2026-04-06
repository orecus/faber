import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  BarChart3,
  Check,
  CircleHelp,
  Copy,
  Loader2,
  Radio,
  RefreshCw,
  Settings,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { AgentIcon } from "../../lib/agentIcons";
import { useAppStore } from "../../store/appStore";
import UsageProgressBar from "./UsageProgressBar";

import type { AgentUsageData, McpInfo, ViewId } from "../../types";

// ── Key command config per view ──

interface KeyCommand {
  keys: string;
  label: string;
}

const VIEW_KEY_COMMANDS: Record<ViewId, KeyCommand[]> = {
  dashboard: [
    { keys: "Ctrl+N", label: "New task" },
    { keys: "Ctrl+K", label: "Command" },
    { keys: "/", label: "Search" },
  ],
  sessions: [
    { keys: "Ctrl+K", label: "Command" },
    { keys: "Ctrl+B", label: "Files" },
  ],
  chat: [
    { keys: "Enter", label: "Send" },
    { keys: "Ctrl+K", label: "Command" },
  ],
  "task-detail": [
    { keys: "Ctrl+K", label: "Command" },
    { keys: "Esc", label: "Back" },
  ],
  review: [{ keys: "Ctrl+K", label: "Command" }],
  github: [{ keys: "Ctrl+K", label: "Command" }],
  "skills-rules": [
    { keys: "Ctrl+S", label: "Save" },
    { keys: "Ctrl+K", label: "Command" },
  ],
  help: [{ keys: "Ctrl+K", label: "Command" }],
  settings: [
    { keys: "Esc", label: "Back" },
    { keys: "Ctrl+K", label: "Command" },
  ],
};

// ── Kbd badge ──

function Kbd({ keys, label }: KeyCommand) {
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground select-none">
      <kbd className="px-1 py-px rounded bg-accent/60 font-mono text-2xs text-dim-foreground">
        {keys}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

// ── Usage popover content (reuses AgentUsageSection pattern) ──

const AgentUsageSection = React.memo(function AgentUsageSection({
  agent,
}: {
  agent: AgentUsageData;
}) {
  if (agent.needs_auth) {
    return (
      <div className="px-1 py-1">
        <div className="flex items-center gap-1.5 text-xs text-dim-foreground mb-1">
          <AgentIcon
            agent={agent.agent_name}
            size={13}
            className="shrink-0 opacity-80"
          />
          <span className="truncate">{agent.display_name}</span>
        </div>
        <div className="px-3 text-2xs text-muted-foreground">
          Run{" "}
          <code className="px-1 py-px rounded bg-accent/60 text-2xs">
            claude
          </code>{" "}
          to authenticate
        </div>
      </div>
    );
  }

  if (agent.error) {
    return (
      <div className="px-1 py-1">
        <div className="flex items-center gap-1.5 text-xs text-dim-foreground mb-1">
          <AgentIcon
            agent={agent.agent_name}
            size={13}
            className="shrink-0 opacity-80"
          />
          <span className="truncate">{agent.display_name}</span>
        </div>
        <div className="flex items-center gap-1 px-3 text-2xs text-destructive">
          <AlertTriangle size={10} className="shrink-0" />
          <span className="truncate">{agent.error}</span>
        </div>
      </div>
    );
  }

  if (agent.windows.length === 0) return null;

  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 px-1 text-xs text-dim-foreground mb-0.5">
        <AgentIcon
          agent={agent.agent_name}
          size={13}
          className="shrink-0 opacity-80"
        />
        <span className="truncate">{agent.display_name}</span>
      </div>
      {agent.windows.map((w) => (
        <UsageProgressBar
          key={w.label}
          label={w.label}
          utilization={w.utilization}
          resetTime={w.resets_at}
        />
      ))}
    </div>
  );
});

// ── Usage indicator + popover ──

const UsageIndicator = React.memo(function UsageIndicator() {
  const agentUsage = useAppStore((s) => s.agentUsage);
  const agentUsageLoading = useAppStore((s) => s.agentUsageLoading);
  const fetchAgentUsage = useAppStore((s) => s.fetchAgentUsage);

  // Compute the top utilization across all agents
  const topUtilization = useMemo(() => {
    let max = 0;
    for (const agent of agentUsage) {
      for (const w of agent.windows) {
        if (w.utilization > max) max = w.utilization;
      }
    }
    return Math.round(max);
  }, [agentUsage]);

  const handleRefresh = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      fetchAgentUsage();
    },
    [fetchAgentUsage],
  );

  if (agentUsage.length === 0 && !agentUsageLoading) return null;

  const utilizationColor =
    topUtilization >= 80
      ? "text-destructive"
      : topUtilization >= 50
        ? "text-warning"
        : "text-dim-foreground";

  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1.5 px-2 h-full text-xs text-dim-foreground cursor-pointer hover:bg-accent/40 rounded-sm transition-colors">
        {agentUsageLoading ? (
          <Loader2 size={12} className="animate-spin text-muted-foreground" />
        ) : (
          <BarChart3 size={12} className={utilizationColor} />
        )}
        <span className={utilizationColor}>{topUtilization}%</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={6}
        align="start"
        className="w-64 p-0"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-medium text-foreground">
            Agent Usage
          </span>
          <button
            onClick={handleRefresh}
            className="p-0.5 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            {agentUsageLoading ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <RefreshCw size={11} />
            )}
          </button>
        </div>
        <div className="py-1 overflow-y-auto">
          {agentUsage.map((agent) => (
            <AgentUsageSection key={agent.agent_name} agent={agent} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});

// ── MCP status segment ──

const McpStatus = React.memo(function McpStatus() {
  const mcpActiveCount = useAppStore((s) => Object.keys(s.mcpStatus).length);
  const [mcpInfo, setMcpInfo] = useState<McpInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshMcpInfo = useCallback(() => {
    invoke<McpInfo>("get_mcp_info")
      .then(setMcpInfo)
      .catch(() => setMcpInfo(null));
  }, []);

  useEffect(() => {
    refreshMcpInfo();
  }, [refreshMcpInfo]);

  const mcpOnline = mcpInfo != null && mcpInfo.port > 0;

  const handleCopy = useCallback(() => {
    if (!mcpInfo?.sidecar_path) return;
    navigator.clipboard.writeText(mcpInfo.sidecar_path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [mcpInfo]);

  return (
    <button
      onClick={handleCopy}
      title={mcpOnline ? "Click to copy MCP sidecar path" : "MCP offline"}
      className="group/mcp inline-flex items-center gap-1.5 px-2 h-full text-xs text-dim-foreground cursor-pointer hover:bg-accent/40 rounded-sm transition-colors"
    >
      <Radio
        size={12}
        className={mcpOnline ? "text-success" : "text-muted-foreground"}
      />
      {mcpOnline ? (
        <>
          <span>
            MCP :{mcpInfo.port}
            {mcpActiveCount > 0 && (
              <span className="ml-1 text-muted-foreground">
                ({mcpActiveCount})
              </span>
            )}
          </span>
          {copied ? (
            <Check size={10} className="text-success" />
          ) : (
            <Copy
              size={10}
              className="opacity-0 group-hover/mcp:opacity-100 transition-opacity text-muted-foreground"
            />
          )}
        </>
      ) : (
        <span className="text-muted-foreground">MCP</span>
      )}
    </button>
  );
});

// ── GitHub auth segment ──

const GitHubStatus = React.memo(function GitHubStatus() {
  const ghAuthStatus = useAppStore((s) => s.ghAuthStatus);

  if (!ghAuthStatus) return null;

  const notInstalled = !ghAuthStatus.installed;
  const notAuthenticated =
    ghAuthStatus.installed && !ghAuthStatus.authenticated;
  const scopeWarning = ghAuthStatus.has_scope_warnings;
  const hasWarning = notInstalled || notAuthenticated || scopeWarning;

  if (!hasWarning && ghAuthStatus.authenticated) {
    // All good — show subtle checkmark
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 h-full text-xs text-dim-foreground"
        title={`GitHub: ${ghAuthStatus.username ?? "authenticated"}`}
      >
        <Check size={12} className="text-success" />
        <span>GitHub</span>
      </span>
    );
  }

  if (!hasWarning) return null;

  const warningText = notInstalled
    ? "gh missing"
    : notAuthenticated
      ? "gh unauthed"
      : "gh scopes";

  const tooltip = notInstalled
    ? "GitHub CLI (gh) is not installed"
    : notAuthenticated
      ? "GitHub CLI is not authenticated. Run `gh auth login`"
      : `Missing scopes: ${ghAuthStatus.missing_scopes.join(", ")}`;

  const isScopeOnly = scopeWarning && !notInstalled && !notAuthenticated;
  const colorClass = isScopeOnly ? "text-warning" : "text-destructive";

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 h-full text-xs ${colorClass}`}
      title={tooltip}
    >
      <AlertTriangle size={12} />
      <span>{warningText}</span>
    </span>
  );
});

// ── Status Bar ──

export default function StatusBar() {
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const [version, setVersion] = useState("");
  useEffect(() => {
    invoke<string>("get_app_version")
      .then(setVersion)
      .catch(() => {});
  }, []);

  const keyCommands = VIEW_KEY_COMMANDS[activeView] ?? [];

  return (
    <div
      className="flex items-center h-7 min-h-7 max-h-7 border-t border-border select-none bg-card/60"
      style={{ gridArea: "statusbar" }}
    >
      {/* ── Left zone ── */}
      <div className="flex items-center h-full min-w-0 overflow-hidden">
        <McpStatus />
        <div className="w-px h-3.5 bg-border/60 shrink-0" />
        <GitHubStatus />
        <div className="w-px h-3.5 bg-border/60 shrink-0" />
        <UsageIndicator />
      </div>

      {/* ── Right zone ── */}
      <div className="ml-auto flex items-center gap-2 h-full pr-2">
        {/* Contextual key commands */}
        {keyCommands.length > 0 && (
          <div className="hidden sm:flex items-center gap-2.5">
            {keyCommands.map((cmd) => (
              <Kbd
                key={cmd.keys + cmd.label}
                keys={cmd.keys}
                label={cmd.label}
              />
            ))}
          </div>
        )}

        {keyCommands.length > 0 && (
          <div className="hidden sm:block w-px h-3.5 bg-border/60 shrink-0" />
        )}

        {/* Settings */}
        <button
          onClick={() => setActiveView("settings")}
          className={`inline-flex items-center gap-1.5 px-1.5 h-5 rounded-sm cursor-pointer transition-colors ${
            activeView === "settings"
              ? "text-primary bg-accent/60"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
          }`}
          title="Settings (Ctrl+,)"
        >
          <Settings size={13} />
          <span className="text-xs">Settings</span>
        </button>

        {/* Help */}
        <button
          onClick={() => setActiveView("help")}
          className={`inline-flex items-center gap-1.5 px-1.5 h-5 rounded-sm cursor-pointer transition-colors ${
            activeView === "help"
              ? "text-primary bg-accent/60"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
          }`}
          title="Help"
        >
          <CircleHelp size={13} />
        </button>

        {/* Version */}
        {version && (
          <span className="text-2xs text-muted-foreground tabular-nums">
            v{version}
          </span>
        )}
      </div>
    </div>
  );
}
