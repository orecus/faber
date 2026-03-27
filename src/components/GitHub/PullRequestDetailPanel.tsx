import { open } from "@tauri-apps/plugin-shell";
import {
  X,
  Loader2,
  GitMerge,
  GitPullRequestClosed,
  ExternalLink,
  ChevronDown,
  FilePlus2,
  FilePen,
  FileX2,
} from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import type { GitHubPRDetail } from "../../types";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";

interface PullRequestDetailPanelProps {
  detail: GitHubPRDetail | null;
  loading: boolean;
  merging: boolean;
  closing: boolean;
  onClose: () => void;
  onMerge: (number: number, method: string) => Promise<void>;
  onClosePR: (number: number) => Promise<void>;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function stateColor(state: string): string {
  switch (state.toUpperCase()) {
    case "OPEN":
      return "var(--success)";
    case "MERGED":
      return "#a371f7";
    case "CLOSED":
      return "var(--destructive)";
    default:
      return "var(--muted-foreground)";
  }
}

function reviewDecisionLabel(decision: string | null): {
  label: string;
  color: string;
} | null {
  if (!decision) return null;
  switch (decision) {
    case "APPROVED":
      return { label: "Approved", color: "var(--success)" };
    case "CHANGES_REQUESTED":
      return { label: "Changes requested", color: "var(--warning)" };
    case "REVIEW_REQUIRED":
      return { label: "Review required", color: "var(--muted-foreground)" };
    default:
      return null;
  }
}

/** Group files by their parent directory. */
function groupByDirectory(
  files: { path: string; additions: number; deletions: number }[],
): Map<string, typeof files> {
  const groups = new Map<string, typeof files>();
  for (const f of files) {
    const idx = f.path.lastIndexOf("/");
    const dir = idx >= 0 ? f.path.slice(0, idx) : ".";
    const existing = groups.get(dir);
    if (existing) {
      existing.push(f);
    } else {
      groups.set(dir, [f]);
    }
  }
  return groups;
}

export default function PullRequestDetailPanel({
  detail,
  loading,
  merging,
  closing,
  onClose,
  onMerge,
  onClosePR,
}: PullRequestDetailPanelProps) {
  const { isGlass } = useTheme();
  const [mergeMethod, setMergeMethod] = useState("squash");
  const [showMergeOptions, setShowMergeOptions] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleMerge = useCallback(async () => {
    if (!detail) return;
    await onMerge(detail.number, mergeMethod);
  }, [detail, mergeMethod, onMerge]);

  const handleCloseClick = useCallback(() => {
    if (!confirmClose) {
      setConfirmClose(true);
      closeTimerRef.current = setTimeout(() => setConfirmClose(false), 3000);
      return;
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setConfirmClose(false);
    if (detail) onClosePR(detail.number);
  }, [confirmClose, detail, onClosePR]);

  const handleOpenInGitHub = useCallback(() => {
    if (detail?.url) {
      open(detail.url);
    }
  }, [detail]);

  return (
    <div
      className={`w-[350px] shrink-0 flex flex-col border-l border-border overflow-hidden ${glassStyles[isGlass ? "normal" : "solid"]}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-foreground">
          Pull Request Detail
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Close detail panel"
        >
          <X size={14} />
        </button>
      </div>

      {loading && !detail && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {detail && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {/* Title + number + state */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium"
                style={{
                  backgroundColor: `color-mix(in oklch, ${stateColor(detail.state)} 15%, transparent)`,
                  color: stateColor(detail.state),
                }}
              >
                {detail.state.toLowerCase()}
              </span>
              {detail.is_draft && (
                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-2xs font-medium bg-muted text-muted-foreground">
                  Draft
                </span>
              )}
            </div>
            <div className="text-xs font-medium text-foreground">
              {detail.title}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              #{detail.number}
            </div>
          </div>

          {/* Author + date */}
          <div className="space-y-1">
            <div className="text-xs text-dim-foreground">
              {detail.author.login} opened{" "}
              {formatRelativeTime(detail.created_at)}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
              <span className="text-primary">{detail.head_ref_name}</span>
              <span>→</span>
              <span>{detail.base_ref_name}</span>
            </div>
          </div>

          {/* Review decision */}
          {(() => {
            const rd = reviewDecisionLabel(detail.review_decision);
            if (!rd) return null;
            return (
              <div
                className="text-xs font-medium"
                style={{ color: rd.color }}
              >
                {rd.label}
              </div>
            );
          })()}

          {/* Body */}
          {detail.body && (
            <div className="space-y-1">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground">
                Description
              </div>
              <div className="text-xs text-dim-foreground whitespace-pre-wrap leading-relaxed">
                {detail.body}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-3 text-xs">
            <span className="text-success">+{detail.additions}</span>
            <span className="text-destructive">-{detail.deletions}</span>
            <span className="text-muted-foreground">
              {detail.changed_files} file
              {detail.changed_files !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Reviews */}
          {detail.reviews.length > 0 && (
            <div className="space-y-1">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground">
                Reviews
              </div>
              {detail.reviews.map((r, i) => (
                <div
                  key={`${r.author}-${i}`}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <span className="text-dim-foreground">{r.author}</span>
                  <span
                    className="text-2xs font-medium"
                    style={{
                      color:
                        r.state === "APPROVED"
                          ? "var(--success)"
                          : r.state === "CHANGES_REQUESTED"
                            ? "var(--warning)"
                            : "var(--muted-foreground)",
                    }}
                  >
                    {r.state.toLowerCase().replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Labels */}
          {detail.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {detail.labels.map((label) => (
                <span
                  key={label.name}
                  className="inline-flex items-center rounded-full px-1.5 py-px text-2xs font-medium border"
                  style={{
                    backgroundColor: `#${label.color}20`,
                    borderColor: `#${label.color}40`,
                    color: `#${label.color}`,
                  }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          )}

          {/* Files */}
          {detail.files.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground">
                Files changed ({detail.files.length})
              </div>
              {Array.from(groupByDirectory(detail.files)).map(
                ([dir, files]) => (
                  <div key={dir}>
                    <div className="text-2xs text-muted-foreground mb-0.5 font-mono">
                      {dir}/
                    </div>
                    {files.map((f) => {
                      const fileName = f.path.split("/").pop() ?? f.path;
                      const hasAdditions = f.additions > 0;
                      const hasDeletions = f.deletions > 0;
                      const Icon =
                        hasDeletions && !hasAdditions
                          ? FileX2
                          : hasAdditions && !hasDeletions
                            ? FilePlus2
                            : FilePen;
                      const iconColor =
                        hasDeletions && !hasAdditions
                          ? "var(--destructive)"
                          : hasAdditions && !hasDeletions
                            ? "var(--success)"
                            : "var(--primary)";
                      return (
                        <div
                          key={f.path}
                          className="flex items-center gap-1.5 py-0.5 pl-3"
                        >
                          <Icon
                            size={11}
                            className="shrink-0"
                            style={{ color: iconColor }}
                          />
                          <span className="text-xs text-dim-foreground truncate font-mono flex-1">
                            {fileName}
                          </span>
                          <span className="text-2xs text-success shrink-0">
                            +{f.additions}
                          </span>
                          <span className="text-2xs text-destructive shrink-0">
                            -{f.deletions}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {detail && detail.state.toUpperCase() === "OPEN" && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {/* Merge with method selector */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="default"
              size="sm"
              disabled={merging || detail.is_draft}
              loading={merging}
              onClick={handleMerge}
              leftIcon={<GitMerge className="size-3.5" />}
              hoverEffect="scale"
              clickEffect="scale"
              className="flex-1"
              title={
                detail.is_draft ? "Cannot merge draft PR" : "Merge pull request"
              }
            >
              Merge
            </Button>
            <div className="relative">
              <button
                onClick={() => setShowMergeOptions(!showMergeOptions)}
                className="flex items-center justify-center rounded-[var(--radius-element)] border border-border px-1.5 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Merge method"
              >
                <ChevronDown size={12} />
              </button>
              {showMergeOptions && (
                <div className="absolute bottom-full right-0 mb-1 w-[120px] rounded-lg border border-border bg-popover shadow-lg p-1 z-50">
                  {["merge", "squash", "rebase"].map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMergeMethod(m);
                        setShowMergeOptions(false);
                      }}
                      className={`w-full text-left px-2 py-1 text-xs rounded-[var(--radius-element)] transition-colors capitalize ${
                        mergeMethod === m
                          ? "bg-accent text-foreground"
                          : "text-dim-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Close + Open in GitHub */}
          <div className="flex items-center gap-1.5">
            <Button
              variant={confirmClose ? "destructive" : "outline"}
              size="sm"
              disabled={closing}
              loading={closing}
              onClick={handleCloseClick}
              leftIcon={<GitPullRequestClosed className="size-3.5" />}
              hoverEffect="scale"
              clickEffect="scale"
              title="Close this pull request on GitHub"
              className="flex-1"
            >
              {confirmClose ? "Confirm?" : "Close"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInGitHub}
              leftIcon={<ExternalLink className="size-3.5" />}
              hoverEffect="scale"
              clickEffect="scale"
              title="Open in GitHub"
            >
              Open
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
