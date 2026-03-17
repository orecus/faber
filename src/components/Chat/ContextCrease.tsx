import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ChevronDown,
  Copy,
  FileCode,
  FileDiff,
  FileText,
  Loader2,
  SquareTerminal,
  ChevronsUpDown,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  Terminal,
  TerminalHeader,
  TerminalTitle,
  TerminalActions,
  TerminalCopyButton,
  TerminalContent,
} from "@/components/ai-elements/terminal";

import type { ToolCallContentItem } from "../../types";

// ── Main Component ──

interface ContextCreaseProps {
  content: ToolCallContentItem;
  /** Whether this crease should be expanded by default. */
  defaultOpen?: boolean;
  /** When true, render content directly without a collapsible wrapper (for use inside already-collapsible cards). */
  flat?: boolean;
  /** Session ID — required for terminal content to fetch output via IPC. */
  sessionId?: string;
  /** Whether the parent tool call is still in progress (enables streaming indicator for terminals). */
  isStreaming?: boolean;
}

export default React.memo(function ContextCrease({
  content,
  defaultOpen = false,
  flat = false,
  sessionId,
  isStreaming = false,
}: ContextCreaseProps) {
  switch (content.type) {
    case "text":
      return <TextCrease text={content.text} defaultOpen={defaultOpen} flat={flat} />;
    case "diff":
      return (
        <DiffCrease
          path={content.path}
          oldText={content.old_text}
          newText={content.new_text}
          defaultOpen={defaultOpen}
          flat={flat}
        />
      );
    case "terminal":
      return (
        <TerminalCrease
          terminalId={content.terminal_id}
          sessionId={sessionId}
          isStreaming={isStreaming}
          defaultOpen={defaultOpen}
          flat={flat}
        />
      );
    default:
      return null;
  }
});

// ── Clickable File Path ──

function FilePath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const fileName = useMemo(() => {
    const parts = path.replace(/\\/g, "/").split("/");
    return parts.length > 1 ? `…/${parts.slice(-2).join("/")}` : path;
  }, [path]);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(path).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [path],
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-[12px] font-mono text-dim-foreground hover:text-primary transition-colors truncate text-left group/filepath"
      title={`${path}\nClick to copy path`}
    >
      <span className="truncate">{fileName}</span>
      {copied ? (
        <Check size={10} className="text-success shrink-0" />
      ) : (
        <Copy size={10} className="text-muted-foreground/0 group-hover/filepath:text-muted-foreground/50 transition-colors shrink-0" />
      )}
    </button>
  );
}

// ── Text Crease ──

/** Inner content for text crease — rendered as markdown via MessageResponse (Streamdown). */
function TextCreaseContent({ text }: { text: string }) {
  return (
    <div className="mt-1 max-h-[400px] overflow-y-auto text-sm">
      <MessageResponse mode="static">{text}</MessageResponse>
    </div>
  );
}

