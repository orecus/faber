import { useCallback, useState } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";

import DiffToolbar, { type DiffOutputFormat } from "./DiffToolbar";
import FileList from "./FileList";
import ReviewPanel from "./ReviewPanel";
import { useDiffData } from "./useDiffData";

interface DiffViewFeedback {
  type: "success" | "error";
  text: string;
}

interface DiffViewProps {
  /** Path to diff against — project root or worktree path */
  path: string | null;
  projectId: string | null;
  /**
   * "standalone" = full view with ViewLayout.Toolbar + glass content card.
   * "embedded"   = compact inline toolbar, no wrapping card (for use inside a parent card).
   */
  variant: "standalone" | "embedded";

  // Optional toolbar props — provide callbacks to show action buttons
  branchName?: string | null;
  onBack?: () => void;
  onCreatePR?: () => void;
  onPush?: () => void;
  onMerge?: () => void;
  onDelete?: () => void;
  pushing?: boolean;
  merging?: boolean;
  hasRemote?: boolean;
  isMerged?: boolean;

  /** Extra logic to run on refresh (e.g. checkRepoStatus) */
  onRefreshExtra?: () => void;

  /** Feedback toast (success/error) — managed by parent */
  feedback?: DiffViewFeedback | null;
  onDismissFeedback?: () => void;
}

export default function DiffView({
  path,
  projectId,
  variant,
  branchName,
  onBack,
  onCreatePR,
  onPush,
  onMerge,
  onDelete,
  pushing,
  merging,
  hasRemote,
  isMerged,
  onRefreshExtra,
  feedback,
  onDismissFeedback,
}: DiffViewProps) {
  const { isGlass } = useTheme();

  const [outputFormat, setOutputFormat] =
    useState<DiffOutputFormat>("side-by-side");

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
  } = useDiffData(path, projectId);

  const totalFileCount = committedFiles.length + changedFiles.length;

  const handleRefresh = useCallback(() => {
    refresh();
    onRefreshExtra?.();
  }, [refresh, onRefreshExtra]);

  // Shared toolbar (variant determines wrapper)
  const toolbar = (
    <DiffToolbar
      variant={variant === "standalone" ? "full" : "compact"}
      fileCount={totalFileCount}
      committedFileCount={committedFiles.length}
      outputFormat={outputFormat}
      onOutputFormatChange={setOutputFormat}
      onRefresh={handleRefresh}
      loading={loading}
      branchName={branchName}
      onBack={onBack}
      onCreatePR={onCreatePR}
      onPush={onPush}
      onMerge={onMerge}
      onDelete={onDelete}
      pushing={pushing}
      merging={merging}
      hasRemote={hasRemote}
      isMerged={isMerged}
    />
  );

  // Feedback banner
  const feedbackBanner = feedback && (
    <div
      className={`flex items-center justify-between px-3 py-1.5 text-xs shrink-0 ${
        feedback.type === "success"
          ? "bg-success/10 text-success"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      <span>{feedback.text}</span>
      <button
        onClick={onDismissFeedback}
        className="ml-2 opacity-60 hover:opacity-100"
      >
        dismiss
      </button>
    </div>
  );

  // Shared content: file list + diff panel
  const content = (
    <div className="flex flex-1 overflow-hidden min-h-0">
      <FileList
        committedFiles={committedFiles}
        changedFiles={changedFiles}
        selectedFile={selectedFile}
        worktreePath={path ?? ""}
        projectId={projectId ?? ""}
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
  );

  // ── Standalone mode (ReviewView) ──
  // Renders: ViewLayout.Toolbar (via DiffToolbar) + glass content card
  if (variant === "standalone") {
    return (
      <>
        {toolbar}
        <div
          className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 flex flex-col ${glassStyles[isGlass ? "normal" : "solid"]}`}
        >
          {feedbackBanner}
          {content}
        </div>
      </>
    );
  }

  // ── Embedded mode (ChangesTab) ──
  // Renders: compact inline toolbar + content (no wrapping card — parent provides it)
  return (
    <div className="flex h-full flex-col">
      {toolbar}
      {content}
    </div>
  );
}
