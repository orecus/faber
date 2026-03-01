import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitHubPR, GitHubPRDetail } from "../../types";
import { useAppStore } from "../../store/appStore";

export type PRStateFilter = "open" | "closed" | "all";

export interface UsePullRequests {
  prs: GitHubPR[];
  loading: boolean;
  error: string | null;
  stateFilter: PRStateFilter;
  selectedPR: number | null;
  prDetail: GitHubPRDetail | null;
  detailLoading: boolean;
  merging: boolean;
  closing: boolean;
  setStateFilter: (filter: PRStateFilter) => void;
  fetchPRs: () => Promise<void>;
  selectPR: (number: number | null) => void;
  mergePR: (number: number, method: string) => Promise<void>;
  closePR: (number: number) => Promise<void>;
  refreshDetail: () => Promise<void>;
}

export function usePullRequests(projectId: string | null): UsePullRequests {
  const [prs, setPRs] = useState<GitHubPR[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<PRStateFilter>("open");
  const [selectedPR, setSelectedPR] = useState<number | null>(null);
  const [prDetail, setPRDetail] = useState<GitHubPRDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [closing, setClosing] = useState(false);

  const detailCache = useRef<Map<number, GitHubPRDetail>>(new Map());

  const fetchPRs = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Loading pull requests");
    try {
      const result = await invoke<GitHubPR[]>("list_pull_requests", {
        projectId,
        stateFilter,
        limit: 100,
      });
      setPRs(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      removeBackgroundTask("Loading pull requests");
    }
  }, [projectId, stateFilter]);

  const fetchDetail = useCallback(
    async (number: number, force = false) => {
      if (!projectId) return;

      // Check cache
      if (!force) {
        const cached = detailCache.current.get(number);
        if (cached) {
          setPRDetail(cached);
          return;
        }
      }

      setDetailLoading(true);
      try {
        const detail = await invoke<GitHubPRDetail>("get_pr_detail", {
          projectId,
          number,
        });
        detailCache.current.set(number, detail);
        setPRDetail(detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDetailLoading(false);
      }
    },
    [projectId],
  );

  const selectPR = useCallback(
    (number: number | null) => {
      setSelectedPR(number);
      if (number !== null) {
        setPRDetail(null);
        fetchDetail(number);
      } else {
        setPRDetail(null);
      }
    },
    [fetchDetail],
  );

  const mergePR = useCallback(
    async (number: number, method: string) => {
      if (!projectId) return;
      setMerging(true);
      setError(null);
      const { addBackgroundTask, removeBackgroundTask } =
        useAppStore.getState();
      addBackgroundTask("Merging pull request");
      try {
        await invoke("merge_pull_request", {
          projectId,
          number,
          method,
        });
        // Invalidate cache and refresh
        detailCache.current.delete(number);
        await fetchPRs();
        setSelectedPR(null);
        setPRDetail(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setMerging(false);
        removeBackgroundTask("Merging pull request");
      }
    },
    [projectId, fetchPRs],
  );

  const closePR = useCallback(
    async (number: number) => {
      if (!projectId) return;
      setClosing(true);
      setError(null);
      const { addBackgroundTask, removeBackgroundTask } =
        useAppStore.getState();
      addBackgroundTask("Closing pull request");
      try {
        await invoke("close_pull_request", {
          projectId,
          number,
        });
        detailCache.current.delete(number);
        await fetchPRs();
        setSelectedPR(null);
        setPRDetail(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setClosing(false);
        removeBackgroundTask("Closing pull request");
      }
    },
    [projectId, fetchPRs],
  );

  const refreshDetail = useCallback(async () => {
    if (selectedPR !== null) {
      await fetchDetail(selectedPR, true);
    }
  }, [selectedPR, fetchDetail]);

  return {
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
    refreshDetail,
  };
}
