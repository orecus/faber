import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-shell";
import {
  X,
  Loader2,
  ExternalLink,
  Download,
  CircleDot,
  CircleCheck,
  MessageSquare,
  User,
  Check,
} from "lucide-react";

import { useTheme } from "../../contexts/ThemeContext";
import type { GitHubIssueDetail } from "../../types";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";
import DetailPanelResizeHandle from "./DetailPanelResizeHandle";

interface IssueDetailPanelProps {
  detail: GitHubIssueDetail | null;
  loading: boolean;
  importing: boolean;
  panelWidth: number;
  onResize: (width: number) => void;
  onClose: () => void;
  onImport: (issueNumber: number) => void;
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
    case "CLOSED":
      return "var(--destructive)";
    default:
      return "var(--muted-foreground)";
  }
}

export default function IssueDetailPanel({
  detail,
  loading,
  importing,
  panelWidth,
  onResize,
  onClose,
  onImport,
}: IssueDetailPanelProps) {
  const { isGlass } = useTheme();

  const handleOpenInGitHub = useCallback(() => {
    if (detail?.issue.url) {
      open(detail.issue.url);
    }
  }, [detail]);

  const handleImport = useCallback(() => {
    if (detail && !detail.already_imported) {
      onImport(detail.issue.number);
    }
  }, [detail, onImport]);

  return (
    <div
      className={`relative shrink-0 flex flex-col border-l border-border overflow-hidden max-w-[40%] ${glassStyles[isGlass ? "normal" : "solid"]}`}
      style={{ width: panelWidth }}
    >
      <DetailPanelResizeHandle onResize={onResize} />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-foreground">
          Issue Detail
        </span>
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          {/* State + title + number */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium"
                style={{
                  backgroundColor: `color-mix(in oklch, ${stateColor(detail.issue.state)} 15%, transparent)`,
                  color: stateColor(detail.issue.state),
                }}
              >
                {detail.issue.state.toUpperCase() === "OPEN" ? (
                  <CircleDot size={10} />
                ) : (
                  <CircleCheck size={10} />
                )}
                {detail.issue.state.toLowerCase()}
              </span>
              {detail.already_imported && detail.existing_task_id && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-2xs font-medium"
                  style={{
                    backgroundColor: `color-mix(in oklch, var(--success) 12%, transparent)`,
                    color: "var(--success)",
                  }}
                >
                  <Check size={9} />
                  {detail.existing_task_id}
                </span>
              )}
            </div>
            <div className="text-xs font-medium text-foreground">
              {detail.issue.title}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              #{detail.issue.number}
            </div>
          </div>

          {/* Author + date */}
          {detail.issue.assignees.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-dim-foreground">
              <User size={11} className="shrink-0" />
              <span>
                {detail.issue.assignees.map((a) => a.login).join(", ")}
              </span>
            </div>
          )}

          <div className="text-xs text-dim-foreground">
            Opened {formatRelativeTime(detail.issue.created_at)}
            {detail.issue.updated_at !== detail.issue.created_at && (
              <span className="text-muted-foreground">
                {" "}· updated {formatRelativeTime(detail.issue.updated_at)}
              </span>
            )}
          </div>

          {/* Labels */}
          {detail.issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {detail.issue.labels.map((label) => (
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

          {/* Body */}
          {detail.issue.body && (
            <div className="space-y-1">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground">
                Description
              </div>
              <div className="text-xs text-dim-foreground whitespace-pre-wrap leading-relaxed">
                {detail.issue.body}
              </div>
            </div>
          )}

          {!detail.issue.body && (
            <div className="space-y-1">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground">
                Description
              </div>
              <div className="text-xs text-muted-foreground italic">
                No description provided
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-2xs uppercase tracking-wider text-muted-foreground">
              <MessageSquare size={11} />
              Comments ({detail.comments.length})
            </div>

            {detail.comments.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                No comments yet
              </div>
            )}

            {detail.comments.map((comment) => (
              <div
                key={comment.id}
                className="rounded-lg border border-border/60 overflow-hidden"
              >
                {/* Comment header */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/40 border-b border-border/40">
                  {comment.author_avatar ? (
                    <img
                      src={comment.author_avatar}
                      alt={comment.author}
                      className="size-4 rounded-full shrink-0"
                    />
                  ) : (
                    <User size={11} className="shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-xs font-medium text-dim-foreground truncate">
                    {comment.author}
                  </span>
                  <span className="text-2xs text-muted-foreground shrink-0 ml-auto">
                    {formatRelativeTime(comment.created_at)}
                  </span>
                </div>
                {/* Comment body */}
                <div className="px-2.5 py-2 text-xs text-dim-foreground whitespace-pre-wrap leading-relaxed">
                  {comment.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {detail && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {/* Import button (if not already imported) */}
          {!detail.already_imported && (
            <Button
              variant="default"
              size="sm"
              onClick={handleImport}
              disabled={importing}
              loading={importing}
              leftIcon={<Download className="size-3.5" />}
              hoverEffect="scale"
              clickEffect="scale"
              className="w-full"
              title="Import this issue as a task"
            >
              Import as Task
            </Button>
          )}

          {/* Open in GitHub */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenInGitHub}
            leftIcon={<ExternalLink className="size-3.5" />}
            hoverEffect="scale"
            clickEffect="scale"
            className="w-full"
            title="Open in GitHub"
          >
            Open in GitHub
          </Button>
        </div>
      )}
    </div>
  );
}
