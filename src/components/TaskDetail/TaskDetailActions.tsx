import { invoke } from "@tauri-apps/api/core";
import {
  Archive,
  Eye,
  GitPullRequest,
  Lightbulb,
  Play,
  RotateCcw,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useAppStore } from "../../store/appStore";
import LaunchResearchDialog from "../Launchers/LaunchResearchDialog";
import LaunchTaskDialog from "../Launchers/LaunchTaskDialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";

import type { Task } from "../../types";

interface TaskDetailActionsProps {
  task: Task;
  projectId: string;
}

/**
 * Status-aware action buttons for the task detail toolbar.
 *
 * | Status      | Primary            | Secondary          |
 * |-------------|--------------------|--------------------|
 * | backlog     | Start Task         | Research           |
 * | ready       | Start Task         | Research           |
 * | in-progress | View Session       | —                  |
 * | in-review   | Create PR          | —                  |
 * | done        | Archive            | Reopen             |
 * | archived    | Reopen             | —                  |
 */
export default function TaskDetailActions({
  task,
  projectId,
}: TaskDetailActionsProps) {
  const sessions = useAppStore((s) => s.sessions);
  const worktrees = useAppStore((s) => s.projectWorktrees[projectId] ?? []);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setGridLayout = useAppStore((s) => s.setGridLayout);
  const navigateToReview = useAppStore((s) => s.navigateToReview);
  const updateTask = useAppStore((s) => s.updateTask);
  const setTasks = useAppStore((s) => s.setTasks);
  const tasks = useAppStore((s) => s.tasks);

  const [showLaunchDialog, setShowLaunchDialog] = useState(false);
  const [showResearchDialog, setShowResearchDialog] = useState(false);

  // Find an active session for this task (running or starting)
  const activeSession = useMemo(
    () =>
      sessions.find(
        (s) =>
          s.task_id === task.id &&
          (s.status === "running" || s.status === "starting"),
      ),
    [sessions, task.id],
  );

  // Find the worktree for this task (via branch match)
  const taskWorktree = useMemo(
    () =>
      task.branch
        ? worktrees.find((w) => w.branch === task.branch)
        : undefined,
    [worktrees, task.branch],
  );

  // ── Handlers ──

  const handleViewSession = useCallback(() => {
    if (!activeSession) return;
    setGridLayout({ focusedPaneId: activeSession.id });
    setActiveView("sessions");
  }, [activeSession, setGridLayout, setActiveView]);

  const handleLaunched = useCallback(() => {
    setShowLaunchDialog(false);
    setActiveView("sessions");
  }, [setActiveView]);

  const handleResearchLaunched = useCallback(() => {
    setShowResearchDialog(false);
    setActiveView("sessions");
  }, [setActiveView]);

  const handleCreatePR = useCallback(() => {
    if (taskWorktree) {
      navigateToReview(taskWorktree.path);
    }
  }, [taskWorktree, navigateToReview]);

  const handleStatusChange = useCallback(
    async (newStatus: "archived" | "backlog") => {
      // Optimistic update
      const optimistic = tasks.map((t) =>
        t.id === task.id ? { ...t, status: newStatus } : t,
      );
      setTasks(optimistic as Task[]);

      try {
        const updated = await invoke<Task>("update_task_status", {
          projectId,
          taskId: task.id,
          status: newStatus,
        });
        updateTask(updated);
      } catch {
        // Revert on failure
        setTasks(tasks);
      }
    },
    [tasks, task.id, projectId, setTasks, updateTask],
  );

  // ── Render by status ──

  const status = task.status;

  return (
    <>
      {/* backlog / ready → Start Task + Research, or View Session if one is active */}
      {(status === "backlog" || status === "ready") &&
        (activeSession ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleViewSession}
            title="View Session"
            hoverEffect="scale"
            clickEffect="scale"
          >
            <Eye className="size-3.5" />
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowLaunchDialog(true)}
              title="Start Task"
              hoverEffect="scale"
              clickEffect="scale"
            >
              <Play className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowResearchDialog(true)}
              title="Research"
              hoverEffect="scale"
              clickEffect="scale"
            >
              <Lightbulb className="size-3.5" />
            </Button>
          </>
        ))}

      {/* in-progress → View Session */}
      {status === "in-progress" && activeSession && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleViewSession}
          title="View Session"
          hoverEffect="scale"
          clickEffect="scale"
        >
          <Eye className="size-3.5" />
        </Button>
      )}

      {/* in-review → Create PR (only if worktree exists) */}
      {status === "in-review" && taskWorktree && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleCreatePR}
          title="Create PR"
          hoverEffect="scale"
          clickEffect="scale"
        >
          <GitPullRequest className="size-3.5" />
        </Button>
      )}

      {/* done → Archive + Reopen */}
      {status === "done" && (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => handleStatusChange("archived")}
            title="Archive"
            hoverEffect="scale"
            clickEffect="scale"
          >
            <Archive className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => handleStatusChange("backlog")}
            title="Reopen"
            hoverEffect="scale"
            clickEffect="scale"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </>
      )}

      {/* archived → Reopen */}
      {status === "archived" && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => handleStatusChange("backlog")}
          title="Reopen"
          hoverEffect="scale"
          clickEffect="scale"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      )}

      {/* Dialogs */}
      {showLaunchDialog && (
        <LaunchTaskDialog
          task={task}
          projectId={projectId}
          onLaunched={handleLaunched}
          onDismiss={() => setShowLaunchDialog(false)}
        />
      )}

      {showResearchDialog && (
        <LaunchResearchDialog
          task={task}
          projectId={projectId}
          onLaunched={handleResearchLaunched}
          onDismiss={() => setShowResearchDialog(false)}
        />
      )}
    </>
  );
}
