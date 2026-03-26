import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from "lucide-react";
import React, { useCallback } from "react";

import { getFileIcon } from "./fileIcons";
import { useAppStore } from "../../store/appStore";
import FileContextMenu from "./FileContextMenu";
import type { FileEntry } from "../../types";

interface FileTreeItemProps {
  entry: FileEntry;
  fullPath: string;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  gitStatus?: string;
  onToggle: () => void;
  onSelect: () => void;
  /** When true, show the relative path below the filename (used in search results). */
  showRelativePath?: boolean;
}

/** Map git status to a Tailwind text color class for files. */
function getGitStatusColor(status?: string): string {
  switch (status) {
    case "added":
    case "untracked":
      return "text-success";
    case "modified":
      return "text-warning";
    case "deleted":
      return "text-destructive";
    case "renamed":
      return "text-primary";
    default:
      return "";
  }
}

/** Map git status to a dimmer color class for directories (propagated status). */
function getGitDirStatusColor(status?: string): string {
  switch (status) {
    case "added":
    case "untracked":
      return "text-success/60";
    case "modified":
      return "text-warning/60";
    case "deleted":
      return "text-destructive/60";
    case "renamed":
      return "text-primary/60";
    default:
      return "";
  }
}

const FileTreeItem = React.memo(function FileTreeItem({
  entry,
  fullPath,
  depth,
  isExpanded,
  isSelected,
  gitStatus,
  onToggle,
  onSelect,
  showRelativePath,
}: FileTreeItemProps) {
  const FileIcon = getFileIcon(entry.extension);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

  const handleClick = useCallback(() => {
    if (entry.is_dir) {
      onToggle();
    } else {
      onSelect();
      const taskLabel = `Opening ${entry.name}`;
      addBackgroundTask(taskLabel);
      invoke("open_file_in_os", { path: fullPath }).finally(() => {
        setTimeout(() => removeBackgroundTask(taskLabel), 2000);
      });
    }
  }, [entry.is_dir, entry.name, onToggle, onSelect, fullPath, addBackgroundTask, removeBackgroundTask]);

  // Determine text color based on git status
  const statusColor = entry.is_dir
    ? getGitDirStatusColor(gitStatus)
    : getGitStatusColor(gitStatus);

  // For the filename text — apply git color or default
  const nameColorClass = statusColor || "";

  return (
    <FileContextMenu
      fullPath={fullPath}
      relativePath={entry.path}
      isDir={entry.is_dir}
    >
      {({ onContextMenu }) => (
        <div
          onClick={handleClick}
          onContextMenu={onContextMenu}
          className={`flex items-center gap-1.5 h-[26px] pr-2 text-xs cursor-pointer transition-colors ${
            isSelected
              ? "bg-accent text-foreground"
              : "text-dim-foreground hover:bg-accent/50"
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          title={entry.is_dir ? entry.path : `Click to open ${entry.name}`}
        >
          {entry.is_dir ? (
            <>
              <span className="shrink-0 w-3 flex items-center justify-center text-muted-foreground">
                {isExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
              </span>
            </>
          ) : (
            <>
              <span className="shrink-0 w-3" />
              <span className="shrink-0 text-muted-foreground">
                <FileIcon size={14} />
              </span>
            </>
          )}
          <span className={`truncate min-w-0 flex-1 ${nameColorClass}`}>
            {entry.name}
            {showRelativePath && entry.path.includes("/") && (
              <span className="ml-1.5 text-muted-foreground opacity-70">
                {entry.path.slice(0, entry.path.lastIndexOf("/"))}
              </span>
            )}
          </span>

          {/* Git status dot indicator for directories */}
          {entry.is_dir && gitStatus && (
            <span
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                gitStatus === "added" || gitStatus === "untracked"
                  ? "bg-success"
                  : gitStatus === "modified"
                    ? "bg-warning"
                    : gitStatus === "deleted"
                      ? "bg-destructive"
                      : gitStatus === "renamed"
                        ? "bg-primary"
                        : ""
              }`}
            />
          )}
        </div>
      )}
    </FileContextMenu>
  );
});

export default FileTreeItem;