function TextCrease({
  text,
  defaultOpen,
  flat,
}: {
  text: string;
  defaultOpen: boolean;
  flat: boolean;
}) {
  const lineCount = useMemo(() => text.split("\n").length, [text]);
  const preview = useMemo(
    () => text.slice(0, 120).replace(/\n/g, " "),
    [text],
  );

  // Flat mode: render content directly without a collapsible wrapper
  if (flat) {
    return <TextCreaseContent text={text} />;
  }

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-accent/50 transition-colors cursor-pointer group/crease">
        <FileText size={13} className="text-muted-foreground shrink-0" />
        <span className="text-[12px] text-dim-foreground truncate flex-1 text-left">
          {preview}
        </span>
        <span className="text-[10px] text-muted-foreground/50 shrink-0">
          {lineCount} line{lineCount !== 1 ? "s" : ""}
        </span>
        <ChevronDown
          size={12}
          className="text-muted-foreground/50 transition-transform group-data-[state=open]/crease:rotate-180 shrink-0"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <TextCreaseContent text={text} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Diff Crease ──

/** Maximum consecutive context lines before collapsing. */
const CONTEXT_COLLAPSE_THRESHOLD = 4;

function DiffCrease({
  path,
  oldText,
  newText,
  defaultOpen,
  flat,
}: {
  path: string;
  oldText: string | null;
  newText: string;
  defaultOpen: boolean;
  flat: boolean;
}) {
  const [showAllContext, setShowAllContext] = useState(false);

  const diffLines = useMemo(
    () => computeSimpleDiff(oldText, newText),
    [oldText, newText],
  );

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const line of diffLines) {
      if (line.type === "add") added++;
      else if (line.type === "remove") removed++;
    }
    return { added, removed };
  }, [diffLines]);

  const isNewFile = oldText === null;

  // Compute line numbers (old and new) for the gutter
  const numberedLines = useMemo(() => {
    let oldLineNo = 1;
    let newLineNo = 1;
    return diffLines.map((line) => {
      const result = {
        ...line,
        oldLineNo: line.type === "add" ? null : oldLineNo,
        newLineNo: line.type === "remove" ? null : newLineNo,
      };
      if (line.type === "remove") oldLineNo++;
      else if (line.type === "add") newLineNo++;
      else {
        oldLineNo++;
        newLineNo++;
      }
      return result;
    });
  }, [diffLines]);

  // Collapse long runs of unchanged context lines
  const displayLines = useMemo(() => {
    if (showAllContext) return numberedLines.map((line) => ({ ...line, collapsed: false as const }));

    type DisplayLine = typeof numberedLines[number] & { collapsed: false } | { collapsed: true; count: number; fromOld: number; fromNew: number };
    const result: DisplayLine[] = [];
    let contextRun: typeof numberedLines = [];

    const flushContext = () => {
      if (contextRun.length <= CONTEXT_COLLAPSE_THRESHOLD) {
        // Show all context lines
        for (const line of contextRun) {
          result.push({ ...line, collapsed: false as const });
        }
      } else {
        // Show first 2, collapse middle, show last 2
        for (let k = 0; k < 2; k++) {
          result.push({ ...contextRun[k], collapsed: false as const });
        }
        result.push({
          collapsed: true as const,
          count: contextRun.length - 4,
          fromOld: contextRun[2].oldLineNo ?? 0,
          fromNew: contextRun[2].newLineNo ?? 0,
        });
        for (let k = contextRun.length - 2; k < contextRun.length; k++) {
          result.push({ ...contextRun[k], collapsed: false as const });
        }
      }
      contextRun = [];
    };

    for (const line of numberedLines) {
      if (line.type === "context") {
        contextRun.push(line);
      } else {
        if (contextRun.length > 0) flushContext();
        result.push({ ...line, collapsed: false as const });
      }
    }
    if (contextRun.length > 0) flushContext();

    return result;
  }, [numberedLines, showAllContext]);

  const hasCollapsed = displayLines.some((l) => l.collapsed);

  const toggleShowAll = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAllContext((v) => !v);
  }, []);

  /** The inner diff content (shared between flat and collapsible modes). */
  const diffContent = (
    <div className={`${flat ? "" : "mt-1 "}rounded-md bg-muted/30 border border-border/30 overflow-hidden`}>
      {/* Sticky file header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border/20 bg-muted/50 sticky top-0 z-10">
        <span className="text-[10px] font-mono text-muted-foreground/70 truncate" title={path}>
          {path}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {stats.added > 0 && (
            <span className="text-[10px] text-success/80">+{stats.added}</span>
          )}
          {stats.removed > 0 && (
            <span className="text-[10px] text-destructive/80">−{stats.removed}</span>
          )}
          {hasCollapsed && (
            <button
              type="button"
              onClick={toggleShowAll}
              className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-0.5"
              title={showAllContext ? "Collapse context" : "Show all lines"}
            >
              <ChevronsUpDown size={10} />
              {showAllContext ? "Collapse" : "Expand all"}
            </button>
          )}
        </div>
      </div>

      {/* Diff lines with line number gutters */}
      <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
        <pre className="text-[11px] leading-relaxed font-mono">
          {displayLines.map((line, i) =>
            line.collapsed ? (
              <div
                key={`collapse-${i}`}
                className="flex items-center gap-2 px-3 py-1 bg-accent/20 border-y border-border/15 text-muted-foreground/40 text-[10px] cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={toggleShowAll}
              >
                <ChevronsUpDown size={10} />
                <span>
                  {line.count} unchanged line{line.count !== 1 ? "s" : ""} hidden
                </span>
              </div>
            ) : (
              <div
                key={i}
                className={`flex ${DIFF_LINE_STYLES[line.type]}`}
              >
                {/* Line number gutters */}
                <span className="select-none text-[10px] text-muted-foreground/25 w-8 text-right pr-1 shrink-0 border-r border-border/10 self-stretch flex items-center justify-end">
                  {line.oldLineNo ?? ""}
                </span>
                <span className="select-none text-[10px] text-muted-foreground/25 w-8 text-right pr-1 shrink-0 border-r border-border/10 self-stretch flex items-center justify-end">
                  {line.newLineNo ?? ""}
                </span>
                {/* +/- indicator */}
                <span className="select-none text-muted-foreground/40 w-5 text-center shrink-0">
                  {line.type === "add"
                    ? "+"
                    : line.type === "remove"
                      ? "-"
                      : " "}
                </span>
                {/* Line content */}
                <span className="flex-1 px-1 py-px whitespace-pre">
                  {line.text}
                </span>
              </div>
            ),
          )}
        </pre>
      </div>
    </div>
  );

  // Flat mode: render diff content directly without a collapsible wrapper
  if (flat) {
    return diffContent;
  }

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-accent/50 transition-colors cursor-pointer group/crease">
        {isNewFile ? (
          <FileCode size={13} className="text-success shrink-0" />
        ) : (
          <FileDiff size={13} className="text-primary shrink-0" />
        )}
        <div className="flex-1 min-w-0 text-left">
          <FilePath path={path} />
        </div>
        <span className="flex items-center gap-1.5 shrink-0">
          {stats.added > 0 && (
            <span className="text-[10px] text-success font-medium">
              +{stats.added}
            </span>
          )}
          {stats.removed > 0 && (
            <span className="text-[10px] text-destructive font-medium">
              −{stats.removed}
            </span>
          )}
        </span>
        <ChevronDown
          size={12}
          className="text-muted-foreground/50 transition-transform group-data-[state=open]/crease:rotate-180 shrink-0"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {diffContent}
      </CollapsibleContent>
    </Collapsible>
  );
}

