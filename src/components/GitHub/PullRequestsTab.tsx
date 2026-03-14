import { useEffect, useCallback } from "react";
import {
  GitPullRequestArrow,
  GitMerge,
  GitPullRequestClosed,
  RefreshCw,
  Loader2,
  CircleDot,
  ListFilter,
  Eye,
  FileEdit,
  Check,
} from "lucide-react";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { useAppStore } from "../../store/appStore";
import { usePullRequests, type PRStateFilter } from "./usePullRequests";
import PullRequestDetailPanel from "./PullRequestDetailPanel";
import GitHubAuthGate from "./GitHubAuthGate";

interface PullRequestsTabProps {
  projectId: string | null;
  hasRemote: boolean;
  onOpenSettings?: () => void;
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

function stateIcon(state: string) {
  switch (state.toUpperCase()) {
    case "OPEN":
      return <GitPullRequestArrow size={13} className="text-success" />;
    case "MERGED":
      return <GitMerge size={13} style={{ color: "#a371f7" }} />;
    case "CLOSED":
      return <GitPullRequestClosed size={13} className="text-destructive" />;
    default:
      return <CircleDot size={13} className="text-muted-foreground" />;
  }
}

function reviewIcon(decision: string | null) {
  if (!decision) return null;
  switch (decision) {
    case "APPROVED":
      return <Check size={11} className="text-success" />;
    case "CHANGES_REQUESTED":
      return <FileEdit size={11} className="text-warning" />;
    case "REVIEW_REQUIRED":
      return <Eye size={11} className="text-muted-foreground" />;
    default:
      return null;
  }
}

export default function PullRequestsTab({
  projectId,
  hasRemote,
  onOpenSettings,
}: PullRequestsTabProps) {
  const refreshGhAuth = useAppStore((s) => s.refreshGhAuth);
  const {
    prs,
    loading,
    error,
    stateFilter,
    selectedPR,
    prDetail,
    detailLoading,
    merging,
    closing,
    setStateFilter,
    fetchPRs,
    selectPR,
    mergePR,
    closePR,
  } = usePullRequests(projectId);

  // Fetch on mount and when filter changes
  useEffect(() => {
    if (projectId) {
      fetchPRs();
    }
  }, [projectId, stateFilter, fetchPRs]);

  // If we get a 401-like error, refresh auth status so sidebar updates
  useEffect(() => {
    if (error && (error.includes("401") || error.toLowerCase().includes("auth"))) {
      refreshGhAuth();
    }
  }, [error, refreshGhAuth]);

  const handleRowClick = useCallback(
    (number: number) => {
      selectPR(selectedPR === number ? null : number);
    },
    [selectPR, selectedPR],
  );

  if (!projectId) return null;

  return (
    <GitHubAuthGate
      feature="pull requests"
      icon={GitPullRequestArrow}
      hasRemote={hasRemote}
      onOpenSettings={onOpenSettings}
    >
    <div className="flex flex-1 flex-col overflow-hidden min-h-0 h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
        {/* State filter toggle */}
        <div className="flex items-center rounded-[var(--radius-element)] border border-border overflow-hidden">
          {(["open", "closed", "all"] as PRStateFilter[]).map(
            (filter, idx) => (
              <div key={filter} className="flex items-center">
                {idx > 0 && <div className="w-px h-4 bg-border" />}
                <button
                  onClick={() => setStateFilter(filter)}
                  title={`Show ${filter} pull requests`}
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] transition-colors capitalize ${
                    stateFilter === filter
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-dim-foreground"
                  }`}
                >
                  {filter === "open" && (
                    <GitPullRequestArrow size={11} />
                  )}
                  {filter === "closed" && <GitPullRequestClosed size={11} />}
                  {filter === "all" && <ListFilter size={11} />}
                  {filter}
                </button>
              </div>
            ),
          )}
        </div>

        {/* PR count */}
        <span className="text-xs text-muted-foreground">
          {prs.length} PR{prs.length !== 1 ? "s" : ""}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Refresh */}
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchPRs}
          disabled={loading}
          leftIcon={
            loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )
          }
          hoverEffect="scale"
          clickEffect="scale"
          className="text-dim-foreground hover:text-foreground"
          title="Refresh pull requests"
        >
          Refresh
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 text-xs bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)] text-destructive">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && prs.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && prs.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <GitPullRequestArrow className="mb-3 size-10 opacity-30" />
          <p className="text-sm">No {stateFilter} pull requests found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Make sure the project is a GitHub repository with `gh` CLI
            installed
          </p>
        </div>
      )}

      {/* PR list + detail split */}
      {prs.length > 0 && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* List */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {prs.map((pr) => (
              <div
                key={pr.number}
                onClick={() => handleRowClick(pr.number)}
                className={`flex items-center gap-2.5 px-3 py-2 border-b border-border/40 hover:bg-accent transition-colors cursor-pointer ${
                  selectedPR === pr.number
                    ? "bg-[color-mix(in_oklch,var(--primary)_6%,transparent)]"
                    : ""
                }`}
              >
                {/* State icon */}
                <div className="shrink-0">{stateIcon(pr.state)}</div>

                {/* PR number */}
                <span className="shrink-0 text-[11px] font-mono text-dim-foreground w-[48px]">
                  #{pr.number}
                </span>

                {/* Title + draft badge + labels */}
                <div className="flex-1 flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-[13px] text-foreground">
                    {pr.title}
                  </span>

                  {pr.is_draft && (
                    <span className="shrink-0 inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium bg-muted text-muted-foreground">
                      Draft
                    </span>
                  )}

                  {pr.labels.map((label) => (
                    <span
                      key={label.name}
                      className="shrink-0 inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium leading-tight max-w-[100px] truncate border"
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

                {/* Branch pill */}
                <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-mono text-muted-foreground bg-muted max-w-[180px] truncate">
                  {pr.head_ref_name}
                  <span className="text-[9px]">→</span>
                  {pr.base_ref_name}
                </span>

                {/* Review status */}
                <div className="shrink-0 flex items-center">
                  {reviewIcon(pr.review_decision)}
                </div>

                {/* Diff stats */}
                <div className="shrink-0 flex items-center gap-1.5 text-[10px]">
                  <span className="text-success">+{pr.additions}</span>
                  <span className="text-destructive">-{pr.deletions}</span>
                </div>

                {/* Author */}
                <span className="shrink-0 text-[10px] text-muted-foreground max-w-[80px] truncate">
                  {pr.author.login}
                </span>

                {/* Time */}
                <span className="shrink-0 text-[10px] text-muted-foreground w-[52px] text-right">
                  {formatRelativeTime(pr.updated_at)}
                </span>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          {selectedPR !== null && (
            <PullRequestDetailPanel
              detail={prDetail}
              loading={detailLoading}
              merging={merging}
              closing={closing}
              onClose={() => selectPR(null)}
              onMerge={mergePR}
              onClosePR={closePR}
            />
          )}
        </div>
      )}
    </div>
    </GitHubAuthGate>
  );
}
