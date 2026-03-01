import { useMemo } from "react";
import { html as diff2Html } from "diff2html";
import DOMPurify from "dompurify";
import "diff2html/bundles/css/diff2html.min.css";
import { Spinner } from "../ui/spinner";
import type { DiffOutputFormat } from "./ReviewToolbar";

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
  const diffHtml = useMemo(() => {
    if (!rawDiff) return "";
    const raw = diff2Html(rawDiff, {
      outputFormat: outputFormat === "side-by-side" ? "side-by-side" : "line-by-line",
      drawFileList: false,
      matching: "lines",
      diffStyle: "word",
    });
    // Sanitize to prevent XSS from crafted file content in diffs
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [rawDiff, outputFormat]);

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
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No changes to display
        </p>
      </div>
    );
  }

  return (
    <div
      className="diff-panel-root flex-1 overflow-auto"
      dangerouslySetInnerHTML={{ __html: diffHtml }}
    />
  );
}
