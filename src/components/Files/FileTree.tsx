import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FileTreeItem from "./FileTreeItem";
import type { ChangedFile, FileEntry } from "../../types";

interface FileTreeProps {
  projectPath: string;
  projectId: string;
  filterText?: string;
}

/** Priority for propagating git status to parent directories. Higher = more important. */
const STATUS_PRIORITY: Record<string, number> = {
  deleted: 5,
  modified: 4,
  added: 3,
  untracked: 2,
  renamed: 1,
};

/**
 * Build a map of relative file paths → git status, plus propagate status to parent dirs.
 * Returns [fileStatusMap, dirStatusMap].
 */
function buildGitStatusMaps(
  changedFiles: ChangedFile[],
): [Record<string, string>, Record<string, string>] {
  const fileMap: Record<string, string> = {};
  const dirMap: Record<string, string> = {};

  for (const f of changedFiles) {
    // Normalize path separators
    const normalized = f.path.replace(/\\/g, "/");
    fileMap[normalized] = f.status;

    // Walk up parent directories
    const parts = normalized.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parentPath = parts.slice(0, i).join("/");
      const existing = dirMap[parentPath];
      const existingPriority = existing ? (STATUS_PRIORITY[existing] ?? 0) : 0;
      const newPriority = STATUS_PRIORITY[f.status] ?? 0;
      if (newPriority > existingPriority) {
        dirMap[parentPath] = f.status;
      }
    }
  }

  return [fileMap, dirMap];
}

/** Max search results to show */
const MAX_SEARCH_RESULTS = 100;

