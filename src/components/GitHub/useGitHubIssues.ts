import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  GitHubIssue,
  GitHubIssueWithImportStatus,
  GitHubIssueDetail,
  GitHubComment,
  ImportResult,
} from "../../types";
import { useAppStore } from "../../store/appStore";

export type IssueStateFilter = "open" | "closed" | "all";

export interface UseGitHubIssues {
  issues: GitHubIssueWithImportStatus[];
  loading: boolean;
  importing: boolean;
  error: string | null;
  stateFilter: IssueStateFilter;
  selectedNumbers: Set<number>;
  selectedIssue: number | null;
  issueDetail: GitHubIssueDetail | null;
  detailLoading: boolean;
  setStateFilter: (filter: IssueStateFilter) => void;
  toggleSelection: (issueNumber: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  fetchIssues: () => Promise<void>;
  importSelected: () => Promise<ImportResult | null>;
  selectIssue: (issueNumber: number | null) => void;
}

export function useGitHubIssues(projectId: string | null): UseGitHubIssues {
  const [issues, setIssues] = useState<GitHubIssueWithImportStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<IssueStateFilter>("open");
  const [selectedNumbers, setSelectedNumbers] = useState<Set<number>>(
    new Set(),
  );

  // Detail panel state
  const [selectedIssue, setSelectedIssue] = useState<number | null>(null);
  const [issueDetail, setIssueDetail] = useState<GitHubIssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const detailCache = useRef<Map<number, GitHubIssueDetail>>(new Map());

  const fetchIssues = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Loading GitHub issues");
    try {
      const result = await invoke<GitHubIssueWithImportStatus[]>(
        "list_github_issues",
        {
          projectId,
          stateFilter: stateFilter,
          limit: 100,
        },
      );
      setIssues(result);
      setSelectedNumbers(new Set());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoading(false);
      removeBackgroundTask("Loading GitHub issues");
    }
  }, [projectId, stateFilter]);

  const fetchDetail = useCallback(
    async (issueNumber: number, force = false) => {
      if (!projectId) return;

      // Check cache
      if (!force) {
        const cached = detailCache.current.get(issueNumber);
        if (cached) {
          setIssueDetail(cached);
          return;
        }
      }

      setDetailLoading(true);
      try {
        // Fetch issue detail and comments in parallel using existing IPC commands
        const [issue, comments] = await Promise.all([
          invoke<GitHubIssue>("fetch_github_issue", {
            projectId,
            issueNumber,
          }),
          invoke<GitHubComment[]>("fetch_issue_comments", {
            projectId,
            issueNumber,
          }),
        ]);

        // Find import status from the issues list
        const listEntry = issues.find((i) => i.issue.number === issueNumber);

        const detail: GitHubIssueDetail = {
          issue,
          already_imported: listEntry?.already_imported ?? false,
          existing_task_id: listEntry?.existing_task_id ?? null,
          comments,
        };
        detailCache.current.set(issueNumber, detail);
        setIssueDetail(detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDetailLoading(false);
      }
    },
    [projectId, issues],
  );

  const selectIssue = useCallback(
    (issueNumber: number | null) => {
      setSelectedIssue(issueNumber);
      if (issueNumber !== null) {
        setIssueDetail(null);
        fetchDetail(issueNumber);
      } else {
        setIssueDetail(null);
      }
    },
    [fetchDetail],
  );

  const toggleSelection = useCallback((issueNumber: number) => {
    setSelectedNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(issueNumber)) {
        next.delete(issueNumber);
      } else {
        next.add(issueNumber);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const importable = issues
      .filter((i) => !i.already_imported)
      .map((i) => i.issue.number);
    setSelectedNumbers(new Set(importable));
  }, [issues]);

  const clearSelection = useCallback(() => {
    setSelectedNumbers(new Set());
  }, []);

  const importSelected = useCallback(async (): Promise<ImportResult | null> => {
    if (!projectId || selectedNumbers.size === 0) return null;
    setImporting(true);
    setError(null);
    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Importing GitHub issues");
    try {
      const issuesToImport: GitHubIssue[] = issues
        .filter(
          (i) =>
            selectedNumbers.has(i.issue.number) && !i.already_imported,
        )
        .map((i) => i.issue);

      const result = await invoke<ImportResult>("import_github_issues", {
        projectId,
        issues: issuesToImport,
      });

      // Refresh store tasks
      const tasks = await invoke<import("../../types").Task[]>("list_tasks", {
        projectId,
      });
      useAppStore.getState().setTasks(tasks);

      // Refresh issues to update import status
      await fetchIssues();

      // Invalidate detail cache for imported issues (import status changed)
      for (const num of selectedNumbers) {
        detailCache.current.delete(num);
      }

      return result;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : String(err),
      );
      return null;
    } finally {
      setImporting(false);
      removeBackgroundTask("Importing GitHub issues");
    }
  }, [projectId, selectedNumbers, issues, fetchIssues]);

  return {
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
  };
}
