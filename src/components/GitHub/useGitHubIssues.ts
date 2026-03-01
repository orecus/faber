import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  GitHubIssue,
  GitHubIssueWithImportStatus,
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
  setStateFilter: (filter: IssueStateFilter) => void;
  toggleSelection: (issueNumber: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  fetchIssues: () => Promise<void>;
  importSelected: () => Promise<ImportResult | null>;
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
    setStateFilter,
    toggleSelection,
    selectAll,
    clearSelection,
    fetchIssues,
    importSelected,
  };
}
