import { invoke } from "@tauri-apps/api/core";
import { Check, Loader2, Pause, Play, Square, X } from "lucide-react";
import { useCallback, useMemo } from "react";

import { formatError } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface ContinuousModeBarProps {
  projectId: string;
}

export default function ContinuousModeBar({ projectId }: ContinuousModeBarProps) {
  const run = useAppStore((s) => s.continuousMode[projectId]);
  const tasks = useAppStore((s) => s.tasks);

  const isIndependent = run?.strategy === "independent";

  const currentItem = !isIndependent ? run?.queue[run.current_index] : null;
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

  const errorCount = useMemo(
    () => run?.queue.filter((i) => i.status === "error").length ?? 0,
    [run],
  );

  const runningCount = useMemo(
    () => run?.queue.filter((i) => i.status === "running").length ?? 0,
    [run],
  );

  const totalCount = run?.queue.length ?? 0;
  const finishedCount = completedCount + errorCount;
  const progressPercent = totalCount > 0 ? (finishedCount / totalCount) * 100 : 0;

  const hasError = isIndependent ? errorCount > 0 : currentItem?.status === "error";
  const isRunning = run?.status === "running";
  const isPaused = run?.status === "paused";
  const isCompleted = run?.status === "completed";

  const handlePause = useCallback(() => {
    invoke("pause_continuous_mode", { projectId }).catch((e) => {
      useAppStore.getState().flashError(`Failed to pause: ${formatError(e)}`);
    });
  }, [projectId]);

  const handleResume = useCallback(() => {
    invoke("resume_continuous_mode", { projectId }).catch((e) => {
      useAppStore.getState().flashError(`Failed to resume: ${formatError(e)}`);
    });
  }, [projectId]);

  const handleStop = useCallback(() => {
    invoke("stop_continuous_mode", { projectId }).catch((e) => {
      useAppStore.getState().flashError(`Failed to stop: ${formatError(e)}`);
    });
  }, [projectId]);

  const handleDismiss = useCallback(() => {
    invoke("dismiss_continuous_mode", { projectId }).catch((e) => {
      useAppStore.getState().flashError(`Failed to dismiss: ${formatError(e)}`);
    });
  }, [projectId]);

  if (!run) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg bg-card ring-1 ring-border/40 px-3 py-1.5 mx-3 mb-2">
      {/* Status dot / check icon */}
      {isCompleted ? (
        <Check size={12} className="text-success shrink-0" />
      ) : (
        <span
          className={`size-2 shrink-0 rounded-full ${
            hasError
              ? "bg-destructive"
              : isPaused
                ? "bg-warning"
                : "bg-success"
          }`}
        />
      )}

      {/* Spinner for running state */}
      {isRunning && !hasError && (
        <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0" />
      )}

      {/* Progress info */}
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <div className="flex items-center gap-1.5">
          {isCompleted ? (
            <span className="text-[11px] font-medium text-success shrink-0">
              All {completedCount}/{totalCount} tasks completed
              {errorCount > 0 && (
                <span className="text-destructive ml-1">
                  ({errorCount} failed)
                </span>
              )}
            </span>
          ) : isIndependent ? (
            <>
              <span className="text-[11px] font-medium tabular-nums text-foreground shrink-0">
                {completedCount}/{totalCount} done
              </span>
              {runningCount > 0 && (
                <span className="text-[11px] text-dim-foreground shrink-0">
                  ({runningCount} running)
                </span>
              )}
              {errorCount > 0 && (
                <span className="text-[11px] text-destructive shrink-0">
                  ({errorCount} failed)
                </span>
              )}
            </>
          ) : (
            <>
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
                  {currentItem?.agent_name && currentItem.agent_name !== run.agent_name && (
                    <span className="shrink-0 rounded px-1 py-px text-[10px] font-medium bg-primary/15 text-primary">
                      {currentItem.agent_name}
                    </span>
                  )}
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
            </>
          )}
        </div>

        {/* Progress bar */}
        <div className="h-[3px] w-full rounded-full bg-border/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isCompleted
                ? errorCount > 0
                  ? "bg-warning"
                  : "bg-success"
                : hasError && !isIndependent
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
        {isCompleted ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="h-6 gap-1 px-2 text-muted-foreground hover:text-foreground"
            title="Dismiss and close all related sessions"
          >
            <X className="size-3" />
            <span className="text-[11px]">Dismiss</span>
          </Button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
