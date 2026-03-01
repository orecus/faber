import { memo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Columns2,
  Grid2x2,
  LayoutGrid,
  type LucideIcon,
  Maximize,
  Plus,
  Rows2,
  TerminalSquare,
} from "lucide-react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import { ViewLayout } from "../Shell/ViewLayout";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { Tabs } from "../ui/orecus.io/navigation/tabs";

import type { GridLayoutState } from "../../store/appStore";

interface SessionsToolbarProps {
  layout: GridLayoutState;
  onLayoutChange: (update: Partial<GridLayoutState>) => void;

  activeProjectId: string | null;
  onNewSession: () => void;
}

const MODES: {
  id: GridLayoutState["mode"];
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "auto", label: "Auto", icon: LayoutGrid },
  { id: "1-up", label: "Focus", icon: Maximize },
  { id: "2-up", label: "Split H", icon: Columns2 },
  { id: "2-up-v", label: "Split V", icon: Rows2 },
  { id: "4-up", label: "Quad", icon: Grid2x2 },
];

const SessionsToolbar = memo(function SessionsToolbar({
  layout,
  onLayoutChange,
  activeProjectId,
  onNewSession,
}: SessionsToolbarProps) {
  const accentColor = useProjectAccentColor();
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

  const handleStartTerminal = useCallback(() => {
    if (!activeProjectId) return;
    const label = "Starting terminal";
    addBackgroundTask(label);
    invoke("start_shell_session", { projectId: activeProjectId })
      .catch((err) => {
        console.error("[sessions] Failed to start shell session:", err);
      })
      .finally(() => removeBackgroundTask(label));
  }, [activeProjectId, addBackgroundTask, removeBackgroundTask]);

  return (
    <ViewLayout.Toolbar>
      <span className="text-[13px] font-medium text-foreground mr-1">
        Sessions
      </span>

      {/* Layout mode selector */}
      <Tabs
        value={layout.mode}
        onChange={(v) =>
          onLayoutChange({
            mode: v as GridLayoutState["mode"],
            maximizedPaneId: null,
          })
        }
        animation="slide"
        variant="none"
        indicatorVariant="color"
        size="sm"
        color={accentColor}
        align="start"
        barRadius="md"
        tabRadius="md"
      >
        {MODES.map((m) => {
          const Icon = m.icon;
          return (
            <Tabs.Tab key={m.id} value={m.id} icon={<Icon size={12} />}>
              {m.label}
            </Tabs.Tab>
          );
        })}
      </Tabs>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <Button
        variant="color"
        color={accentColor}
        size="sm"
        disabled={!activeProjectId}
        onClick={onNewSession}
        leftIcon={<Plus className="size-3" />}
        hoverEffect="scale-glow"
        clickEffect="scale"
      >
        New Agent
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!activeProjectId}
        onClick={handleStartTerminal}
        leftIcon={<TerminalSquare className="size-3" />}
        hoverEffect="scale"
        clickEffect="scale"
      >
        Terminal
      </Button>
    </ViewLayout.Toolbar>
  );
});

export default SessionsToolbar;