export default function FileTree({ projectPath, projectId, filterText = "" }: FileTreeProps) {
  // Directory contents cache: path → entries
  const [dirCache, setDirCache] = useState<Record<string, FileEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [gitFileStatus, setGitFileStatus] = useState<Record<string, string>>(
    {},
  );
  const [gitDirStatus, setGitDirStatus] = useState<Record<string, string>>({});
  const prevProjectPath = useRef(projectPath);

  // File index for search — preloaded flat list of all project files
  const [fileIndex, setFileIndex] = useState<FileEntry[] | null>(null);
  const [indexing, setIndexing] = useState(false);

  const filter = filterText.trim().toLowerCase();
  const isFiltering = filter.length > 0;

  // Preload file index in the background after root directory loads
  useEffect(() => {
    setIndexing(true);
    invoke<FileEntry[]>("index_project_files", { projectRoot: projectPath })
      .then((files) => {
        setFileIndex(files);
        setIndexing(false);
      })
      .catch(() => {
        setFileIndex([]);
        setIndexing(false);
      });
  }, [projectPath]);

  // Client-side filtered results from the preloaded index
  const searchResults = useMemo(() => {
    if (!isFiltering || !fileIndex) return null;
    const results: FileEntry[] = [];
    for (const entry of fileIndex) {
      if (entry.name.toLowerCase().includes(filter)) {
        results.push(entry);
        if (results.length >= MAX_SEARCH_RESULTS) break;
      }
    }
    return results;
  }, [filter, isFiltering, fileIndex]);

  // Fetch git status for the project
  const fetchGitStatus = useCallback(async () => {
    try {
      const files = await invoke<ChangedFile[]>("get_changed_files", {
        projectId,
        worktreePath: projectPath,
      });
      const [fileMap, dirMap] = buildGitStatusMaps(files);
      setGitFileStatus(fileMap);
      setGitDirStatus(dirMap);
    } catch {
      // Silently ignore — git status is a nice-to-have
      setGitFileStatus({});
      setGitDirStatus({});
    }
  }, [projectId, projectPath]);

  // Load a directory's contents
  const loadDirectory = useCallback(
    async (dirPath: string) => {
      // Skip if already cached
      if (dirCache[dirPath]) return;

      setLoading((prev) => new Set(prev).add(dirPath));
      try {
        const entries = await invoke<FileEntry[]>("list_directory", {
          path: dirPath,
          projectRoot: projectPath,
        });
        setDirCache((prev) => ({ ...prev, [dirPath]: entries }));
        setError(null);
      } catch (e) {
        if (dirPath === projectPath) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [dirCache, projectPath],
  );

  // Load root directory on mount or project change
  useEffect(() => {
    if (prevProjectPath.current !== projectPath) {
      // Reset state on project change
      setDirCache({});
      setExpandedDirs(new Set());
      setError(null);
      setSelectedPath(null);
      setGitFileStatus({});
      setGitDirStatus({});
      setFileIndex(null);
      prevProjectPath.current = projectPath;
    }
    // Always load root
    invoke<FileEntry[]>("list_directory", {
      path: projectPath,
      projectRoot: projectPath,
    })
      .then((entries) => {
        setDirCache((prev) => ({ ...prev, [projectPath]: entries }));
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    // Fetch initial git status
    fetchGitStatus();
  }, [projectPath, fetchGitStatus]);

  // Auto-refresh git status and re-index on mcp-files-changed events
  useEffect(() => {
    const unlisten = listen("mcp-files-changed", () => {
      fetchGitStatus();
      // Re-index when files change
      invoke<FileEntry[]>("index_project_files", { projectRoot: projectPath })
        .then(setFileIndex)
        .catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchGitStatus, projectPath]);

  const toggleDir = useCallback(
    (dirFullPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirFullPath)) {
          next.delete(dirFullPath);
        } else {
          next.add(dirFullPath);
          // Load directory contents if not cached
          loadDirectory(dirFullPath);
        }
        return next;
      });
    },
    [loadDirectory],
  );

  const handleSelect = useCallback((filePath: string) => {
    setSelectedPath((prev) => (prev === filePath ? null : filePath));
  }, []);

  // Render a directory's entries recursively (normal tree mode)
  const renderEntries = (
    parentPath: string,
    depth: number,
  ): React.ReactNode[] => {
    const entries = dirCache[parentPath];
    if (!entries) return [];

    const nodes: React.ReactNode[] = [];

    for (const entry of entries) {
      const fullPath = parentPath + "/" + entry.name;
      const isExpanded = expandedDirs.has(fullPath);

      // Look up git status — for files use entry.path (relative), for dirs use relative path
      const gitStatus = entry.is_dir
        ? gitDirStatus[entry.path]
        : gitFileStatus[entry.path];

      nodes.push(
        <FileTreeItem
          key={fullPath}
          entry={entry}
          fullPath={fullPath}
          depth={depth}
          isExpanded={isExpanded}
          isSelected={selectedPath === fullPath}
          gitStatus={gitStatus}
          onToggle={() => toggleDir(fullPath)}
          onSelect={() => handleSelect(fullPath)}
        />,
      );

      // Render children if expanded directory
      if (entry.is_dir && isExpanded) {
        const isLoading = loading.has(fullPath);
        if (isLoading && !dirCache[fullPath]) {
          nodes.push(
            <div
              key={`${fullPath}-loading`}
              className="flex items-center gap-1.5 h-[26px] text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              <Loader2 size={12} className="animate-spin" />
              <span>Loading…</span>
            </div>,
          );
        } else {
          const children = renderEntries(fullPath, depth + 1);
          if (children.length === 0 && dirCache[fullPath]) {
            nodes.push(
              <div
                key={`${fullPath}-empty`}
                className="h-[26px] flex items-center text-xs text-muted-foreground italic"
                style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              >
                Empty folder
              </div>,
            );
          } else {
            nodes.push(...children);
          }
        }
      }
    }

    return nodes;
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <p className="text-xs text-destructive text-center">{error}</p>
      </div>
    );
  }

  // Search results mode — flat list filtered from preloaded index
  if (isFiltering) {
    // Index still loading
    if (indexing || !fileIndex) {
      return (
        <div className="flex items-center gap-1.5 justify-center h-32 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
          <span>Indexing project files…</span>
        </div>
      );
    }

    if (!searchResults || searchResults.length === 0) {
      return (
        <div className="flex items-center justify-center h-32">
          <p className="text-xs text-muted-foreground">No matching files</p>
        </div>
      );
    }

    return (
      <div className="py-1">
        {searchResults.map((entry) => {
          const fullPath = projectPath + "/" + entry.path;
          const gitStatus = gitFileStatus[entry.path];

          return (
            <FileTreeItem
              key={fullPath}
              entry={entry}
              fullPath={fullPath}
              depth={0}
              isExpanded={false}
              isSelected={selectedPath === fullPath}
              gitStatus={gitStatus}
              onToggle={() => {}}
              onSelect={() => handleSelect(fullPath)}
              showRelativePath
            />
          );
        })}
      </div>
    );
  }

  // Normal tree mode
  if (!dirCache[projectPath]) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const treeNodes = renderEntries(projectPath, 0);

  return (
    <div className="py-1">
      {treeNodes.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <p className="text-xs text-muted-foreground">No files found</p>
        </div>
      ) : (
        treeNodes
      )}
    </div>
  );
}
