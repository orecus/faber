import { Columns2, RefreshCw, Rows2 } from "lucide-react";
import { useCallback, useState } from "react";

import { useAppStore } from "../../store/appStore";
import FileList from "../Review/FileList";
import ReviewPanel from "../Review/ReviewPanel";
import type { DiffOutputFormat } from "../Review/ReviewToolbar";
import { useDiffData } from "../Review/useDiffData";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface ChangesTabProps {
  projectId: string;
}

export default function ChangesTab({ projectId }: ChangesTabProps) {
  const projectInfo = useAppStore((s) => s.projectInfo);
  const projectPath = projectInfo?.project.path ?? null;

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
  } = useDiffData(projectPath, projectId);

  const totalFileCount = committedFiles.length + changedFiles.length;

  const toggleFormat = useCallback(() => {
    setOutputFormat((f) => (f === "side-by-side" ? "line-by-line" : "side-by-side"));
  }, []);

  // Empty state when project path is unavailable
  if (!projectPath) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No project path available
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Mini toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          {totalFileCount} file{totalFileCount !== 1 ? "s" : ""} changed
        </span>

        <div className="flex-1" />

        {/* Diff mode toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleFormat}
          leftIcon={
            outputFormat === "side-by-side" ? (
              <Columns2 className="size-3.5" />
            ) : (
              <Rows2 className="size-3.5" />
            )
          }
          hoverEffect="scale"
          clickEffect="scale"
          className="text-dim-foreground hover:text-foreground"
          title="Toggle diff view"
        >
          {outputFormat === "side-by-side" ? "Split" : "Unified"}
        </Button>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          leftIcon={
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
          }
          hoverEffect="scale"
          clickEffect="scale"
          className="text-dim-foreground hover:text-foreground"
          title="Refresh changes"
        >
          Refresh
        </Button>
      </div>

      {/* Main content: file list + diff panel */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <FileList
          committedFiles={committedFiles}
          changedFiles={changedFiles}
          selectedFile={selectedFile}
          worktreePath={projectPath}
          projectId={projectId}
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
  );
}
