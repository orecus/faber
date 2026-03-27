import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePen,
  FilePlus2,
  FileQuestion,
  FileSymlink,
  FileX2,
  GitCommitVertical,
  Loader2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";

import { useTheme } from "../../contexts/ThemeContext";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";

import type { ChangedFile } from "../../types";
import type { FileSection } from "./useDiffData";

const STATUS_CONFIG: Record<
  ChangedFile["status"],
  { color: string; icon: typeof FilePlus2; label: string }
> = {
  added: {
    color: "var(--success)",
    icon: FilePlus2,
    label: "A",
  },
  modified: {
    color: "var(--warning)",
    icon: FilePen,
    label: "M",
  },
  deleted: {
    color: "var(--destructive)",
    icon: FileX2,
    label: "D",
  },
  renamed: {
    color: "var(--primary)",
    icon: FileSymlink,
    label: "R",
  },
  untracked: {
    color: "var(--muted-foreground)",
    icon: FileQuestion,
    label: "?",
  },
};

interface FileListProps {
  committedFiles: ChangedFile[];
  changedFiles: ChangedFile[];
  selectedFile: { path: string; section: FileSection } | null;
  worktreePath: string;
  projectId: string;
  onSelectFile: (path: string, section: FileSection) => void;
  onToggleStage: (filePath: string, currentlyStaged: boolean) => void;
  onRefresh: () => void;
}

function FileRow({
  file,
  isSelected,
  onSelect,
  onToggleStage,
  showCheckbox,
}: {
  file: ChangedFile;
  isSelected: boolean;
  onSelect: () => void;
  onToggleStage?: () => void;
  showCheckbox: boolean;
}) {
  const config = STATUS_CONFIG[file.status];
  const Icon = config.icon;
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.substring(0, file.path.lastIndexOf("/"))
    : null;

  return (
    <div
      className={`group flex cursor-pointer items-center gap-1.5 px-3 py-1 text-xs transition-colors ${
        isSelected
          ? "bg-accent text-foreground"
          : "text-dim-foreground hover:bg-accent"
      }`}
    >
      {/* Stage checkbox (only for changes section) */}
      {showCheckbox ? (
        <Checkbox
          checked={file.staged}
          onCheckedChange={() => onToggleStage?.()}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          className="size-3.5 shrink-0"
        />
      ) : (
        <CheckCircle2 className="size-3.5 shrink-0 text-success opacity-50" />
      )}

      {/* Status icon */}
      <Icon className="size-3.5 shrink-0" style={{ color: config.color }} />

      {/* File name */}
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-baseline gap-1 truncate text-left"
      >
        <span className="truncate font-mono text-xs">{fileName}</span>
        {dirPath && (
          <span className="truncate text-2xs text-muted-foreground">
            {dirPath}
          </span>
        )}
      </button>

      {/* Status badge */}
      <span
        className="shrink-0 rounded px-1 py-px text-2xs font-bold leading-none"
        style={{
          color: config.color,
          background: `color-mix(in oklch, ${config.color} 15%, transparent)`,
        }}
      >
        {config.label}
      </span>
    </div>
  );
}

export default function FileList({
  committedFiles,
  changedFiles,
  selectedFile,
  worktreePath,
  projectId,
  onSelectFile,
  onToggleStage,
  onRefresh,
}: FileListProps) {
  const { isGlass } = useTheme();
  const accentColor = useProjectAccentColor();
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committedExpanded, setCommittedExpanded] = useState(false);
  const [changesExpanded, setChangesExpanded] = useState(true);

  const stagedFiles = changedFiles.filter((f) => f.staged);
  const allStaged =
    changedFiles.length > 0 && stagedFiles.length === changedFiles.length;
  const someStaged = stagedFiles.length > 0;

  const handleSelectAll = useCallback(() => {
    const shouldStage = !allStaged;
    for (const file of changedFiles) {
      if (file.staged !== shouldStage) {
        onToggleStage(file.path, file.staged);
      }
    }
  }, [changedFiles, allStaged, onToggleStage]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim() || !someStaged || committing) return;
    setCommitting(true);
    setCommitError(null);
    try {
      await invoke<string>("commit_staged", {
        projectId,
        worktreePath,
        message: commitMsg.trim(),
      });
      setCommitMsg("");
      onRefresh();
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [commitMsg, someStaged, committing, worktreePath, onRefresh]);

  const handleCommitKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && commitMsg.trim() && someStaged) {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit, commitMsg, someStaged],
  );

  const hasCommitted = committedFiles.length > 0;
  const hasChanges = changedFiles.length > 0;

  return (
    <div
      className={`flex h-full w-[250px] shrink-0 flex-col border-r border-border ${glassStyles[isGlass ? "normal" : "solid"]}`}
    >
      {/* Scrollable file sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Committed section */}
        {hasCommitted && (
          <>
            <div
              className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 hover:bg-accent/30"
              onClick={() => setCommittedExpanded((v) => !v)}
            >
              {committedExpanded ? (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              )}
              <CheckCircle2 className="size-3 text-success opacity-60" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Committed
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {committedFiles.length}
              </span>
            </div>
            {committedExpanded && (
              <div className="py-1">
                {committedFiles.map((file) => (
                  <FileRow
                    key={`c-${file.path}`}
                    file={file}
                    isSelected={
                      selectedFile?.path === file.path &&
                      selectedFile?.section === "committed"
                    }
                    onSelect={() => onSelectFile(file.path, "committed")}
                    showCheckbox={false}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Changes section */}
        <div
          className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 hover:bg-accent/30"
          onClick={() => setChangesExpanded((v) => !v)}
        >
          {changesExpanded ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )}
          {hasChanges && (
            <Checkbox
              checked={allStaged}
              indeterminate={someStaged && !allStaged}
              onCheckedChange={handleSelectAll}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="size-3.5"
            />
          )}
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Changes
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {someStaged && `${stagedFiles.length}/`}
            {changedFiles.length}
          </span>
        </div>
        {changesExpanded && (
          <div className="py-1">
            {!hasChanges ? (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                No uncommitted changes
              </div>
            ) : (
              changedFiles.map((file) => (
                <FileRow
                  key={`w-${file.path}`}
                  file={file}
                  isSelected={
                    selectedFile?.path === file.path &&
                    selectedFile?.section === "changes"
                  }
                  onSelect={() => onSelectFile(file.path, "changes")}
                  onToggleStage={() => onToggleStage(file.path, file.staged)}
                  showCheckbox={true}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Commit bar */}
      <div className="border-t border-border p-2">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={commitMsg}
            onChange={(e) => {
              setCommitMsg(e.target.value);
              setCommitError(null);
            }}
            onKeyDown={handleCommitKeyDown}
            placeholder={
              someStaged
                ? `Commit ${stagedFiles.length} file${stagedFiles.length !== 1 ? "s" : ""}...`
                : "Stage files to commit"
            }
            disabled={!someStaged || committing}
            className="min-w-0 flex-1 rounded-[var(--radius-element)] border border-border bg-popover px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
          />
          <Button
            variant="color"
            color={accentColor}
            size="sm"
            disabled={!someStaged || !commitMsg.trim() || committing}
            onClick={handleCommit}
            leftIcon={
              committing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <GitCommitVertical className="size-3" />
              )
            }
            hoverEffect="scale-glow"
            clickEffect="scale"
            className="shrink-0 px-2 text-xs"
          >
            Commit
          </Button>
        </div>
        {commitError && (
          <p className="mt-1 text-2xs text-destructive">{commitError}</p>
        )}
      </div>
    </div>
  );
}
