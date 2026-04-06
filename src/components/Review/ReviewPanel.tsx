import { useMemo } from "react";
import { FileDiff } from "lucide-react";
import { Spinner } from "../ui/spinner";

import { DiffRenderer, fromUnifiedDiff } from "../Diff";
import type { DiffViewMode } from "../Diff";
import type { DiffOutputFormat } from "./DiffToolbar";

interface ReviewPanelProps {
  rawDiff: string;
  outputFormat: DiffOutputFormat;
  loading: boolean;
  error: string | null;
}

export default function ReviewPanel({
  rawDiff,
  outputFormat,
  loading,
  error,
}: ReviewPanelProps) {
  const files = useMemo(() => {
    if (!rawDiff) return [];
    return fromUnifiedDiff(rawDiff);
  }, [rawDiff]);

  const viewMode: DiffViewMode =
    outputFormat === "side-by-side" ? "side-by-side" : "unified";

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="text-center">
          <p className="text-sm text-destructive">
            Failed to load diff
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!rawDiff) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <FileDiff className="size-8 text-muted-foreground opacity-30" />
        <p className="text-sm text-muted-foreground">
          Select a file to view its diff
        </p>
      </div>
    );
  }

  return (
    <DiffRenderer
      files={files}
      viewMode={viewMode}
      contextThreshold={0}
      className="flex-1 overflow-auto p-2"
    />
  );
}
