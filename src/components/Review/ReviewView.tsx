import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch, GitCompareArrows } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { ViewLayout } from "../Shell/ViewLayout";
import DiffView from "./DiffView";
import CreatePRDialog from "./CreatePRDialog";
import ConfirmDialog from "./ConfirmDialog";
import MergeBranchDialog from "./MergeBranchDialog";
import type { WorktreeInfo } from "../../types";

export default function ReviewView() {
  const reviewWorktreePath = useAppStore(
    (s) => s.reviewWorktreePath,
  );
  const worktrees = useAppStore((s) => s.worktrees);
  const tasks = useAppStore((s) => s.tasks);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const previousView = useAppStore((s) => s.previousView);
  const updateProjectWorktrees = useAppStore((s) => s.updateProjectWorktrees);
  const setReviewWorktreePath = useAppStore(
    (s) => s.setReviewWorktreePath,
  );

  const [showPRDialog, setShowPRDialog] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    variant: "danger" | "default";
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [hasRemote, setHasRemote] = useState(true);
  const [isMerged, setIsMerged] = useState(false);
  const [deleteBranchToo, setDeleteBranchToo] = useState(false);
  const deleteBranchRef = useRef(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Find branch name from worktrees
  const worktree = worktrees.find(
    (w) => w.path === reviewWorktreePath,
  );
  const branchName = worktree?.branch ?? null;

  // Find associated task (task with matching worktree_path)
  const associatedTask = tasks.find(
    (t) => t.worktree_path === reviewWorktreePath,
  );

  // Detect remote availability and branch merge status
  const checkRepoStatus = useCallback(async () => {
    if (!activeProjectId || !reviewWorktreePath || !branchName) return;
    try {
      const [remote, projectBranch] = await Promise.all([
        invoke<boolean>("has_remote", { projectId: activeProjectId }),
        invoke<string>("get_project_branch", { projectId: activeProjectId }),
      ]);
      setHasRemote(remote);

      // Check if the worktree branch has been merged into the project's current branch
      try {
        const merged = await invoke<boolean>("is_branch_merged", {
          projectId: activeProjectId,
          worktreePath: reviewWorktreePath,
          targetBranch: projectBranch,
        });
        setIsMerged(merged);
      } catch {
        setIsMerged(false);
      }
    } catch {
      // Non-fatal — default to optimistic values
    }
  }, [activeProjectId, reviewWorktreePath, branchName]);

  useEffect(() => {
    setIsMerged(false);
    setHasRemote(true);
    checkRepoStatus();
  }, [checkRepoStatus]);

  const handleRefreshExtra = useCallback(async () => {
    checkRepoStatus();
    if (associatedTask?.github_pr && activeProjectId) {
      try {
        await invoke("check_pr_merged", {
          projectId: activeProjectId,
          taskId: associatedTask.id,
        });
      } catch {
        // Non-fatal
      }
    }
  }, [checkRepoStatus, associatedTask, activeProjectId]);

  const showFeedback = useCallback(
    (type: "success" | "error", text: string) => {
      setFeedback({ type, text });
      if (type === "success") {
        setTimeout(() => setFeedback(null), 4000);
      }
    },
    [],
  );

  const refreshWorktrees = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const wts = await invoke<WorktreeInfo[]>("list_worktrees", {
        projectId: activeProjectId,
      });
      updateProjectWorktrees(activeProjectId, wts);
    } catch {
      // ignore
    }
  }, [activeProjectId, updateProjectWorktrees]);

  const handleBack = useCallback(() => {
    // Navigate back to where the user came from, defaulting to dashboard
    setActiveView(previousView ?? "dashboard");
  }, [setActiveView, previousView]);

  const handlePush = useCallback(async () => {
    if (!reviewWorktreePath || pushing) return;
    setPushing(true);
    setFeedback(null);
    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Pushing branch");
    try {
      const branch = await invoke<string>("push_branch", {
        projectId: activeProjectId,
        worktreePath: reviewWorktreePath,
      });
      showFeedback("success", `Pushed ${branch} to origin`);
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
      removeBackgroundTask("Pushing branch");
    }
  }, [reviewWorktreePath, pushing, showFeedback]);

  const handleMerge = useCallback(() => {
    if (!reviewWorktreePath || !activeProjectId || merging) return;
    setShowMergeDialog(true);
  }, [reviewWorktreePath, activeProjectId, merging]);

  const handleMergeConfirm = useCallback(
    async (targetBranch: string) => {
      if (!reviewWorktreePath || !activeProjectId) return;
      setShowMergeDialog(false);
      setMerging(true);
      setFeedback(null);
      const { addBackgroundTask, removeBackgroundTask } =
        useAppStore.getState();
      addBackgroundTask("Merging branch");
      try {
        await invoke<string>("merge_worktree_branch", {
          projectId: activeProjectId,
          worktreePath: reviewWorktreePath,
          targetBranch,
        });
        showFeedback(
          "success",
          `Merged ${branchName} into ${targetBranch}`,
        );
        setIsMerged(true);
      } catch (err) {
        showFeedback(
          "error",
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        setMerging(false);
        removeBackgroundTask("Merging branch");
      }
    },
    [reviewWorktreePath, activeProjectId, branchName, showFeedback],
  );

  const handleDelete = useCallback(() => {
    if (!reviewWorktreePath || !activeProjectId) return;
    setDeleteBranchToo(false);
    deleteBranchRef.current = false;
    setConfirmAction({
      title: "Delete worktree",
      message: `Permanently delete worktree "${branchName ?? reviewWorktreePath}"? This removes the worktree directory.`,
      variant: "danger",
      onConfirm: async () => {
        setFeedback(null);
        const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
        const shouldDeleteBranch = deleteBranchRef.current;
        addBackgroundTask("Deleting worktree");
        try {
          await invoke("delete_worktree", {
            projectId: activeProjectId,
            worktreePath: reviewWorktreePath,
            deleteBranch: shouldDeleteBranch,
          });
          setReviewWorktreePath(null);
          setActiveView("dashboard");
          await refreshWorktrees();
        } catch (err) {
          showFeedback(
            "error",
            err instanceof Error ? err.message : String(err),
          );
        } finally {
          removeBackgroundTask("Deleting worktree");
        }
      },
    });
  }, [
    reviewWorktreePath,
    activeProjectId,
    branchName,
    setReviewWorktreePath,
    setActiveView,
    refreshWorktrees,
    showFeedback,
  ]);

  // Empty state when no worktree is selected
  if (!reviewWorktreePath) {
    return (
      <div
        className="flex flex-col items-center justify-center text-muted-foreground"
        style={{ gridArea: "content" }}
      >
        <GitCompareArrows className="mb-3 size-10 opacity-30" />
        <p className="text-sm">Select a worktree to review changes</p>
        <p className="mt-1 text-xs opacity-60">
          Click a worktree in the sidebar to get started
        </p>
      </div>
    );
  }

  return (
    <ViewLayout>
      <DiffView
        path={reviewWorktreePath}
        projectId={activeProjectId}
        variant="standalone"
        branchName={branchName}
        onBack={handleBack}
        onCreatePR={() => setShowPRDialog(true)}
        onPush={handlePush}
        onMerge={handleMerge}
        onDelete={handleDelete}
        pushing={pushing}
        merging={merging}
        hasRemote={hasRemote}
        isMerged={isMerged}
        onRefreshExtra={handleRefreshExtra}
        feedback={feedback}
        onDismissFeedback={() => setFeedback(null)}
      />

      {/* PR creation dialog */}
      {showPRDialog && (
        <CreatePRDialog
          worktreePath={reviewWorktreePath}
          defaultTitle={associatedTask?.title ?? branchName ?? ""}
          githubIssue={associatedTask?.github_issue ?? null}
          taskId={associatedTask?.id ?? null}
          projectId={activeProjectId ?? null}
          onDismiss={() => setShowPRDialog(false)}
        />
      )}

      {/* Merge branch dialog */}
      {showMergeDialog && activeProjectId && branchName && (
        <MergeBranchDialog
          projectId={activeProjectId}
          sourceBranch={branchName}
          onConfirm={handleMergeConfirm}
          onCancel={() => setShowMergeDialog(false)}
        />
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          variant={confirmAction.variant}
          onConfirm={async () => {
            const action = confirmAction;
            setConfirmAction(null);
            await action.onConfirm();
          }}
          onCancel={() => setConfirmAction(null)}
        >
          {confirmAction.title === "Delete worktree" && branchName && (
            <label className="flex items-center gap-2 mt-1 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={deleteBranchToo}
                onChange={(e) => {
                  setDeleteBranchToo(e.target.checked);
                  deleteBranchRef.current = e.target.checked;
                }}
                className="sr-only peer"
              />
              <div className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs transition-colors peer-checked:bg-destructive peer-checked:border-destructive peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50">
                {deleteBranchToo && (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="size-3 text-white">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span className="flex items-center gap-1.5 text-xs text-dim-foreground group-hover:text-foreground transition-colors">
                <GitBranch className="size-3" />
                Also delete branch "{branchName}"
              </span>
            </label>
          )}
        </ConfirmDialog>
      )}
    </ViewLayout>
  );
}