const DIFF_LINE_STYLES: Record<string, string> = {
  context: "text-dim-foreground",
  add: "bg-success/8 text-success",
  remove: "bg-destructive/8 text-destructive",
};

// ── Terminal Crease ──

/** Poll interval for fetching terminal output while streaming (ms). */
const TERMINAL_POLL_INTERVAL = 1000;

function TerminalCrease({
  terminalId,
  sessionId,
  isStreaming,
  defaultOpen,
  flat,
}: {
  terminalId: string;
  sessionId?: string;
  isStreaming: boolean;
  defaultOpen: boolean;
  flat: boolean;
}) {
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accumulatedRef = useRef("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasFetchedRef = useRef(false);

  const fetchOutput = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await invoke<{ output: string }>("get_acp_terminal_output", {
        sessionId,
        terminalId,
      });
      if (result.output) {
        // Backend drains buffer on read — accumulate on frontend
        accumulatedRef.current += result.output;
        setOutput(accumulatedRef.current);
      }
      setError(null);
    } catch (e) {
      // Only set error if we haven't fetched anything yet
      if (!accumulatedRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [sessionId, terminalId]);

  // Initial fetch + polling while streaming
  useEffect(() => {
    if (!sessionId) return;

    // Initial fetch
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      setLoading(true);
      fetchOutput().finally(() => setLoading(false));
    }

    // Poll while streaming
    if (isStreaming) {
      pollingRef.current = setInterval(fetchOutput, TERMINAL_POLL_INTERVAL);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [sessionId, isStreaming, fetchOutput]);

  // Final fetch when streaming stops (to get remaining output)
  useEffect(() => {
    if (!isStreaming && hasFetchedRef.current && sessionId) {
      fetchOutput();
    }
  }, [isStreaming, sessionId, fetchOutput]);

  // No sessionId — show a minimal fallback
  if (!sessionId) {
    return (
      <div className={`${flat ? "" : "mt-1 "}rounded-md bg-zinc-950/80 border border-border/30 overflow-hidden px-3 py-2`}>
        <span className="text-[11px] font-mono text-white/30">
          Terminal {terminalId}
        </span>
      </div>
    );
  }

  const hasOutput = output.length > 0;
  const lineCount = hasOutput ? output.split("\n").length : 0;

  const terminalContent = (
    <div className={`${flat ? "" : "mt-1 "}overflow-hidden rounded-md`}>
      {loading && !hasOutput ? (
        <div className="flex items-center gap-2 rounded-md bg-zinc-950/80 border border-border/30 px-3 py-3">
          <Loader2 size={12} className="animate-spin text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Loading terminal output…</span>
        </div>
      ) : error && !hasOutput ? (
        <div className="rounded-md bg-zinc-950/80 border border-border/30 px-3 py-2 text-[11px] font-mono text-destructive/70">
          {error}
        </div>
      ) : (
        <Terminal
          output={output}
          isStreaming={isStreaming}
          autoScroll
          className="border-border/30 text-[11px]"
        >
          <TerminalHeader className="border-zinc-800/60 px-3 py-1.5">
            <TerminalTitle className="text-[11px] text-zinc-500">
              {terminalId}
            </TerminalTitle>
            <TerminalActions>
              {isStreaming && (
                <span className="text-[10px] text-primary/70 flex items-center gap-1 mr-1">
                  <Loader2 size={10} className="animate-spin" />
                  Running
                </span>
              )}
              <TerminalCopyButton className="size-6" />
            </TerminalActions>
          </TerminalHeader>
          <TerminalContent className="max-h-[300px] p-3 text-[11px] leading-relaxed" />
        </Terminal>
      )}
    </div>
  );

  // Flat mode: render terminal content directly
  if (flat) {
    return terminalContent;
  }

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-accent/50 transition-colors cursor-pointer group/crease">
        <SquareTerminal size={13} className="text-muted-foreground shrink-0" />
        <span className="text-[12px] text-dim-foreground flex-1 text-left">
          Terminal output
        </span>
        {isStreaming && (
          <Loader2 size={10} className="animate-spin text-primary shrink-0" />
        )}
        {!isStreaming && hasOutput && (
          <span className="text-[10px] text-muted-foreground/50 shrink-0">
            {lineCount} line{lineCount !== 1 ? "s" : ""}
          </span>
        )}
        <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">
          {terminalId}
        </span>
        <ChevronDown
          size={12}
          className="text-muted-foreground/50 transition-transform group-data-[state=open]/crease:rotate-180 shrink-0"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {terminalContent}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Diff Helpers ──

interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

/**
 * Compute a simple line-by-line diff between old and new text.
 * Uses a basic LCS approach for small files, falls back to showing
 * all-removed + all-added for very large diffs.
 */
function computeSimpleDiff(
  oldText: string | null,
  newText: string,
): DiffLine[] {
  if (oldText === null) {
    // New file — all lines are additions
    return newText.split("\n").map((line) => ({ type: "add", text: line }));
  }

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // For large files, use a simple fallback
  if (oldLines.length + newLines.length > 2000) {
    return [
      ...oldLines.map((line): DiffLine => ({ type: "remove", text: line })),
      ...newLines.map((line): DiffLine => ({ type: "add", text: line })),
    ];
  }

  // Simple LCS-based diff
  return lcsBasedDiff(oldLines, newLines);
}

/** LCS-based line diff producing context/add/remove lines. */
function lcsBasedDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table (space-optimized is possible but clarity wins here)
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "context", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "add", text: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: "remove", text: oldLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}
