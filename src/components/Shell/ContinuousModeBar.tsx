import { invoke } from "@tauri-apps/api/core";
import { Loader2, Pause, Play, Square } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface ContinuousModeBarProps {
  projectId: string;
}

export default function ContinuousModeBar({ projectId }: ContinuousModeBarProps) {
  const run = useAppStore((s) => s.continuousMode[projectId]);
  const tasks = useAppStore((s) => s.tasks);

  const currentItem = run?.queue[run.current_index];
  const currentTask = useMemo(
    () =>
      currentItem
        ? tasks.find((t) => t.id === currentItem.task_id)
        : null,
    [currentItem, tasks],
  );

  const completedCount = useMemo(
    () => run?.queue.filter((i) => i.status === "completed").length ?? 0,
    [run],
  );

  const totalCount = run?.queue.length ?? 0;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const hasError = currentItem?.status === "error";
  const isRunning = run?.status === "running";
  const isPaused = run?.status === "paused";

  const handlePause = useCallback(() => {
    invoke("pause_continuous_mode", { projectId }).catch(() => {});
  }, [projectId]);

  const handleResume = useCallback(() => {
    invoke("resume_continuous_mode", { projectId }).catch(() => {});
  }, [projectId]);

  const handleStop = useCallback(() => {
    invoke("stop_continuous_mode", { projectId }).catch(() => {});
  }, [projectId]);

  if (!run) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg bg-card ring-1 ring-border/40 px-3 py-1.5 mx-3 mb-2">
      {/* Status dot */}
      <span
        className={`size-2 shrink-0 rounded-full ${
          hasError
            ? "bg-destructive"
            : isPaused
              ? "bg-warning"
              : "bg-success"
        }`}
      />

      {/* Spinner for running state */}
      {isRunning && !hasError && (
        <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0" />
      )}

      {/* Progress info */}
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium tabular-nums text-foreground shrink-0">
            Task {completedCount + (isRunning || isPaused ? 1 : 0)}/{totalCount}
          </span>
          {currentTask && (
            <>
              <span className="text-[11px] text-muted-foreground shrink-0">
                —
              </span>
              <span className="text-[11px] text-dim-foreground truncate">
                {currentTask.title}
              </span>
            </>
          )}
          {hasError && currentItem?.error && (
            <>
              <span className="text-[11px] text-muted-foreground shrink-0">
                —
              </span>
              <span className="text-[11px] text-destructive truncate">
                {currentItem.error}
              </span>
            </>
          )}
        </div>

        {/* Progress bar */}
        <div className="h-[3px] w-full rounded-full bg-border/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              hasError
                ? "bg-destructive"
                : isPaused
                  ? "bg-warning"
                  : "bg-success"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        {isRunning && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePause}
            className="h-6 w-6 p-0"
            title="Pause continuous mode"
          >
            <Pause className="size-3" />
          </Button>
        )}
        {isPaused && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResume}
            className="h-6 w-6 p-0"
            title="Resume continuous mode"
          >
            <Play className="size-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleStop}
          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
          title="Stop continuous mode"
        >
          <Square className="size-3" />
        </Button>
      </div>
    </div>
  );
}
