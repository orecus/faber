import {
  CheckCircle2,
  Circle,
  FileEdit,
  FilePlus2,
  Loader2,
  ListChecks,
  PanelRightClose,
  Trash2,
} from "lucide-react";
import React, { useMemo } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import { getFileIcon } from "../Files/fileIcons";
import { useAppStore } from "../../store/appStore";

import type { AcpPlanEntry, AcpToolCallState, ToolCallContentItem } from "../../types";

// ── Types ──

interface FileEditEntry {
  path: string;
  /** Number of edit/write operations on this file. */
  edits: number;
  /** Whether the file was created (first operation was a write/create). */
  created: boolean;
  /** Whether the file was deleted. */
  deleted: boolean;
  /** Lines added across all diffs for this file. */
  linesAdded: number;
  /** Lines removed across all diffs for this file. */
  linesRemoved: number;
  /** File extension (for icon). */
  extension: string | null;
}

// ── Helpers ──

/** Extract file path from a tool call title (which may be JSON params). */
function extractFilePath(toolCall: AcpToolCallState): string | null {
  if (toolCall.kind !== "edit" && toolCall.kind !== "read" && toolCall.kind !== "delete") {
    return null;
  }
  // Try parsing title as JSON (MCP tools pass JSON params)
  try {
    const params = JSON.parse(toolCall.title);
    if (typeof params.file_path === "string") return params.file_path;
    if (typeof params.path === "string") return params.path;
  } catch {
    // Not JSON — title might be the file path or a description like "Edit src/foo.ts"
  }
  // Heuristic: look for path-like strings in the title
  const pathMatch = toolCall.title.match(/(?:^|\s)((?:[\w@.-]+\/)+[\w@.-]+)/);
  return pathMatch ? pathMatch[1] : null;
}

/** Get file extension from path. */
function getExtension(path: string): string | null {
  const match = path.match(/\.([^./\\]+)$/);
  return match ? match[1].toLowerCase() : null;
}

/** Compute diff stats from content items for a single file. */
function computeContentDiffStats(content?: ToolCallContentItem[]): { added: number; removed: number } {
  if (!content) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const item of content) {
    if (item.type === "diff") {
      if (item.old_text === null) {
        // New file
        added += item.new_text.split("\n").length;
      } else {
        const oldSet = new Set(item.old_text.split("\n"));
        const newSet = new Set(item.new_text.split("\n"));
        for (const line of newSet) {
          if (!oldSet.has(line)) added++;
        }
        for (const line of oldSet) {
          if (!newSet.has(line)) removed++;
        }
      }
    }
  }
  return { added, removed };
}

/** Build aggregated file edit summary from tool calls. */
function buildFileEdits(toolCalls: AcpToolCallState[]): FileEditEntry[] {
  const fileMap = new Map<string, FileEditEntry>();

  for (const tc of toolCalls) {
    if (tc.kind !== "edit" && tc.kind !== "delete") continue;
    if (tc.status === "failed") continue;

    const filePath = extractFilePath(tc);
    if (!filePath) continue;

    const diffStats = computeContentDiffStats(tc.content);
    const existing = fileMap.get(filePath);
    if (existing) {
      existing.edits += 1;
      existing.linesAdded += diffStats.added;
      existing.linesRemoved += diffStats.removed;
      if (tc.kind === "delete") existing.deleted = true;
    } else {
      fileMap.set(filePath, {
        path: filePath,
        edits: 1,
        created: tc.title.toLowerCase().includes("creat"),
        deleted: tc.kind === "delete",
        linesAdded: diffStats.added,
        linesRemoved: diffStats.removed,
        extension: getExtension(filePath),
      });
    }
  }

  return Array.from(fileMap.values());
}

/** Shorten a file path to just the filename + parent dir. */
function shortenPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, "/").split("/");
  if (parts.length <= 2) return parts.join("/");
  return `…/${parts.slice(-2).join("/")}`;
}

// ── Component ──

interface ActivityBarProps {
  sessionId: string;
  onClose: () => void;
}

export default React.memo(function ActivityBar({
  sessionId,
  onClose,
}: ActivityBarProps) {
  const planEntries = useAppStore((s) => s.acpPlans[sessionId]);
  const toolCalls = useAppStore(
    (s) => {
      const entries = s.acpEntries[sessionId];
      if (!entries) return EMPTY_TOOL_CALLS;
      return entries.filter((e): e is import("../../types").AcpToolCallEntry => e.type === "tool-call");
    },
  );
  const promptPending = useAppStore(
    (s) => s.acpPromptPending[sessionId] ?? false,
  );

  const fileEdits = useMemo(() => buildFileEdits(toolCalls), [toolCalls]);

  const hasPlan = planEntries && planEntries.length > 0;
  const hasEdits = fileEdits.length > 0;
  const hasContent = hasPlan || hasEdits;

  return (
    <div className="flex flex-col h-full w-[260px] min-w-[220px] max-w-[300px] border-l border-border/40 bg-card/60 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 shrink-0">
        <span className="text-xs font-semibold text-foreground">Activity</span>
        <button
          onClick={onClose}
          className="flex items-center justify-center size-5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Close activity bar"
        >
          <PanelRightClose size={13} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <ListChecks size={24} className="text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground/50">
              Activity will appear here as the agent works.
            </p>
          </div>
        ) : (
          <div className="py-1">
            {/* Plan summary section */}
            {hasPlan && (
              <PlanSummarySection entries={planEntries} />
            )}

            {/* File edits section */}
            {hasEdits && (
              <FileEditSection fileEdits={fileEdits} />
            )}
          </div>
        )}
      </div>

      {/* Footer — processing status */}
      <div className="px-3 py-2 border-t border-border/30 shrink-0">
        {promptPending ? (
          <div className="flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin text-primary" />
            <span className="text-[11px] text-primary font-medium">Processing…</span>
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">
            Waiting for input
          </span>
        )}
      </div>
    </div>
  );
});

