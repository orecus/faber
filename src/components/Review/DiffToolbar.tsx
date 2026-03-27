import {
  ArrowLeft,
  Columns2,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
  Loader2,
  RefreshCw,
  Rows2,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { ViewLayout } from "../Shell/ViewLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/orecus.io/components/enhanced-button";

export type DiffOutputFormat = "side-by-side" | "line-by-line";

interface DiffToolbarProps {
  /** "full" renders as ViewLayout.Toolbar; "compact" renders as inline border-b bar */
  variant: "full" | "compact";

  // Always shown
  fileCount: number;
  outputFormat: DiffOutputFormat;
  onOutputFormatChange: (format: DiffOutputFormat) => void;
  onRefresh: () => void;
  loading: boolean;

  // Optional — provide to show; omit/null to hide
  branchName?: string | null;
  committedFileCount?: number;
  onBack?: () => void;
  onCreatePR?: () => void;
  onPush?: () => void;
  onMerge?: () => void;
  onDelete?: () => void;
  pushing?: boolean;
  merging?: boolean;
  hasRemote?: boolean;
  isMerged?: boolean;
}

export default function DiffToolbar({
  variant,
  fileCount,
  outputFormat,
  onOutputFormatChange,
  onRefresh,
  loading,
  branchName,
  committedFileCount = 0,
  onBack,
  onCreatePR,
  onPush,
  onMerge,
  onDelete,
  pushing = false,
  merging = false,
  hasRemote = true,
  isMerged = false,
}: DiffToolbarProps) {
  const accentColor = useProjectAccentColor();
  const toggleFormat = useCallback(() => {
    onOutputFormatChange(
      outputFormat === "side-by-side" ? "line-by-line" : "side-by-side",
    );
  }, [outputFormat, onOutputFormatChange]);

  const content = (
    <>
      {/* Back (worktree context) */}
      {onBack && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            leftIcon={<ArrowLeft className="size-3.5" />}
            hoverEffect="scale"
            clickEffect="scale"
            className="text-dim-foreground hover:text-foreground"
            title="Back"
          >
            Back
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
        </>
      )}

      {/* Branch badge (worktree context) */}
      {branchName && (
        <Badge
          variant="secondary"
          className="gap-1 bg-popover text-dim-foreground text-xs font-mono"
        >
          <GitBranch className="size-3" />
          {branchName}
        </Badge>
      )}

      {/* File count */}
      <span className="text-xs text-muted-foreground">
        {fileCount} file{fileCount !== 1 ? "s" : ""} changed
      </span>

      {/* Spacer */}
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
        onClick={onRefresh}
        leftIcon={
          <RefreshCw
            className={`size-3.5 ${loading ? "animate-spin" : ""}`}
          />
        }
        hoverEffect="scale"
        clickEffect="scale"
        className="text-dim-foreground hover:text-foreground"
        title="Refresh diff"
      >
        Refresh
      </Button>

      {/* Action buttons (worktree context) */}
      {(onMerge || onPush || onCreatePR) && (
        <div className="mx-1 h-4 w-px bg-border" />
      )}

      {/* Merge branch (local) */}
      {onMerge && (
        <Button
          variant="outline"
          size="sm"
          onClick={onMerge}
          disabled={merging || isMerged || committedFileCount === 0}
          leftIcon={
            merging ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitMerge className="size-3.5" />
            )
          }
          hoverEffect="scale"
          clickEffect="scale"
          title={
            isMerged
              ? "Branch already merged"
              : "Merge branch into another branch"
          }
        >
          {merging ? "Merging..." : isMerged ? "Merged" : "Merge"}
        </Button>
      )}

      {/* Push to remote */}
      {onPush && (
        <Button
          variant="outline"
          size="sm"
          onClick={onPush}
          disabled={pushing || !hasRemote}
          leftIcon={
            pushing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )
          }
          hoverEffect="scale"
          clickEffect="scale"
          title={hasRemote ? "Push to remote" : "No remote configured"}
        >
          {pushing ? "Pushing..." : "Push"}
        </Button>
      )}

      {/* Create PR (remote) */}
      {onCreatePR && (
        <Button
          variant={hasRemote ? "color" : "outline"}
          color={hasRemote ? accentColor : undefined}
          size="sm"
          onClick={onCreatePR}
          disabled={!hasRemote}
          leftIcon={<GitPullRequestArrow className="size-3.5" />}
          hoverEffect={hasRemote ? "scale-glow" : "scale"}
          clickEffect="scale"
          title={hasRemote ? "Create pull request" : "No remote configured"}
        >
          Create PR
        </Button>
      )}

      {/* Delete worktree */}
      {onDelete && (
        <>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            hoverEffect="scale"
            clickEffect="scale"
            className="text-destructive hover:bg-destructive/10"
            leftIcon={<Trash2 className="size-3.5" />}
            title="Delete worktree"
          >
            Delete
          </Button>
        </>
      )}
    </>
  );

  if (variant === "full") {
    return <ViewLayout.Toolbar>{content}</ViewLayout.Toolbar>;
  }

  // Compact inline variant
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      {content}
    </div>
  );
}
