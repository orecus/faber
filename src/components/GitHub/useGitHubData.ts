import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommitInfo, CommitDetail, RefInfo, CommitRefEntry } from "../../types";
import type { GraphNode } from "../../lib/graphLayout";
import { useAppStore, type ProjectGitData } from "../../store/appStore";

const PAGE_SIZE = 50;

const emptyGitData: ProjectGitData = {
  commits: [],
  graphNodes: [],
  headHash: null,
  refs: new Map(),
  hasMore: true,
  allBranches: true,
};

export interface GitHubData {
  commits: CommitInfo[];
  graphNodes: GraphNode[];
  headHash: string | null;
  refs: Map<string, RefInfo>;
  selectedCommitHash: string | null;
  selectedDetail: CommitDetail | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  allBranches: boolean;
  setAllBranches: (v: boolean) => void;
  loadCommits: () => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  selectCommit: (hash: string | null) => void;
  fetchRefsForCommits: (hashes: string[]) => void;
}

export function useGitHubData(projectId: string | null): GitHubData {
  // Read persisted git data from the Zustand store
  const gitData = useAppStore(
    (s) => (projectId ? s.projectGitData[projectId] : undefined) ?? emptyGitData,
  );
  const updateProjectGitData = useAppStore((s) => s.updateProjectGitData);

  const { commits, graphNodes, headHash, refs, hasMore, allBranches } = gitData;

  // Local UI-only state (transient per mount)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transient refs (per-mount, not persisted)
  const refsInFlight = useRef(new Set<string>());
  const fetchedRefs = useRef(new Set<string>());
  const detailCache = useRef(new Map<string, CommitDetail>());

  const setAllBranches = useCallback(
    (v: boolean) => {
      if (!projectId) return;
      updateProjectGitData(projectId, { allBranches: v });
    },
    [projectId, updateProjectGitData],
  );

  const loadCommits = useCallback(async () => {
    if (!projectId) return;
    const currentAllBranches = useAppStore.getState().projectGitData[projectId]?.allBranches ?? true;
    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Loading commit history");
    setLoading(true);
    setError(null);
    try {
      const [newCommits, head] = await Promise.all([
        invoke<CommitInfo[]>("git_commit_log", {
          projectId,
          maxCount: PAGE_SIZE,
          skip: 0,
          allBranches: currentAllBranches,
        }),
        invoke<string>("git_head_hash", { projectId }),
      ]);
      updateProjectGitData(projectId, {
        commits: newCommits,
        headHash: head,
        hasMore: newCommits.length >= PAGE_SIZE,
        refs: new Map(),
      });
      refsInFlight.current.clear();
      fetchedRefs.current.clear();
      detailCache.current.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      removeBackgroundTask("Loading commit history");
    }
  }, [projectId, updateProjectGitData]);

  const loadMore = useCallback(async () => {
    if (!projectId || loadingMore) return;
    const current = useAppStore.getState().projectGitData[projectId];
    if (!current?.hasMore) return;
    const currentAllBranches = current.allBranches;
    const skip = current.commits.length;
    setLoadingMore(true);
    try {
      const moreCommits = await invoke<CommitInfo[]>("git_commit_log", {
        projectId,
        maxCount: PAGE_SIZE,
        skip,
        allBranches: currentAllBranches,
      });
      const updatedHasMore = moreCommits.length >= PAGE_SIZE;
      if (moreCommits.length > 0) {
        updateProjectGitData(projectId, {
          commits: [...current.commits, ...moreCommits],
          hasMore: updatedHasMore,
        });
      } else {
        updateProjectGitData(projectId, { hasMore: false });
      }
    } catch {
      // Silently fail on load-more
    } finally {
      setLoadingMore(false);
    }
  }, [projectId, loadingMore, updateProjectGitData]);

  const refresh = useCallback(async () => {
    setSelectedCommitHash(null);
    setSelectedDetail(null);
    await loadCommits();
  }, [loadCommits]);

  const selectCommit = useCallback(
    (hash: string | null) => {
      if (hash === selectedCommitHash) {
        setSelectedCommitHash(null);
        setSelectedDetail(null);
        return;
      }
      setSelectedCommitHash(hash);
      if (!hash || !projectId) {
        setSelectedDetail(null);
        return;
      }
      // Check cache
      const cachedDetail = detailCache.current.get(hash);
      if (cachedDetail) {
        setSelectedDetail(cachedDetail);
        return;
      }
      // Fetch detail
      setSelectedDetail(null);
      invoke<CommitDetail>("git_commit_detail", { projectId, commitHash: hash })
        .then((detail) => {
          detailCache.current.set(hash, detail);
          setSelectedDetail(detail);
        })
        .catch(() => {});
    },
    [projectId, selectedCommitHash],
  );

  const fetchRefsForCommits = useCallback(
    (hashes: string[]) => {
      if (!projectId) return;

      // Filter to hashes we haven't already fetched or have in-flight
      const toFetch = hashes.filter(
        (h) => !fetchedRefs.current.has(h) && !refsInFlight.current.has(h),
      );
      if (toFetch.length === 0) return;

      // Mark all as in-flight + fetched
      for (const h of toFetch) {
        fetchedRefs.current.add(h);
        refsInFlight.current.add(h);
      }

      // Single batch IPC call instead of N individual calls
      invoke<CommitRefEntry[]>("git_refs_batch", {
        projectId,
        commitHashes: toFetch,
      })
        .then((entries) => {
          if (entries.length > 0) {
            const current = useAppStore.getState().projectGitData[projectId];
            if (current) {
              const nextRefs = new Map(current.refs);
              for (const entry of entries) {
                nextRefs.set(entry.hash, entry.refs);
              }
              updateProjectGitData(projectId, { refs: nextRefs });
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          for (const h of toFetch) {
            refsInFlight.current.delete(h);
          }
        });
    },
    [projectId, updateProjectGitData],
  );

  return {
    commits,
    graphNodes,
    headHash,
    refs,
    selectedCommitHash,
    selectedDetail,
    loading,
    loadingMore,
    error,
    hasMore,
    allBranches,
    setAllBranches,
    loadCommits,
    loadMore,
    refresh,
    selectCommit,
    fetchRefsForCommits,
  };
}
