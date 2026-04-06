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

import { DiffRenderer, fromTexts } from "@/components/Diff";
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
      className="inline-flex items-center gap-1 text-xs font-mono text-dim-foreground hover:text-primary transition-colors truncate text-left group/filepath"
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
        <span className="text-xs text-dim-foreground truncate flex-1 text-left">
          {preview}
        </span>
        <span className="text-2xs text-muted-foreground/50 shrink-0">
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
  const diffFile = useMemo(
    () => fromTexts(path, oldText, newText),
    [path, oldText, newText],
  );

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const hunk of diffFile.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") added++;
        else if (line.type === "remove") removed++;
      }
    }
    return { added, removed };
  }, [diffFile.hunks]);

  const isNewFile = oldText === null;

  /** The inner diff content (shared between flat and collapsible modes). */
  const diffContent = (
    <div className={`${flat ? "" : "mt-1 "}rounded-md bg-muted/30 border border-border/30 overflow-hidden`}>
      <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
        <DiffRenderer
          files={[diffFile]}
          viewMode="unified"
          contextThreshold={4}
          showFileHeaders
        />
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
            <span className="text-2xs text-success font-medium">
              +{stats.added}
            </span>
          )}
          {stats.removed > 0 && (
            <span className="text-2xs text-destructive font-medium">
              &minus;{stats.removed}
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
        <span className="text-xs font-mono text-white/30">
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
          <span className="text-xs text-muted-foreground">Loading terminal output…</span>
        </div>
      ) : error && !hasOutput ? (
        <div className="rounded-md bg-zinc-950/80 border border-border/30 px-3 py-2 text-xs font-mono text-destructive/70">
          {error}
        </div>
      ) : (
        <Terminal
          output={output}
          isStreaming={isStreaming}
          autoScroll
          className="border-border/30 text-xs"
        >
          <TerminalHeader className="border-zinc-800/60 px-3 py-1.5">
            <TerminalTitle className="text-xs text-zinc-500">
              {terminalId}
            </TerminalTitle>
            <TerminalActions>
              {isStreaming && (
                <span className="text-2xs text-primary/70 flex items-center gap-1 mr-1">
                  <Loader2 size={10} className="animate-spin" />
                  Running
                </span>
              )}
              <TerminalCopyButton className="size-6" />
            </TerminalActions>
          </TerminalHeader>
          <TerminalContent className="max-h-[300px] p-3 text-xs leading-relaxed" />
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
        <span className="text-xs text-dim-foreground flex-1 text-left">
          Terminal output
        </span>
        {isStreaming && (
          <Loader2 size={10} className="animate-spin text-primary shrink-0" />
        )}
        {!isStreaming && hasOutput && (
          <span className="text-2xs text-muted-foreground/50 shrink-0">
            {lineCount} line{lineCount !== 1 ? "s" : ""}
          </span>
        )}
        <span className="text-2xs font-mono text-muted-foreground/40 shrink-0">
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

