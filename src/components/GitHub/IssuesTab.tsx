import { useEffect, useCallback, useState } from "react";
import {
  CircleDot,
  ListFilter,
  RefreshCw,
  Loader2,
  Download,
  Check,
  CircleCheck,
  CircleX,
  User,
  RotateCw,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "../ui/badge";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { useAppStore } from "../../store/appStore";
import { useGitHubIssues, type IssueStateFilter } from "./useGitHubIssues";
import IssueDetailPanel from "./IssueDetailPanel";
import GitHubAuthGate from "./GitHubAuthGate";
import type { GitHubIssue, ImportResult, Task } from "../../types";

const DEFAULT_DETAIL_WIDTH = 350;

interface IssuesTabProps {
  projectId: string | null;
  hasRemote: boolean;
  onOpenSettings?: () => void;
}

export default function IssuesTab({ projectId, hasRemote, onOpenSettings }: IssuesTabProps) {
  const refreshGhAuth = useAppStore((s) => s.refreshGhAuth);
  const [detailWidth, setDetailWidth] = useState(DEFAULT_DETAIL_WIDTH);
  const {
    issues,
    loading,
    importing,
    error,
    stateFilter,
    selectedNumbers,
    selectedIssue,
    issueDetail,
    detailLoading,
    setStateFilter,
    toggleSelection,
    selectAll,
    clearSelection,
    fetchIssues,
    importSelected,
    selectIssue,
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

  const handleRowClick = useCallback(
    (issueNumber: number) => {
      selectIssue(selectedIssue === issueNumber ? null : issueNumber);
    },
    [selectIssue, selectedIssue],
  );

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent, issueNumber: number, alreadyImported: boolean) => {
      e.stopPropagation();
      if (!alreadyImported) {
        toggleSelection(issueNumber);
      }
    },
    [toggleSelection],
  );

  const handleImportSingle = useCallback(
    async (issueNumber: number) => {
      if (!projectId) return;
      const issueEntry = issues.find((i) => i.issue.number === issueNumber);
      if (!issueEntry || issueEntry.already_imported) return;

      const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
      addBackgroundTask("Importing GitHub issue");
      try {
        const issuesToImport: GitHubIssue[] = [issueEntry.issue];
        await invoke<ImportResult>("import_github_issues", {
          projectId,
          issues: issuesToImport,
        });

        // Refresh store tasks
        const tasks = await invoke<Task[]>("list_tasks", { projectId });
        useAppStore.getState().setTasks(tasks);

        // Refresh issues to update import status
        await fetchIssues();
      } catch {
        // Error handled by hook
      } finally {
        removeBackgroundTask("Importing GitHub issue");
      }
    },
    [projectId, issues, fetchIssues],
  );

  const importableCount = issues.filter((i) => !i.already_imported).length;
  const allSelected =
    importableCount > 0 && selectedNumbers.size === importableCount;

  if (!projectId) return null;

  return (
    <GitHubAuthGate
      feature="issues"
      icon={CircleDot}
      hasRemote={hasRemote}
      onOpenSettings={onOpenSettings}
    >
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
                  className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors capitalize ${
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
            className="text-xs text-dim-foreground hover:text-foreground transition-colors"
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
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-destructive/10 text-destructive">
          <span className="flex-1">{error}</span>
          <button
            onClick={fetchIssues}
            className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-destructive/15 transition-colors"
          >
            <RotateCw size={10} />
            Retry
          </button>
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

      {/* Issue list + detail split */}
      {issues.length > 0 && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* List */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {issues.map(({ issue, already_imported, existing_task_id }) => (
              <div
                key={issue.number}
                onClick={() => handleRowClick(issue.number)}
                className={`flex items-center gap-2 px-3 py-1.5 border-b border-border/40 hover:bg-accent transition-colors cursor-pointer ${
                  selectedIssue === issue.number
                    ? "bg-primary/6"
                    : ""
                }`}
              >
                {/* Checkbox */}
                <div
                  className="shrink-0 flex items-center justify-center size-4"
                  onClick={(e) => handleCheckboxClick(e, issue.number, already_imported)}
                >
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
                    <div className="size-3.5 rounded-[3px] border border-border bg-transparent hover:border-primary/50 transition-colors" />
                  )}
                </div>

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

                {/* Issue number */}
                <span className="shrink-0 text-xs font-mono text-dim-foreground w-[40px]">
                  #{issue.number}
                </span>

                {/* Title + labels */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-foreground">
                      {issue.title}
                    </span>

                    {/* GitHub labels — show max 2 */}
                    {issue.labels.slice(0, 2).map((label) => (
                      <span
                        key={label.name}
                        className="shrink-0 hidden sm:inline-flex items-center rounded-full px-1.5 py-px text-2xs font-medium leading-tight max-w-[100px] truncate border"
                        style={{
                          backgroundColor: `#${label.color}20`,
                          borderColor: `#${label.color}40`,
                          color: `#${label.color}`,
                        }}
                      >
                        {label.name}
                      </span>
                    ))}
                    {issue.labels.length > 2 && (
                      <span className="shrink-0 hidden sm:inline-flex text-2xs text-muted-foreground">
                        +{issue.labels.length - 2}
                      </span>
                    )}
                  </div>
                  {/* Secondary line: assignees */}
                  {issue.assignees.length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5 text-2xs text-dim-foreground">
                      <User size={10} />
                      <span className="truncate">
                        {issue.assignees.map((a) => a.login).join(", ")}
                      </span>
                    </div>
                  )}
                </div>

                {/* Import status badge */}
                {already_imported && existing_task_id && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 gap-1 text-2xs bg-success/12 text-success border-success/25"
                  >
                    <Check size={10} />
                    {existing_task_id}
                  </Badge>
                )}
              </div>
            ))}
          </div>

          {/* Detail panel */}
          {selectedIssue !== null && (
            <IssueDetailPanel
              detail={issueDetail}
              loading={detailLoading}
              importing={importing}
              panelWidth={detailWidth}
              onResize={setDetailWidth}
              onClose={() => selectIssue(null)}
              onImport={handleImportSingle}
            />
          )}
        </div>
      )}
    </div>
    </GitHubAuthGate>
  );
}
