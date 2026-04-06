import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  GitBranch,
  GitMerge,
  Loader2,
  Pause,
  Play,
  Square,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatError } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";

import type { IntegrationBranch } from "../../types";

interface QueueModeBarProps {
  projectId: string;
}

export default function QueueModeBar({ projectId }: QueueModeBarProps) {
  const run = useAppStore((s) => s.queueMode[projectId]);
  const tasks = useAppStore((s) => s.tasks);

  const isParallel = run?.strategy === "independent" || run?.strategy === "dag";
  const isDag = run?.strategy === "dag";

  const currentItem = !isParallel ? run?.queue[run.current_index] : null;
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

  const blockedCount = useMemo(
    () => run?.queue.filter((i) => i.status === "blocked").length ?? 0,
    [run],
  );

  const pendingCount = useMemo(
    () => run?.queue.filter((i) => i.status === "pending").length ?? 0,
    [run],
  );

  const totalCount = run?.queue.length ?? 0;
  const finishedCount = completedCount + errorCount;
  const progressPercent = totalCount > 0 ? (finishedCount / totalCount) * 100 : 0;

  const hasError = isParallel ? errorCount > 0 : currentItem?.status === "error";
  const isRunning = run?.status === "running";
  const isPaused = run?.status === "paused";
  const isCompleted = run?.status === "completed";

  // ── Integration branch state ──
  const [integrationBranch, setIntegrationBranch] = useState<IntegrationBranch | null>(null);
  const [pushing, setPushing] = useState(false);

  // Fetch integration branch when run completes or has an integration branch ID
  useEffect(() => {
    if (!run?.integration_branch_id) {
      setIntegrationBranch(null);
      return;
    }
    invoke<IntegrationBranch | null>("get_integration_branch", { projectId })
      .then(setIntegrationBranch)
      .catch(() => setIntegrationBranch(null));
  }, [projectId, run?.integration_branch_id, isCompleted]);

  const handlePause = useCallback(() => {
    invoke("pause_queue_mode", { projectId }).catch((e) => {
      useAppStore.getState().flashError(`Failed to pause: ${formatError(e)}`);
    });
  }, [projectId]);

  const handleResume = useCallback(() => {
    invoke("resume_queue_mode", { projectId }).catch((e) => {
      useAppStore.getState().flashError(`Failed to resume: ${formatError(e)}`);
    });
  }, [projectId]);

  const handleStop = useCallback(() => {
    invoke("stop_queue_mode", { projectId }).catch((e) => {
      useAppStore.getState().flashError(`Failed to stop: ${formatError(e)}`);
    });
  }, [projectId]);

  const handleDismiss = useCallback(() => {
    invoke("dismiss_queue_mode", { projectId }).catch((e) => {
      useAppStore.getState().flashError(`Failed to dismiss: ${formatError(e)}`);
    });
  }, [projectId]);

  const handlePush = useCallback(async () => {
    if (!integrationBranch) return;
    setPushing(true);
    try {
      await invoke("push_integration_branch", {
        projectId,
        integrationBranchId: integrationBranch.id,
      });
      // Refresh integration branch state
      const updated = await invoke<IntegrationBranch | null>("get_integration_branch", { projectId });
      setIntegrationBranch(updated);
    } catch (e) {
      useAppStore.getState().flashError(`Failed to push: ${formatError(e)}`);
    } finally {
      setPushing(false);
    }
  }, [projectId, integrationBranch]);

  if (!run) return null;

  // ── Run completion view ──
  if (isCompleted && integrationBranch) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg bg-card ring-1 ring-border/40 px-3 py-2 mx-3 mb-2">
        {/* Top row: status + dismiss */}
        <div className="flex items-center gap-2">
          <Check size={12} className="text-success shrink-0" />
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-xs font-medium text-success shrink-0">
              Run complete
            </span>
            <span className="text-xs text-muted-foreground">—</span>
            <span className="text-xs text-dim-foreground">
              {completedCount} task{completedCount !== 1 ? "s" : ""} merged
              {errorCount > 0 && (
                <span className="text-destructive ml-1">
                  ({errorCount} failed)
                </span>
              )}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
            title="Dismiss"
          >
            <X className="size-3" />
          </Button>
        </div>

        {/* Integration branch info + actions */}
        <div className="flex items-center gap-2">
          <GitMerge size={12} className="text-primary shrink-0" />
          <span className="text-xs text-dim-foreground font-mono truncate flex-1">
            {integrationBranch.branch_name}
          </span>

          {/* Status badges */}
          {integrationBranch.pushed ? (
            <span className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium bg-success/15 text-success">
              <Check size={10} />
              Pushed
            </span>
          ) : (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium bg-accent text-dim-foreground">
              Local only
            </span>
          )}

          {integrationBranch.pr_url && (
            <a
              href={integrationBranch.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            >
              <ExternalLink size={10} />
              PR
            </a>
          )}

          {/* Push button — only when not yet pushed */}
          {!integrationBranch.pushed && (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePush}
              loading={pushing}
              className="h-6 gap-1 px-2 text-xs"
              title="Push integration branch to remote"
            >
              <Upload className="size-3" />
              Push
            </Button>
          )}
        </div>
      </div>
    );
  }

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
            <span className="text-xs font-medium text-success shrink-0">
              All {completedCount}/{totalCount} tasks completed
              {errorCount > 0 && (
                <span className="text-destructive ml-1">
                  ({errorCount} failed)
                </span>
              )}
              {blockedCount > 0 && (
                <span className="text-warning ml-1">
                  ({blockedCount} blocked)
                </span>
              )}
            </span>
          ) : isDag ? (
            <>
              <span className="text-xs font-medium tabular-nums text-foreground shrink-0">
                {completedCount}/{totalCount} done
              </span>
              {runningCount > 0 && (
                <span className="text-xs text-dim-foreground shrink-0">
                  {runningCount} running
                </span>
              )}
              {blockedCount > 0 && (
                <span className="text-xs text-warning shrink-0">
                  {blockedCount} waiting
                </span>
              )}
              {pendingCount > 0 && blockedCount === 0 && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {pendingCount} pending
                </span>
              )}
              {errorCount > 0 && (
                <span className="text-xs text-destructive shrink-0">
                  {errorCount} failed
                </span>
              )}
              {/* Integration branch indicator */}
              {integrationBranch && (
                <>
                  <span className="text-xs text-muted-foreground shrink-0">—</span>
                  <GitBranch size={11} className="text-muted-foreground shrink-0" />
                  <span className="text-2xs text-muted-foreground font-mono truncate">
                    {integrationBranch.branch_name}
                  </span>
                </>
              )}
            </>
          ) : isParallel ? (
            <>
              <span className="text-xs font-medium tabular-nums text-foreground shrink-0">
                {completedCount}/{totalCount} done
              </span>
              {runningCount > 0 && (
                <span className="text-xs text-dim-foreground shrink-0">
                  ({runningCount} running)
                </span>
              )}
              {errorCount > 0 && (
                <span className="text-xs text-destructive shrink-0">
                  ({errorCount} failed)
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-xs font-medium tabular-nums text-foreground shrink-0">
                Task {completedCount + (isRunning || isPaused ? 1 : 0)}/{totalCount}
              </span>
              {currentTask && (
                <>
                  <span className="text-xs text-muted-foreground shrink-0">
                    —
                  </span>
                  <span className="text-xs text-dim-foreground truncate">
                    {currentTask.title}
                  </span>
                  {currentItem?.agent_name && currentItem.agent_name !== run.agent_name && (
                    <span className="shrink-0 rounded px-1 py-px text-2xs font-medium bg-primary/15 text-primary">
                      {currentItem.agent_name}
                    </span>
                  )}
                </>
              )}
              {hasError && currentItem?.error && (
                <>
                  <span className="text-xs text-muted-foreground shrink-0">
                    —
                  </span>
                  <span className="text-xs text-destructive truncate">
                    {currentItem.error}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {/* Merge conflict indicator */}
        {integrationBranch?.conflict_task && (
          <div className="flex items-center gap-1 text-2xs text-warning">
            <AlertTriangle size={10} className="shrink-0" />
            <span>
              Merge conflict — resolve in worktree and retry
              {integrationBranch.conflict_files.length > 0 && (
                <span className="text-muted-foreground ml-1">
                  ({integrationBranch.conflict_files.length} file{integrationBranch.conflict_files.length !== 1 ? "s" : ""})
                </span>
              )}
            </span>
          </div>
        )}

        {/* Progress bar */}
        <div className="h-[3px] w-full rounded-full bg-border/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isCompleted
                ? errorCount > 0
                  ? "bg-warning"
                  : "bg-success"
                : hasError && !isParallel
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
            <span className="text-xs">Dismiss</span>
          </Button>
        ) : (
          <>
            {isRunning && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePause}
                className="h-6 w-6 p-0"
                title="Pause queue"
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
                title="Resume queue"
              >
                <Play className="size-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStop}
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              title="Stop queue"
            >
              <Square className="size-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
