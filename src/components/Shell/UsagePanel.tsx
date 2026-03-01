import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import React, { useCallback } from "react";

import { usePersistedBoolean } from "../../hooks/usePersistedState";
import { AgentIcon } from "../../lib/agentIcons";
import { useAppStore } from "../../store/appStore";
import UsageProgressBar from "./UsageProgressBar";

import type { AgentUsageData } from "../../types";

/** Single agent usage section within the panel. */
const AgentUsageSection = React.memo(function AgentUsageSection({
  agent,
}: {
  agent: AgentUsageData;
}) {
  if (agent.needs_auth) {
    return (
      <div className="px-3 py-1">
        <div className="flex items-center gap-1.5 text-[11px] text-dim-foreground mb-1">
          <AgentIcon agent={agent.agent_name} size={13} className="shrink-0 opacity-80" />
          <span className="truncate">{agent.display_name}</span>
        </div>
        <div className="px-3 text-[10px] text-muted-foreground">
          Run <code className="px-1 py-px rounded bg-accent/60 text-[10px]">claude</code> to
          authenticate
        </div>
      </div>
    );
  }

  if (agent.error) {
    return (
      <div className="px-3 py-1">
        <div className="flex items-center gap-1.5 text-[11px] text-dim-foreground mb-1">
          <AgentIcon agent={agent.agent_name} size={13} className="shrink-0 opacity-80" />
          <span className="truncate">{agent.display_name}</span>
        </div>
        <div className="flex items-center gap-1 px-3 text-[10px] text-destructive">
          <AlertTriangle size={10} className="shrink-0" />
          <span className="truncate">{agent.error}</span>
        </div>
      </div>
    );
  }

  if (agent.windows.length === 0) return null;

  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 px-3 text-[11px] text-dim-foreground mb-0.5">
        <AgentIcon agent={agent.agent_name} size={13} className="shrink-0 opacity-80" />
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

const UsagePanel = React.memo(function UsagePanel() {
  const agentUsage = useAppStore((s) => s.agentUsage);
  const agentUsageLoading = useAppStore((s) => s.agentUsageLoading);
  const fetchAgentUsage = useAppStore((s) => s.fetchAgentUsage);
  const [collapsed, setCollapsed] = usePersistedBoolean("usage_panel_collapsed", true);

  const handleRefresh = useCallback(() => {
    fetchAgentUsage();
  }, [fetchAgentUsage]);

  const handleToggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  // Don't render the panel at all if there's no usage data
  if (agentUsage.length === 0 && !agentUsageLoading) return null;

  return (
    <div className="shrink-0 border-t border-border">
      {/* Header */}
      <div
        onClick={handleToggle}
        className="group/usage flex items-center gap-2 px-3 h-7 text-[11px] text-dim-foreground cursor-pointer hover:bg-accent/40 select-none"
      >
        <span className="inline-flex w-4 justify-center shrink-0">
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
        <span className="flex-1 min-w-0 truncate">Usage</span>
        {agentUsageLoading ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <RefreshCw
            size={11}
            onClick={(e) => {
              e.stopPropagation();
              handleRefresh();
            }}
            className="shrink-0 opacity-0 group-hover/usage:opacity-100 transition-opacity text-muted-foreground hover:text-foreground cursor-pointer"
          />
        )}
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="pb-1.5">
          {agentUsage.map((agent) => (
            <AgentUsageSection key={agent.agent_name} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
});

export default UsagePanel;
