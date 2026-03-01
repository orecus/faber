import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles, TerminalSquare } from "lucide-react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface SessionsEmptyStateProps {
  activeProjectId: string | null;
  onNewAgent: () => void;
}

export default function SessionsEmptyState({
  activeProjectId,
  onNewAgent,
}: SessionsEmptyStateProps) {
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
    <div className="flex items-center justify-center flex-1 min-h-0">
      <div className="text-center max-w-80">
        <div className="mb-3 text-muted-foreground flex justify-center">
          <TerminalSquare size={32} />
        </div>
        <div className="text-base text-foreground mb-1.5">
          No active sessions
        </div>
        <div className="text-[13px] text-muted-foreground leading-normal mb-4">
          Start an agent session or open a plain terminal to get started.
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="color"
            color={accentColor}
            size="sm"
            leftIcon={<Sparkles size={14} />}
            onClick={onNewAgent}
            disabled={!activeProjectId}
            hoverEffect="scale-glow"
            clickEffect="scale"
          >
            Start Agent
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<TerminalSquare size={14} />}
            onClick={handleStartTerminal}
            disabled={!activeProjectId}
          >
            Start Terminal
          </Button>
        </div>
      </div>
    </div>
  );
}