const EMPTY_TOOL_CALLS: AcpToolCallState[] = [];

// ── Sub-components ──

function PlanSummarySection({
  entries,
}: {
  entries: AcpPlanEntry[];
}) {
  const completedCount = entries.filter((e) => e.status === "completed").length;
  const totalCount = entries.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
        <span className="flex items-center gap-1.5">
          <ListChecks size={12} />
          Plan
        </span>
        <span className="text-[10px] font-normal normal-case tracking-normal text-dim-foreground">
          {completedCount}/{totalCount}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Progress bar */}
        <div className="mx-3 mb-2 h-1 rounded-full bg-muted/50 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Plan items */}
        <div className="px-2 pb-2 space-y-0.5">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`flex items-start gap-1.5 rounded px-1.5 py-0.5 ${
                entry.status === "in_progress" ? "bg-primary/5" : ""
              }`}
            >
              <div className="mt-0.5 shrink-0">
                <PlanItemIcon status={entry.status} />
              </div>
              <span
                className={`text-[11px] leading-snug ${
                  entry.status === "completed"
                    ? "text-muted-foreground line-through"
                    : entry.status === "in_progress"
                      ? "text-foreground font-medium"
                      : "text-dim-foreground"
                }`}
              >
                {entry.title}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PlanItemIcon({ status }: { status: string }) {
  switch (status) {
    case "in_progress":
      return <Loader2 size={11} className="animate-spin text-primary" />;
    case "completed":
      return <CheckCircle2 size={11} className="text-success" />;
    default:
      return <Circle size={11} className="text-muted-foreground/40" />;
  }
}

function FileEditSection({ fileEdits }: { fileEdits: FileEditEntry[] }) {
  const createdCount = fileEdits.filter((f) => f.created).length;
  const modifiedCount = fileEdits.filter((f) => !f.created && !f.deleted).length;
  const deletedCount = fileEdits.filter((f) => f.deleted).length;

  // Total diff stats across all files
  const totalStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const f of fileEdits) {
      added += f.linesAdded;
      removed += f.linesRemoved;
    }
    return { added, removed };
  }, [fileEdits]);

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
        <span className="flex items-center gap-1.5">
          <FileEdit size={12} />
          Files
        </span>
        <span className="text-[10px] font-normal normal-case tracking-normal text-dim-foreground">
          {fileEdits.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Summary counts */}
        <div className="flex items-center gap-3 px-3 pb-1">
          {createdCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-success">
              <FilePlus2 size={10} />
              {createdCount} created
            </span>
          )}
          {modifiedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-primary">
              <FileEdit size={10} />
              {modifiedCount} modified
            </span>
          )}
          {deletedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-destructive">
              <Trash2 size={10} />
              {deletedCount} deleted
            </span>
          )}
        </div>

        {/* Total diff stats */}
        {(totalStats.added > 0 || totalStats.removed > 0) && (
          <div className="flex items-center gap-2 px-3 pb-1.5">
            <span className="text-[10px] text-muted-foreground/50">
              Total:
            </span>
            {totalStats.added > 0 && (
              <span className="text-[10px] text-success font-medium">
                +{totalStats.added}
              </span>
            )}
            {totalStats.removed > 0 && (
              <span className="text-[10px] text-destructive font-medium">
                −{totalStats.removed}
              </span>
            )}
          </div>
        )}

        {/* File list */}
        <div className="px-2 pb-2 space-y-0.5">
          {fileEdits.map((file) => (
            <FileEditRow key={file.path} file={file} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FileEditRow({ file }: { file: FileEditEntry }) {
  const FileTypeIcon = getFileIcon(file.extension);

  return (
    <div
      className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-dim-foreground hover:bg-accent/50 transition-colors group/file"
      title={file.path}
    >
      {/* File type icon with status color overlay */}
      <div className="relative shrink-0">
        <FileTypeIcon size={12} className={
          file.deleted
            ? "text-destructive/70"
            : file.created
              ? "text-success/70"
              : "text-primary/60"
        } />
      </div>
      {/* File name */}
      <span className={`truncate flex-1 ${file.deleted ? "line-through text-muted-foreground" : ""}`}>
        {shortenPath(file.path)}
      </span>
      {/* Per-file diff stats */}
      <span className="flex items-center gap-1 shrink-0">
        {file.linesAdded > 0 && (
          <span className="text-[9px] text-success/70 font-medium">
            +{file.linesAdded}
          </span>
        )}
        {file.linesRemoved > 0 && (
          <span className="text-[9px] text-destructive/70 font-medium">
            −{file.linesRemoved}
          </span>
        )}
        {file.linesAdded === 0 && file.linesRemoved === 0 && file.edits > 1 && (
          <span className="text-[9px] text-muted-foreground/50">
            ×{file.edits}
          </span>
        )}
      </span>
    </div>
  );
}
