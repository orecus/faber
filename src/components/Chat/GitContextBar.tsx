import { invoke } from "@tauri-apps/api/core";
import {
  GitFork,
  GitMerge,
  GitPullRequestArrow,
  Loader2,
  Upload,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import { formatErrorWithHint } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import ConfirmDialog from "../Review/ConfirmDialog";
import CreatePRDialog from "../Review/CreatePRDialog";
import MergeBranchDialog from "../Review/MergeBranchDialog";
import BranchSelect from "../ui/BranchSelect";
import CreateWorktreePopover from "./CreateWorktreePopover";

import type { WorktreeInfo } from "../../types";

// ── Constants ──

const EMPTY_WORKTREES: WorktreeInfo[] = [];

// ── Component ──

interface GitContextBarProps {
  sessionId: string;
}

export default React.memo(function GitContextBar({
  sessionId,
}: GitContextBarProps) {
  // ── Store selectors (granular, primitive where possible) ──
  const sessionTransport = useAppStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.transport ?? null,
  );
  const sessionProjectId = useAppStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.project_id ?? "",
  );
  const sessionWorktreePath = useAppStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.worktree_path ?? null,
  );
  const sessionTaskId = useAppStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.task_id ?? null,
  );
  const sessionStatus = useAppStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.status ?? "stopped",
  );

  const taskBranch = useAppStore((s) =>
    sessionTaskId
      ? (s.tasks.find((t) => t.id === sessionTaskId)?.branch ?? null)
      : null,
  );
  const taskWorktreePath = useAppStore((s) =>
    sessionTaskId
      ? (s.tasks.find((t) => t.id === sessionTaskId)?.worktree_path ?? null)
      : null,
  );
  const taskTitle = useAppStore((s) =>
    sessionTaskId
      ? (s.tasks.find((t) => t.id === sessionTaskId)?.title ?? null)
      : null,
  );
  const taskGithubIssue = useAppStore((s) =>
    sessionTaskId
      ? (s.tasks.find((t) => t.id === sessionTaskId)?.github_issue ?? null)
      : null,
  );

  const projectWorktrees = useAppStore(
    (s) => s.projectWorktrees[sessionProjectId] ?? EMPTY_WORKTREES,
  );
  const projectBranch = useAppStore(
    (s) => s.projectBranches[sessionProjectId] ?? null,
  );

  // ── Derived values ──
  const worktreePath = sessionWorktreePath ?? taskWorktreePath ?? null;
  const hasWorktree = worktreePath !== null;

  const currentBranch = useMemo(() => {
    // 1. Match worktree in projectWorktrees list
    if (worktreePath) {
      const wt = projectWorktrees.find((w) => w.path === worktreePath);
      if (wt?.branch) return wt.branch;
    }
    // 2. Task branch field
    if (taskBranch) return taskBranch;
    // 3. Project branch fallback
    return projectBranch;
  }, [worktreePath, projectWorktrees, taskBranch, projectBranch]);

  // ── Local state ──
  const [pushLoading, setPushLoading] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [showPRDialog, setShowPRDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showBranchWarn, setShowBranchWarn] = useState(false);

  // ── Handlers ──

  const refreshWorktrees = useCallback(() => {
    if (!sessionProjectId) return;
    invoke<WorktreeInfo[]>("list_worktrees", { projectId: sessionProjectId })
      .then((wts) =>
        useAppStore.getState().updateProjectWorktrees(sessionProjectId, wts),
      )
      .catch(() => {});
    useAppStore.getState().refreshProjectBranches();
  }, [sessionProjectId]);

  /** Intercept branch switch when session is running + has worktree. */
  const handleBranchSelectClick = useCallback(
    (e: React.MouseEvent) => {
      const isRunning =
        sessionStatus === "running" || sessionStatus === "starting";
      if (hasWorktree && isRunning) {
        e.stopPropagation();
        e.preventDefault();
        setShowBranchWarn(true);
      }
    },
    [hasWorktree, sessionStatus],
  );

  const handlePush = useCallback(async () => {
    if (!worktreePath || !sessionProjectId) return;
    const label = "Pushing branch";
    const store = useAppStore.getState();
    store.addBackgroundTask(label);
    setPushLoading(true);
    try {
      await invoke("push_branch", {
        projectId: sessionProjectId,
        worktreePath,
      });
    } catch (e) {
      store.flashError(formatErrorWithHint(e, "git-push"));
    } finally {
      store.removeBackgroundTask(label);
      setPushLoading(false);
    }
  }, [sessionProjectId, worktreePath]);

  const handleMergeConfirm = useCallback(
    async (targetBranch: string) => {
      if (!worktreePath || !sessionProjectId) return;
      setShowMergeDialog(false);
      const label = "Merging branch";
      const store = useAppStore.getState();
      store.addBackgroundTask(label);
      setMergeLoading(true);
      try {
        await invoke("merge_worktree_branch", {
          projectId: sessionProjectId,
          worktreePath,
          targetBranch,
        });
        refreshWorktrees();
      } catch (e) {
        store.flashError(formatErrorWithHint(e, "git-push"));
      } finally {
        store.removeBackgroundTask(label);
        setMergeLoading(false);
      }
    },
    [sessionProjectId, worktreePath, refreshWorktrees],
  );

  // ConfirmDialog handler just dismisses — user must click branch selector again
  const handleBranchWarnDismiss = useCallback(() => {
    setShowBranchWarn(false);
  }, []);

  // ── Guards ──
  if (sessionTransport !== "acp") return null;
  if (!sessionProjectId) return null;

  // ── Render ──
  return (
    <>
      <div className="flex items-center gap-1 px-3 py-1 border-t border-border/30 shrink-0 h-7">
        {/* Left: Branch context */}
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {/* Worktree indicator */}
          {hasWorktree && (
            <span title="Worktree">
              <GitFork
                size={10}
                className="text-muted-foreground/60 shrink-0"
              />
            </span>
          )}

          {/* Branch selector */}
          <div onClickCapture={handleBranchSelectClick}>
            <BranchSelect
              projectId={sessionProjectId}
              currentBranch={currentBranch}
              mode="checkout"
              triggerVariant="badge"
              triggerClassName="h-5 text-2xs py-0 px-1.5 border-0 bg-transparent hover:bg-accent/50"
              onBranchChanged={refreshWorktrees}
              dropUp
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Create Worktree — only when no worktree */}
          {!hasWorktree && (
            <CreateWorktreePopover
              projectId={sessionProjectId}
              onCreated={refreshWorktrees}
            />
          )}

          {/* Push */}
          <button
            onClick={handlePush}
            disabled={!worktreePath || pushLoading}
            className="flex items-center gap-1 h-5 px-1.5 rounded text-2xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            title={worktreePath ? "Push branch" : "Create a worktree first"}
          >
            {pushLoading ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Upload size={10} />
            )}
            <span>Push</span>
          </button>

          {/* Separator */}
          <div className="w-px h-3 bg-border/40 mx-1" />

          {/* Create PR */}
          <button
            onClick={() => setShowPRDialog(true)}
            disabled={!worktreePath}
            className="flex items-center gap-1 h-5 px-1.5 rounded text-2xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
            title={
              worktreePath ? "Create pull request" : "Create a worktree first"
            }
          >
            <GitPullRequestArrow size={10} />
            <span>PR</span>
          </button>

          {/* Merge — only with worktree */}
          {hasWorktree && (
            <button
              onClick={() => setShowMergeDialog(true)}
              disabled={mergeLoading}
              className="flex items-center gap-1 h-5 px-1.5 rounded text-2xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              title="Merge branch"
            >
              {mergeLoading ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <GitMerge size={10} />
              )}
              <span>Merge</span>
            </button>
          )}
        </div>
      </div>

      {/* Dialogs — mounted conditionally outside the strip */}
      {showPRDialog && worktreePath && (
        <CreatePRDialog
          worktreePath={worktreePath}
          defaultTitle={taskTitle ?? ""}
          githubIssue={taskGithubIssue}
          taskId={sessionTaskId}
          projectId={sessionProjectId}
          onDismiss={() => setShowPRDialog(false)}
        />
      )}

      {showMergeDialog && currentBranch && (
        <MergeBranchDialog
          projectId={sessionProjectId}
          sourceBranch={currentBranch}
          onConfirm={handleMergeConfirm}
          onCancel={() => setShowMergeDialog(false)}
        />
      )}

      {showBranchWarn && (
        <ConfirmDialog
          title="Switch branch?"
          message="A session is currently running in this worktree. Switching branches may cause unexpected behavior for the active agent."
          variant="default"
          confirmLabel="I understand"
          onConfirm={handleBranchWarnDismiss}
          onCancel={handleBranchWarnDismiss}
        />
      )}
    </>
  );
});
