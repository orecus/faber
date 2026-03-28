import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardList, Lightbulb, Sparkles, TerminalSquare, Wand2 } from "lucide-react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { formatError } from "../../lib/errorMessages";
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
        useAppStore.getState().flashError(`Failed to start terminal: ${formatError(err)}`);
      })
      .finally(() => removeBackgroundTask(label));
  }, [activeProjectId, addBackgroundTask, removeBackgroundTask]);

  return (
    <div className="flex items-center justify-center flex-1 min-h-0">
      <div className="text-center max-w-96">
        <div className="mb-3 text-muted-foreground opacity-30 flex justify-center">
          <TerminalSquare size={32} />
        </div>
        <div className="text-base text-foreground mb-1.5">
          No active sessions
        </div>
        <div className="text-sm text-muted-foreground leading-normal mb-4">
          Start a vibe session or terminal here, or launch task sessions from the dashboard.
        </div>
        <div className="flex items-center justify-center gap-2 mb-6">
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

        {/* Session mode hints */}
        <div className="grid grid-cols-3 gap-3 text-left">
          <div className="flex flex-col gap-1">
            <Wand2 className="size-3.5 text-muted-foreground opacity-60" />
            <span className="text-xs font-medium text-dim-foreground">Vibe</span>
            <span className="text-2xs text-muted-foreground leading-relaxed">Freeform coding directly on the current branch</span>
          </div>
          <div className="flex flex-col gap-1">
            <ClipboardList className="size-3.5 text-muted-foreground opacity-60" />
            <span className="text-xs font-medium text-dim-foreground">Task</span>
            <span className="text-2xs text-muted-foreground leading-relaxed">Started from a task in the dashboard with its own worktree</span>
          </div>
          <div className="flex flex-col gap-1">
            <Lightbulb className="size-3.5 text-muted-foreground opacity-60" />
            <span className="text-xs font-medium text-dim-foreground">Research</span>
            <span className="text-2xs text-muted-foreground leading-relaxed">Started from a task to explore and plan without changes</span>
          </div>
        </div>
      </div>
    </div>
  );
}
