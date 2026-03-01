import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitCompareArrows } from "lucide-react";
import { useTheme } from "../../contexts/ThemeContext";
import { useAppStore } from "../../store/appStore";
import { ViewLayout } from "../Shell/ViewLayout";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";
import { useDiffData } from "./useDiffData";
import ReviewToolbar, { type DiffOutputFormat } from "./ReviewToolbar";
import FileList from "./FileList";
import ReviewPanel from "./ReviewPanel";
import CreatePRDialog from "./CreatePRDialog";
import ConfirmDialog from "./ConfirmDialog";
import type { WorktreeInfo } from "../../types";

export default function ReviewView() {
  const { isGlass } = useTheme();
  const reviewWorktreePath = useAppStore(
    (s) => s.reviewWorktreePath,
  );
  const worktrees = useAppStore((s) => s.worktrees);
  const tasks = useAppStore((s) => s.tasks);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const updateProjectWorktrees = useAppStore((s) => s.updateProjectWorktrees);
  const setReviewWorktreePath = useAppStore(
    (s) => s.setReviewWorktreePath,
  );

  const [outputFormat, setOutputFormat] =
    useState<DiffOutputFormat>("side-by-side");
  const [showPRDialog, setShowPRDialog] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    variant: "danger" | "default";
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const {
    committedFiles,
    changedFiles,
    selectedFile,
    rawDiff,
    loading,
    error,
    selectFile,
    refresh,
    toggleStageFile,
  } = useDiffData(reviewWorktreePath, activeProjectId);

  const totalFileCount = committedFiles.length + changedFiles.length;

  // Find branch name from worktrees
  const worktree = worktrees.find(
    (w) => w.path === reviewWorktreePath,
  );
  const branchName = worktree?.branch ?? null;

  // Find associated task (task with matching worktree_path)
  const associatedTask = tasks.find(
    (t) => t.worktree_path === reviewWorktreePath,
  );

  // Check PR merge status on refresh (best-effort)
  const handleRefresh = useCallback(async () => {
    refresh();
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
  }, [refresh, associatedTask, activeProjectId]);

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
    setActiveView("dashboard");
  }, [setActiveView]);

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
    setConfirmAction({
      title: "Merge into main",
      message: `Merge branch "${branchName}" into the current branch of the main repository? This is a local operation.`,
      variant: "default",
      onConfirm: async () => {
        setMerging(true);
        setFeedback(null);
        const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
        addBackgroundTask("Merging branch");
        try {
          await invoke<string>("merge_worktree_branch", {
            projectId: activeProjectId,
            worktreePath: reviewWorktreePath,
          });
          showFeedback("success", `Merged ${branchName} into main`);
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
    });
  }, [
    reviewWorktreePath,
    activeProjectId,
    merging,
    branchName,
    showFeedback,
  ]);

  const handleDelete = useCallback(() => {
    if (!reviewWorktreePath || !activeProjectId) return;
    setConfirmAction({
      title: "Delete worktree",
      message: `Permanently delete worktree "${branchName ?? reviewWorktreePath}"? This removes the worktree directory. The branch will remain.`,
      variant: "danger",
      onConfirm: async () => {
        setFeedback(null);
        const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
        addBackgroundTask("Deleting worktree");
        try {
          await invoke("delete_worktree", {
            projectId: activeProjectId,
            worktreePath: reviewWorktreePath,
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
      {/* Transparent header with toolbar controls */}
      <ReviewToolbar
        branchName={branchName}
        fileCount={totalFileCount}
        committedFileCount={committedFiles.length}
        outputFormat={outputFormat}
        onOutputFormatChange={setOutputFormat}
        onRefresh={handleRefresh}
        onBack={handleBack}
        onCreatePR={() => setShowPRDialog(true)}
        onPush={handlePush}
        onMerge={handleMerge}
        onDelete={handleDelete}
        pushing={pushing}
        merging={merging}
        loading={loading}
      />

      {/* Content card */}
      <div className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 flex flex-col ${glassStyles[isGlass ? "normal" : "solid"]}`}>
        {/* Feedback message */}
        {feedback && (
          <div
            className={`flex items-center justify-between px-3 py-1.5 text-xs shrink-0 ${
              feedback.type === "success"
                ? "bg-[color-mix(in_oklch,var(--success)_10%,transparent)] text-success"
                : "bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)] text-destructive"
            }`}
          >
            <span>{feedback.text}</span>
            <button
              onClick={() => setFeedback(null)}
              className="ml-2 opacity-60 hover:opacity-100"
            >
              dismiss
            </button>
          </div>
        )}

        {/* Main content: file list + diff panel */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          <FileList
            committedFiles={committedFiles}
            changedFiles={changedFiles}
            selectedFile={selectedFile}
            worktreePath={reviewWorktreePath}
            projectId={activeProjectId ?? ""}
            onSelectFile={selectFile}
            onToggleStage={toggleStageFile}
            onRefresh={refresh}
          />
          <ReviewPanel
            rawDiff={rawDiff}
            outputFormat={outputFormat}
            loading={loading}
            error={error}
          />
        </div>
      </div>

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
        />
      )}
    </ViewLayout>
  );
}
