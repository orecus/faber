import { useEffect } from "react";
import {
  AlertTriangle,
  CircleDot,
  ListFilter,
  RefreshCw,
  Loader2,
  Download,
  Check,
  CircleCheck,
  CircleX,
  User,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { useAppStore } from "../../store/appStore";
import { useGitHubIssues, type IssueStateFilter } from "./useGitHubIssues";

interface IssuesTabProps {
  projectId: string | null;
  hasRemote: boolean;
}

export default function IssuesTab({ projectId, hasRemote }: IssuesTabProps) {
  const ghAuthStatus = useAppStore((s) => s.ghAuthStatus);
  const refreshGhAuth = useAppStore((s) => s.refreshGhAuth);
  const {
    issues,
    loading,
    importing,
    error,
    stateFilter,
    selectedNumbers,
    setStateFilter,
    toggleSelection,
    selectAll,
    clearSelection,
    fetchIssues,
    importSelected,
  } = useGitHubIssues(projectId);

  // Fetch on mount and when filter changes
  useEffect(() => {
    if (projectId) {
      fetchIssues();
    }
  }, [projectId, stateFilter, fetchIssues]);

  // If we get a 401-like error, refresh auth status so sidebar updates
  useEffect(() => {
    if (error && (error.includes("401") || error.toLowerCase().includes("auth"))) {
      refreshGhAuth();
    }
  }, [error, refreshGhAuth]);


  // Auth is broken if not installed, not authenticated, or has scope warnings
  const authBroken = ghAuthStatus && (
    !ghAuthStatus.installed || !ghAuthStatus.authenticated || ghAuthStatus.has_scope_warnings
  );

  const importableCount = issues.filter((i) => !i.already_imported).length;
  const allSelected =
    importableCount > 0 && selectedNumbers.size === importableCount;

  if (!projectId) return null;

  // Show no-remote state for local-only repos
  if (!hasRemote) {
    return (
      <div className="flex flex-1 h-full flex-col items-center justify-center text-muted-foreground">
        <CircleDot className="mb-3 size-10 opacity-30" />
        <p className="text-sm font-medium text-foreground">No remote configured</p>
        <p className="mt-1 text-xs text-center max-w-xs">
          This project has no git remote. Add a remote to browse GitHub issues.
        </p>
      </div>
    );
  }

  // Show auth error state instead of attempting API calls
  if (authBroken) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
        <AlertTriangle className="mb-3 size-10 opacity-40 text-warning" />
        <p className="text-sm font-medium text-foreground">GitHub authentication issue</p>
        <p className="mt-1 text-xs text-center max-w-xs">
          {!ghAuthStatus?.installed
            ? "GitHub CLI (gh) is not installed. Install it to browse issues."
            : !ghAuthStatus?.authenticated
              ? "GitHub CLI is not authenticated. Run `gh auth login` to browse issues."
              : `Token is missing required scopes: ${ghAuthStatus.missing_scopes.join(", ")}. Update your token to browse issues.`}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={refreshGhAuth}
          leftIcon={<RefreshCw className="size-3" />}
          hoverEffect="scale"
          clickEffect="scale"
        >
          Re-check auth
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-h-0 h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
        {/* State filter toggle */}
        <div className="flex items-center rounded-[var(--radius-element)] border border-border overflow-hidden">
          {(["open", "closed", "all"] as IssueStateFilter[]).map(
            (filter, idx) => (
              <div key={filter} className="flex items-center">
                {idx > 0 && (
                  <div className="w-px h-4 bg-border" />
                )}
                <button
                  onClick={() => setStateFilter(filter)}
                  title={`Show ${filter} issues`}
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] transition-colors capitalize ${
                    stateFilter === filter
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-dim-foreground"
                  }`}
                >
                  {filter === "open" && <CircleDot size={11} />}
                  {filter === "closed" && <CircleCheck size={11} />}
                  {filter === "all" && <ListFilter size={11} />}
                  {filter}
                </button>
              </div>
            ),
          )}
        </div>

        {/* Issue count */}
        <span className="text-xs text-muted-foreground">
          {issues.length} issue{issues.length !== 1 ? "s" : ""}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Select all / clear */}
        {importableCount > 0 && (
          <button
            onClick={allSelected ? clearSelection : selectAll}
            className="text-[11px] text-dim-foreground hover:text-foreground transition-colors"
            title={allSelected ? "Clear all selections" : "Select all importable issues"}
          >
            {allSelected ? "Clear selection" : "Select all"}
          </button>
        )}

        {/* Import button */}
        <Button
          variant="default"
          size="sm"
          onClick={importSelected}
          disabled={selectedNumbers.size === 0 || importing}
          loading={importing}
          leftIcon={<Download className="size-3.5" />}
          hoverEffect="scale"
          clickEffect="scale"
          title="Import selected issues as tasks"
        >
          Import{selectedNumbers.size > 0 ? ` (${selectedNumbers.size})` : ""}
        </Button>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchIssues}
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
          title="Refresh issues"
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
      {loading && issues.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && issues.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <CircleDot className="mb-3 size-10 opacity-30" />
          <p className="text-sm">No {stateFilter} issues found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Make sure the project is a GitHub repository with `gh` CLI installed
          </p>
        </div>
      )}

      {/* Issue list */}
      {issues.length > 0 && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {issues.map(({ issue, already_imported, existing_task_id }) => (
            <div
              key={issue.number}
              onClick={() =>
                !already_imported && toggleSelection(issue.number)
              }
              className={`flex items-center gap-2.5 px-3 py-2 border-b border-border/40 hover:bg-accent transition-colors ${
                already_imported
                  ? "opacity-60 cursor-default"
                  : "cursor-pointer"
              } ${
                selectedNumbers.has(issue.number)
                  ? "bg-[color-mix(in_oklch,var(--primary)_6%,transparent)]"
                  : ""
              }`}
            >
              {/* Checkbox */}
              <div className="shrink-0 flex items-center justify-center size-4">
                {already_imported ? (
                  <Check
                    size={14}
                    className="text-success"
                  />
                ) : selectedNumbers.has(issue.number) ? (
                  <div className="size-3.5 rounded-[3px] bg-primary flex items-center justify-center">
                    <Check size={10} className="text-white" />
                  </div>
                ) : (
                  <div className="size-3.5 rounded-[3px] border border-border bg-transparent" />
                )}
              </div>

              {/* Issue number */}
              <span className="shrink-0 text-[11px] font-mono text-dim-foreground w-[48px]">
                #{issue.number}
              </span>

              {/* State icon */}
              <div className="shrink-0">
                {issue.state === "OPEN" ? (
                  <CircleDot
                    size={13}
                    className="text-success"
                  />
                ) : (
                  <CircleX
                    size={13}
                    className="text-destructive"
                  />
                )}
              </div>

              {/* Title + labels */}
              <div className="flex-1 flex items-center gap-1.5 min-w-0">
                <span className="truncate text-[13px] text-foreground">
                  {issue.title}
                </span>

                {/* GitHub labels */}
                {issue.labels.map((label) => (
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

              {/* Assignees */}
              {issue.assignees.length > 0 && (
                <div className="shrink-0 flex items-center gap-1 text-[10px] text-dim-foreground">
                  <User size={10} />
                  <span>
                    {issue.assignees.map((a) => a.login).join(", ")}
                  </span>
                </div>
              )}

              {/* Import status badge */}
              {already_imported && existing_task_id && (
                <Badge
                  variant="secondary"
                  className="shrink-0 gap-1 text-[10px] bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-success border-[color-mix(in_oklch,var(--success)_25%,transparent)]"
                >
                  <Check size={10} />
                  {existing_task_id}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
