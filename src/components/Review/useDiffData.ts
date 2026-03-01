import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChangedFile } from "../../types";

export type FileSection = "committed" | "changes";

interface DiffData {
  /** Files committed on this branch vs main */
  committedFiles: ChangedFile[];
  /** Uncommitted changes (staged + unstaged + untracked) */
  changedFiles: ChangedFile[];
  /** Which file is selected, and from which section */
  selectedFile: { path: string; section: FileSection } | null;
  rawDiff: string;
  loading: boolean;
  error: string | null;
  selectFile: (path: string, section: FileSection) => void;
  clearSelection: () => void;
  refresh: () => void;
  toggleStageFile: (filePath: string, currentlyStaged: boolean) => void;
}

export function useDiffData(worktreePath: string | null, projectId: string | null): DiffData {
  const [committedFiles, setCommittedFiles] = useState<ChangedFile[]>([]);
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    section: FileSection;
  } | null>(null);
  const [rawDiff, setRawDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPath = useRef(worktreePath);
  currentPath.current = worktreePath;

  const fetchFileLists = useCallback(async () => {
    if (!worktreePath || !projectId) return;
    try {
      const [branch, changed] = await Promise.all([
        invoke<ChangedFile[]>("get_branch_files", { projectId, worktreePath }),
        invoke<ChangedFile[]>("get_changed_files", { projectId, worktreePath }),
      ]);
      if (currentPath.current === worktreePath) {
        setCommittedFiles(branch);
        setChangedFiles(changed);
      }
    } catch (err) {
      if (currentPath.current === worktreePath) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [worktreePath, projectId]);

  const fetchDiff = useCallback(
    async (
      file: { path: string; section: FileSection } | null,
    ) => {
      if (!worktreePath || !projectId) return;
      setLoading(true);
      setError(null);

      try {
        let diff: string;
        if (file?.section === "committed") {
          // Diff committed file against base branch
          diff = await invoke<string>("get_branch_diff", {
            projectId,
            worktreePath,
            filePath: file.path,
          });
        } else if (file?.section === "changes") {
          // Diff specific uncommitted file against HEAD
          diff = await invoke<string>("get_file_diff", {
            projectId,
            worktreePath,
            filePath: file.path,
          });
        } else {
          // No selection — show full branch diff + working tree diff
          const [branchDiff, workingDiff] = await Promise.all([
            invoke<string>("get_branch_diff", { projectId, worktreePath, filePath: null }),
            invoke<string>("get_file_diff", { projectId, worktreePath, filePath: null }),
          ]);
          const parts = [branchDiff, workingDiff].filter((d) => d.trim());
          diff = parts.join("\n");
        }

        if (currentPath.current === worktreePath) {
          setRawDiff(diff);
        }
      } catch (err) {
        if (currentPath.current === worktreePath) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (currentPath.current === worktreePath) {
          setLoading(false);
        }
      }
    },
    [worktreePath, projectId],
  );

  // Fetch on worktree change
  useEffect(() => {
    setSelectedFile(null);
    setCommittedFiles([]);
    setChangedFiles([]);
    setRawDiff("");
    if (worktreePath) {
      fetchFileLists();
      fetchDiff(null);
    }
  }, [worktreePath, fetchFileLists, fetchDiff]);

  const selectFile = useCallback(
    (path: string, section: FileSection) => {
      // Toggle: clicking same file deselects it
      const isSame =
        selectedFile?.path === path && selectedFile?.section === section;
      const next = isSame ? null : { path, section };
      setSelectedFile(next);
      fetchDiff(next);
    },
    [selectedFile, fetchDiff],
  );

  const clearSelection = useCallback(() => {
    setSelectedFile(null);
    fetchDiff(null);
  }, [fetchDiff]);

  const refresh = useCallback(() => {
    fetchFileLists();
    fetchDiff(selectedFile);
  }, [fetchFileLists, fetchDiff, selectedFile]);

  const toggleStageFile = useCallback(
    async (filePath: string, currentlyStaged: boolean) => {
      if (!worktreePath || !projectId) return;
      try {
        if (currentlyStaged) {
          await invoke("unstage_file", { projectId, worktreePath, filePath });
        } else {
          await invoke("stage_file", { projectId, worktreePath, filePath });
        }
        // Refresh file list to reflect new staging state
        const changed = await invoke<ChangedFile[]>("get_changed_files", {
          projectId,
          worktreePath,
        });
        if (currentPath.current === worktreePath) {
          setChangedFiles(changed);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [worktreePath, projectId],
  );

  return {
    committedFiles,
    changedFiles,
    selectedFile,
    rawDiff,
    loading,
    error,
    selectFile,
    clearSelection,
    refresh,
    toggleStageFile,
  };
}
