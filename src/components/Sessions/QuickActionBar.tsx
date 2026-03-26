import { invoke } from "@tauri-apps/api/core";
import {
  Bug,
  GitCommit,
  type LucideIcon,
  Send,
  Sparkles,
} from "lucide-react";
import React, { useCallback, useMemo } from "react";

import { useAppStore } from "../../store/appStore";

import type { PromptTemplate } from "../../types";

// ── Icon mapping ──

const ICON_MAP: Record<string, LucideIcon> = {
  "git-commit": GitCommit,
  bug: Bug,
  sparkles: Sparkles,
  send: Send,
};

function getIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? Send;
}

// ── Component ──

interface QuickActionBarProps {
  sessionId: string;
  sessionStatus: string;
  sessionMode: string;
}

export default React.memo(function QuickActionBar({
  sessionId,
  sessionStatus,
  sessionMode,
}: QuickActionBarProps) {
  const promptTemplates = useAppStore((s) => s.promptTemplates);

  // Filter to quick_action templates only
  const actions = useMemo(() => {
    return promptTemplates
      .filter((t) => t.quick_action && t.category === "action")
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [promptTemplates]);

  const handleAction = useCallback(
    async (template: PromptTemplate) => {
      try {
        await invoke("write_pty", {
          sessionId,
          data: template.prompt + "\n",
        });
      } catch (e) {
        console.error("Failed to send quick action:", e);
      }
    },
    [sessionId],
  );

  // Only show for active agent sessions (not shell, not ended)
  const isActive = sessionStatus === "running" || sessionStatus === "starting";
  const isAgent = sessionMode !== "shell";
  if (!isActive || !isAgent || actions.length === 0) return null;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[5] flex items-center gap-1 px-1.5 py-1 rounded-lg bg-popover/80 backdrop-blur-sm ring-1 ring-border/30 shadow-lg opacity-0 group-hover/pane:opacity-100 group-focus-within/pane:opacity-100 transition-opacity duration-200 pointer-events-none group-hover/pane:pointer-events-auto group-focus-within/pane:pointer-events-auto">
      {actions.map((action) => {
        const Icon = getIcon(action.icon);
        return (
          <button
            key={action.id}
            onClick={(e) => {
              e.stopPropagation();
              handleAction(action);
            }}
            title={action.prompt}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors duration-150 cursor-pointer"
          >
            <Icon size={13} />
            <span className="text-[11px] leading-none whitespace-nowrap">
              {action.label}
            </span>
          </button>
        );
      })}
    </div>
  );
});
