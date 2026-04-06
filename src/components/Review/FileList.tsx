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
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";

import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import SidePanel from "../ui/SidePanel";
import FileChangesContextMenu from "./FileChangesContextMenu";

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

/** Max height for the auto-growing textarea (in rows) */
const TEXTAREA_MAX_ROWS = 6;
/** Conventional subject line length limit */
const SUBJECT_WARN_LEN = 72;

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
  section,
  isSelected,
  onSelect,
  onToggleStage,
  showCheckbox,
  worktreePath,
  projectId,
  onRefresh,
}: {
  file: ChangedFile;
  section: FileSection;
  isSelected: boolean;
  onSelect: () => void;
  onToggleStage?: () => void;
  showCheckbox: boolean;
  worktreePath: string;
  projectId: string;
  onRefresh: () => void;
}) {
  const config = STATUS_CONFIG[file.status];
  const Icon = config.icon;
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.substring(0, file.path.lastIndexOf("/"))
    : null;

  return (
    <FileChangesContextMenu
      file={file}
      section={section}
      worktreePath={worktreePath}
      projectId={projectId}
      onToggleStage={onToggleStage}
      onRefresh={onRefresh}
    >
      {({ onContextMenu }) => (
        <div
          onContextMenu={onContextMenu}
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
      )}
    </FileChangesContextMenu>
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
  const accentColor = useProjectAccentColor();
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committedExpanded, setCommittedExpanded] = useState(false);
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [amendMode, setAmendMode] = useState(false);
  const [generatingMsg, setGeneratingMsg] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stagedFiles = changedFiles.filter((f) => f.staged);
  const allStaged =
    changedFiles.length > 0 && stagedFiles.length === changedFiles.length;
  const someStaged = stagedFiles.length > 0;

  // Subject line analysis
  const subjectLine = commitMsg.split("\n")[0] ?? "";
  const subjectOverflow = subjectLine.length > SUBJECT_WARN_LEN;

  const handleSelectAll = useCallback(() => {
    const shouldStage = !allStaged;
    for (const file of changedFiles) {
      if (file.staged !== shouldStage) {
        onToggleStage(file.path, file.staged);
      }
    }
  }, [changedFiles, allStaged, onToggleStage]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    // Clamp to max rows
    const lineHeight = 18; // ~text-xs line height
    const maxHeight = lineHeight * TEXTAREA_MAX_ROWS;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [commitMsg, autoResize]);

  // Load last commit message when amend is toggled on
  useEffect(() => {
    if (!amendMode) return;
    invoke<string>("get_last_commit_message", { projectId, worktreePath })
      .then((msg) => {
        setCommitMsg(msg);
        setCommitError(null);
      })
      .catch(() => {
        // No commits yet — just leave the input empty
      });
  }, [amendMode, projectId, worktreePath]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim() || committing) return;
    if (!amendMode && !someStaged) return;
    setCommitting(true);
    setCommitError(null);
    try {
      if (amendMode) {
        await invoke<string>("commit_amend", {
          projectId,
          worktreePath,
          message: commitMsg.trim(),
        });
      } else {
        await invoke<string>("commit_staged", {
          projectId,
          worktreePath,
          message: commitMsg.trim(),
        });
      }
      setCommitMsg("");
      setAmendMode(false);
      onRefresh();
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [commitMsg, someStaged, committing, amendMode, projectId, worktreePath, onRefresh]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl+Enter or Cmd+Enter to commit
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (commitMsg.trim() && (someStaged || amendMode)) {
          handleCommit();
        }
        return;
      }
      // Escape to clear
      if (e.key === "Escape") {
        e.preventDefault();
        setCommitMsg("");
        setAmendMode(false);
        setCommitError(null);
        textareaRef.current?.blur();
      }
    },
    [handleCommit, commitMsg, someStaged, amendMode],
  );

  const handleGenerateMessage = useCallback(async () => {
    if (generatingMsg || !someStaged) return;
    setGeneratingMsg(true);
    setCommitError(null);
    try {
      const diff = await invoke<string>("get_staged_diff", {
        projectId,
        worktreePath,
      });
      if (!diff.trim()) {
        setCommitError("No staged changes to summarize");
        return;
      }
      // Use a simple heuristic approach: parse the diff to generate a message
      const msg = generateCommitMessageFromDiff(diff);
      setCommitMsg(msg);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingMsg(false);
    }
  }, [generatingMsg, someStaged, projectId, worktreePath]);

  const canCommit = commitMsg.trim() && (someStaged || amendMode) && !committing;

  const hasCommitted = committedFiles.length > 0;
  const hasChanges = changedFiles.length > 0;

  return (
    <SidePanel side="left" width={250} className="h-full">
      {/* Scrollable file sections */}
      <SidePanel.Content>
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
                    section="committed"
                    isSelected={
                      selectedFile?.path === file.path &&
                      selectedFile?.section === "committed"
                    }
                    onSelect={() => onSelectFile(file.path, "committed")}
                    showCheckbox={false}
                    worktreePath={worktreePath}
                    projectId={projectId}
                    onRefresh={onRefresh}
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
              <div className="flex flex-col items-center gap-1.5 px-3 py-4 text-center">
                <CheckCircle2 className="size-5 text-muted-foreground opacity-30" />
                <span className="text-xs text-muted-foreground">No uncommitted changes</span>
              </div>
            ) : (
              changedFiles.map((file) => (
                <FileRow
                  key={`w-${file.path}`}
                  file={file}
                  section="changes"
                  isSelected={
                    selectedFile?.path === file.path &&
                    selectedFile?.section === "changes"
                  }
                  onSelect={() => onSelectFile(file.path, "changes")}
                  onToggleStage={() => onToggleStage(file.path, file.staged)}
                  showCheckbox={true}
                  worktreePath={worktreePath}
                  projectId={projectId}
                  onRefresh={onRefresh}
                />
              ))
            )}
          </div>
        )}
      </SidePanel.Content>

      {/* Commit bar */}
      <SidePanel.Footer>
        <div className="flex flex-col gap-1.5">
          {/* Textarea + sparkle button row */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={commitMsg}
              onChange={(e) => {
                setCommitMsg(e.target.value);
                setCommitError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                amendMode
                  ? "Amend commit message..."
                  : someStaged
                    ? `Commit ${stagedFiles.length} file${stagedFiles.length !== 1 ? "s" : ""}...`
                    : "Stage files to commit"
              }
              disabled={(!someStaged && !amendMode) || committing}
              rows={2}
              className="min-h-[36px] w-full resize-none rounded-[var(--radius-element)] border border-border bg-popover px-2 py-1.5 pr-8 text-xs leading-[18px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
            />
            {/* AI sparkle button */}
            <button
              type="button"
              onClick={handleGenerateMessage}
              disabled={!someStaged || generatingMsg}
              title="Generate commit message from staged changes"
              className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              {generatingMsg ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
            </button>
          </div>

          {/* Subject line warning */}
          {subjectOverflow && (
            <p className="text-2xs text-warning">
              Subject line is {subjectLine.length} chars (recommended: {SUBJECT_WARN_LEN})
            </p>
          )}

          {/* Amend toggle + commit button row */}
          <div className="flex items-center gap-1.5">
            {/* Amend toggle */}
            <button
              type="button"
              onClick={() => setAmendMode((v) => !v)}
              title={amendMode ? "Cancel amend" : "Amend last commit"}
              className={`flex items-center gap-1 rounded-[var(--radius-element)] border px-1.5 py-1 text-2xs transition-colors ${
                amendMode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              <RotateCcw className="size-3" />
              Amend
            </button>

            <div className="flex-1" />

            {/* Keyboard hint */}
            {canCommit && (
              <span className="text-2xs text-muted-foreground">
                {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+↵
              </span>
            )}

            <Button
              variant="color"
              color={accentColor}
              size="sm"
              disabled={!canCommit}
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
              {amendMode ? "Amend" : "Commit"}
            </Button>
          </div>
        </div>
        {commitError && (
          <p className="mt-1 text-2xs text-destructive">{commitError}</p>
        )}
      </SidePanel.Footer>
    </SidePanel>
  );
}

/**
 * Generate a commit message by parsing the staged diff.
 *
 * This is a lightweight local heuristic — it counts changed files and
 * categorizes them to produce a reasonable default message. A future
 * AI-powered version can replace this with an LLM call.
 */
function generateCommitMessageFromDiff(diff: string): string {
  const fileChanges: { added: string[]; modified: string[]; deleted: string[] } = {
    added: [],
    modified: [],
    deleted: [],
  };

  // Parse diff headers to extract file paths and change types
  const diffHeaderRegex = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  const newFileRegex = /^new file mode/m;
  const deletedFileRegex = /^deleted file mode/m;

  let match;
  const lines = diff.split("\n");

  while ((match = diffHeaderRegex.exec(diff)) !== null) {
    const filePath = match[2];
    // Look ahead in the next few lines for new/deleted markers
    const headerIdx = lines.findIndex((l) => l === match![0]);
    const context = lines.slice(headerIdx, headerIdx + 5).join("\n");

    if (newFileRegex.test(context)) {
      fileChanges.added.push(filePath);
    } else if (deletedFileRegex.test(context)) {
      fileChanges.deleted.push(filePath);
    } else {
      fileChanges.modified.push(filePath);
    }
  }

  const total = fileChanges.added.length + fileChanges.modified.length + fileChanges.deleted.length;

  if (total === 0) return "";

  // Build a concise subject line
  const parts: string[] = [];
  if (fileChanges.added.length > 0) {
    parts.push(
      fileChanges.added.length === 1
        ? `add ${shortName(fileChanges.added[0])}`
        : `add ${fileChanges.added.length} files`,
    );
  }
  if (fileChanges.modified.length > 0) {
    parts.push(
      fileChanges.modified.length === 1
        ? `update ${shortName(fileChanges.modified[0])}`
        : `update ${fileChanges.modified.length} files`,
    );
  }
  if (fileChanges.deleted.length > 0) {
    parts.push(
      fileChanges.deleted.length === 1
        ? `remove ${shortName(fileChanges.deleted[0])}`
        : `remove ${fileChanges.deleted.length} files`,
    );
  }

  let subject = parts.join(", ");
  // Capitalize first letter
  subject = subject.charAt(0).toUpperCase() + subject.slice(1);

  // Add body with file list if multiple files
  if (total > 1) {
    const body: string[] = ["", "Files changed:"];
    for (const f of fileChanges.added) body.push(`  + ${f}`);
    for (const f of fileChanges.modified) body.push(`  M ${f}`);
    for (const f of fileChanges.deleted) body.push(`  - ${f}`);
    return subject + "\n" + body.join("\n");
  }

  return subject;
}

function shortName(path: string): string {
  return path.split("/").pop() ?? path;
}
