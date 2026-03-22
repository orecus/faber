import {
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  DollarSign,
  FileCode,
  FileDiff,
  FileText,
  Globe,
  Loader2,
  Pencil,
  Search,
  SquareTerminal,
  Trash2,
  Wrench,
  XCircle,
  Brain,
  Activity,
  ListChecks,
  FileCheck,
  ExternalLink,
  Hash,
} from "lucide-react";
import React, { useMemo } from "react";

import {
  Snippet,
  SnippetAddon,
  SnippetInput,
  SnippetCopyButton,
} from "@/components/ai-elements/snippet";

import {
  ChainOfThought,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { Shimmer } from "@/components/ai-elements/shimmer";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import type { AcpToolCallState, ToolCallContentItem } from "../../types";
import ContextCrease from "./ContextCrease";

// ── Kind → icon mapping ──

export const KIND_ICONS: Record<string, React.ElementType> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  execute: SquareTerminal,
  search: Search,
  think: Brain,
  fetch: Globe,
  other: Wrench,
};

// ── Status → badge config ──

const STATUS_CONFIG: Record<
  string,
  { icon: React.ReactNode; label: string; variant: "secondary" | "destructive" | "outline" }
> = {
  pending: {
    icon: <Circle className="size-3 text-yellow-500" />,
    label: "Pending",
    variant: "outline",
  },
  in_progress: {
    icon: <Loader2 className="size-3 animate-spin text-primary" />,
    label: "Running",
    variant: "secondary",
  },
  completed: {
    icon: <CheckCircle2 className="size-3 text-success" />,
    label: "Done",
    variant: "secondary",
  },
  failed: {
    icon: <XCircle className="size-3 text-destructive" />,
    label: "Error",
    variant: "destructive",
  },
};

// ── Metadata extraction helpers ──

export interface ParsedToolMeta {
  /** Primary display label for the tool call header. */
  label: string;
  /** File path, if applicable (read/edit/delete). */
  filePath?: string;
  /** Shortened file name for display. */
  fileName?: string;
  /** Command string for execute kind. */
  command?: string;
  /** Exit code for completed execute tool calls. */
  exitCode?: number;
  /** URL for fetch kind. */
  url?: string;
  /** Search query/pattern for search kind. */
  query?: string;
  /** Number of search results. */
  resultCount?: number;
  /** Diff stats: lines added. */
  linesAdded?: number;
  /** Diff stats: lines removed. */
  linesRemoved?: number;
  /** Whether this is a new file creation. */
  isNewFile?: boolean;
}

/** Extract file path from title (may be plain text like "Read src/foo.ts" or JSON params). */
function extractPath(title: string): string | null {
  // Try JSON params first
  try {
    const params = JSON.parse(title);
    if (typeof params.file_path === "string") return params.file_path;
    if (typeof params.path === "string") return params.path;
  } catch {
    // Not JSON
  }
  // Heuristic: path-like string in title
  const match = title.match(/(?:^|\s)((?:[\w@.-]+[\\/])+[\w@.-]+)/);
  return match ? match[1] : null;
}

/** Shorten a file path to parent/filename. */
export function shortenPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, "/").split("/");
  if (parts.length <= 2) return parts.join("/");
  return `…/${parts.slice(-2).join("/")}`;
}

/** Extract command from execute tool call title. */
function extractCommand(title: string): string | null {
  try {
    const params = JSON.parse(title);
    if (typeof params.command === "string") return params.command;
    if (typeof params.cmd === "string") return params.cmd;
  } catch {
    // Not JSON
  }
  return title;
}

/** Extract URL from fetch tool call title. */
function extractUrl(title: string): string | null {
  try {
    const params = JSON.parse(title);
    if (typeof params.url === "string") return params.url;
  } catch {
    // Not JSON
  }
  const urlMatch = title.match(/https?:\/\/[^\s)]+/);
  return urlMatch ? urlMatch[0] : null;
}

/** Extract search query from search tool call title. */
function extractQuery(title: string): string | null {
  try {
    const params = JSON.parse(title);
    if (typeof params.query === "string") return params.query;
    if (typeof params.pattern === "string") return params.pattern;
    if (typeof params.regex === "string") return params.regex;
  } catch {
    // Not JSON
  }
  return title;
}

/** Compute diff stats from tool call content items. */
function computeDiffStats(content?: ToolCallContentItem[]): { added: number; removed: number } {
  if (!content) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const item of content) {
    if (item.type === "diff") {
      const oldLines = item.old_text ? item.old_text.split("\n").length : 0;
      const newLines = item.new_text.split("\n").length;
      if (item.old_text === null) {
        // New file — all lines are additions
        added += newLines;
      } else {
        // Rough estimate: difference in line counts + changed lines
        added += Math.max(0, newLines - oldLines) + Math.min(oldLines, newLines);
        removed += Math.max(0, oldLines - newLines) + Math.min(oldLines, newLines);
        // More accurate: count actual diff lines
        const oldSet = new Set(item.old_text.split("\n"));
        const newSet = new Set(item.new_text.split("\n"));
        let actualAdded = 0;
        let actualRemoved = 0;
        for (const line of newSet) {
          if (!oldSet.has(line)) actualAdded++;
        }
        for (const line of oldSet) {
          if (!newSet.has(line)) actualRemoved++;
        }
        added = actualAdded;
        removed = actualRemoved;
      }
    }
  }
  return { added, removed };
}

/** Parse tool call into kind-specific metadata. */
export function parseToolMeta(toolCall: AcpToolCallState): ParsedToolMeta {
  const kind = toolCall.kind;
  const title = toolCall.title;

  switch (kind) {
    case "read": {
      const filePath = extractPath(title);
      return {
        label: filePath ? shortenPath(filePath) : title,
        filePath: filePath ?? undefined,
        fileName: filePath ? shortenPath(filePath) : undefined,
      };
    }

    case "edit": {
      const filePath = extractPath(title);
      const stats = computeDiffStats(toolCall.content);
      const isNewFile = toolCall.content?.some(
        (c) => c.type === "diff" && c.old_text === null,
      ) ?? false;
      return {
        label: filePath ? shortenPath(filePath) : title,
        filePath: filePath ?? undefined,
        fileName: filePath ? shortenPath(filePath) : undefined,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
        isNewFile,
      };
    }

    case "delete": {
      const filePath = extractPath(title);
      return {
        label: filePath ? shortenPath(filePath) : title,
        filePath: filePath ?? undefined,
        fileName: filePath ? shortenPath(filePath) : undefined,
      };
    }

    case "execute": {
      const command = extractCommand(title);
      return {
        label: command ?? title,
        command: command ?? undefined,
      };
    }

    case "search": {
      const query = extractQuery(title);
      const resultCount = toolCall.content?.filter((c) => c.type === "text").length;
      return {
        label: query ?? title,
        query: query ?? undefined,
        resultCount,
      };
    }

    case "fetch": {
      const url = extractUrl(title);
      return {
        label: url ?? title,
        url: url ?? undefined,
      };
    }

    case "think":
      return { label: title || "Thinking…" };

    default:
      return { label: title };
  }
}

// ── Faber MCP tool → friendly display ──

export interface ToolDisplay {
  icon: React.ElementType;
  label: string;
  /** If true, the tool call is hidden from the timeline. */
  hidden?: boolean;
  /** If true, render as a compact info pill instead of a collapsible card. */
  informational?: boolean;
}

/** Parse the tool_call_id to extract the base MCP tool name (before the timestamp suffix). */
export function getMcpToolName(toolCallId: string): string | null {
  // Format: "mcp_faber_<tool_name>-<timestamp>"
  const match = toolCallId.match(/^mcp_faber_(.+)-\d+$/);
  return match ? match[1] : null;
}

/** Try to parse the title as JSON and extract a human-friendly label. */
export function formatMcpTool(toolName: string, titleJson: string): ToolDisplay {
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(titleJson);
  } catch {
    // title is not JSON — use as-is
  }

  switch (toolName) {
    case "report_status":
      return { icon: Activity, label: "Reporting status", hidden: true };

    case "get_task": {
      const taskId = params.task_id;
      return { icon: ClipboardList, label: taskId ? `Fetching task ${taskId}` : "Fetching task info", informational: true };
    }

    case "report_progress": {
      const step = params.current_step ?? "?";
      const total = params.total_steps ?? "?";
      const desc = params.description ?? "";
      return {
        icon: ListChecks,
        label: `Progress ${step}/${total}${desc ? `: ${desc}` : ""}`,
        informational: true,
      };
    }

    case "update_task_plan":
      return { icon: ListChecks, label: "Updating task plan", informational: true };

    case "update_task": {
      const fields = Object.keys(params).filter((k) => k !== "task_id").join(", ");
      return { icon: Pencil, label: `Updating task${fields ? ` (${fields})` : ""}`, informational: true };
    }

    case "report_files_changed": {
      const count = Array.isArray(params.files) ? params.files.length : "?";
      return { icon: FileCheck, label: `${count} file(s) changed`, informational: true };
    }

    case "report_complete": {
      const summary = typeof params.summary === "string" ? params.summary : "Task complete";
      return { icon: CheckCircle2, label: summary, informational: true };
    }

    case "report_error":
      return { icon: XCircle, label: `Error: ${params.error ?? "unknown"}` };

    case "report_waiting":
      return { icon: Brain, label: "Waiting for input" };

    case "create_task": {
      const title = params.title ?? "new task";
      return { icon: ClipboardList, label: `Creating task: ${title}`, informational: true };
    }

    case "list_tasks":
      return { icon: ClipboardList, label: "Listing tasks", informational: true };


    default:
      return { icon: Wrench, label: titleJson || toolName };
  }
}

// ── Main Component ──

interface ToolCallCardProps {
  toolCall: AcpToolCallState;
  /** Session ID — needed for terminal output fetching. */
  sessionId?: string;
}

export default React.memo(function ToolCallCard({ toolCall, sessionId }: ToolCallCardProps) {
  const mcpToolName = useMemo(() => getMcpToolName(toolCall.tool_call_id), [toolCall.tool_call_id]);

  const display = useMemo(() => {
    if (mcpToolName) {
      return formatMcpTool(mcpToolName, toolCall.title);
    }
    return null;
  }, [mcpToolName, toolCall.title]);

  const meta = useMemo(() => parseToolMeta(toolCall), [toolCall]);

  const isInfo = display?.informational ?? false;
  const hasContent = (toolCall.content && toolCall.content.length > 0) === true;

  // ── Informational MCP calls — compact inline pill ──
  if (isInfo) {
    const KindIcon = display?.icon ?? KIND_ICONS[toolCall.kind] ?? KIND_ICONS.other;
    const displayLabel = display?.label ?? toolCall.title;
    return (
      <div className="flex items-center gap-2 py-0.5 px-1">
        <div className="flex items-center gap-1.5 rounded-full bg-primary/8 text-primary/70 px-2.5 py-1">
          {toolCall.status === "in_progress" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : toolCall.status === "failed" ? (
            <XCircle className="size-3" />
          ) : (
            <KindIcon className="size-3" />
          )}
          <span className="text-[11px]">{displayLabel}</span>
        </div>
      </div>
    );
  }

  // ── MCP tool calls that aren't informational → generic card ──
  if (mcpToolName) {
    const KindIcon = display?.icon ?? KIND_ICONS.other;
    const displayLabel = display?.label ?? toolCall.title;
    return (
      <GenericCard
        toolCall={toolCall}
        icon={KindIcon}
        label={displayLabel}
        hasContent={hasContent}
        mcpToolName={mcpToolName}
      />
    );
  }

  // ── ACP tool calls — kind-aware rendering ──
  switch (toolCall.kind) {
    case "read":
      return <ReadCard toolCall={toolCall} meta={meta} hasContent={hasContent} />;
    case "edit":
      return <EditCard toolCall={toolCall} meta={meta} hasContent={hasContent} sessionId={sessionId} />;
    case "delete":
      return <DeleteCard toolCall={toolCall} meta={meta} hasContent={hasContent} sessionId={sessionId} />;
    case "execute":
      return <ExecuteCard toolCall={toolCall} meta={meta} hasContent={hasContent} sessionId={sessionId} />;
    case "search":
      return <SearchCard toolCall={toolCall} meta={meta} hasContent={hasContent} sessionId={sessionId} />;
    case "think":
      return <ThinkCard toolCall={toolCall} />;
    case "fetch":
      return <FetchCard toolCall={toolCall} meta={meta} hasContent={hasContent} sessionId={sessionId} />;
    default:
      return (
        <GenericCard
          toolCall={toolCall}
          icon={KIND_ICONS[toolCall.kind] ?? KIND_ICONS.other}
          label={meta.label}
          hasContent={hasContent}
          sessionId={sessionId}
        />
      );
  }
});

// ── Kind-specific card components ──

/** Read — compact file path display, no expandable content. */
function ReadCard({
  toolCall,
  meta,
}: {
  toolCall: AcpToolCallState;
  meta: ParsedToolMeta;
  hasContent: boolean;
}) {
  const lineCount = useMemo(() => {
    if (!toolCall.content) return null;
    const textItem = toolCall.content.find((c) => c.type === "text");
    if (textItem && textItem.type === "text") {
      return textItem.text.split("\n").length;
    }
    return null;
  }, [toolCall.content]);

  return (
    <div className="not-prose w-full rounded-md border border-border/40 bg-card/30 mb-1 flex items-center gap-2 px-3 py-1.5">
      <FileText className="size-3.5 text-muted-foreground shrink-0" />
      <span
        className="text-[12px] font-mono text-dim-foreground truncate flex-1 text-left"
        title={meta.filePath}
      >
        {meta.label}
      </span>
      {lineCount !== null && (
        <span className="text-[10px] text-muted-foreground/50 shrink-0">
          {lineCount} lines
        </span>
      )}
      <StatusDot status={toolCall.status} />
    </div>
  );
}

/** Edit — file path + diff stats, default-open diff. */
function EditCard({
  toolCall,
  meta,
  hasContent,
  sessionId,
}: {
  toolCall: AcpToolCallState;
  meta: ParsedToolMeta;
  hasContent: boolean;
  sessionId?: string;
}) {
  return (
    <Collapsible
      defaultOpen={toolCall.status === "completed" || toolCall.status === "in_progress"}
      className="group not-prose w-full rounded-md border border-border/40 bg-card/30 mb-1"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent/30 transition-colors">
        {meta.isNewFile ? (
          <FileCode className="size-3.5 text-success shrink-0" />
        ) : (
          <FileDiff className="size-3.5 text-primary shrink-0" />
        )}
        <span
          className="text-[12px] font-mono text-dim-foreground truncate flex-1 text-left"
          title={meta.filePath}
        >
          {meta.label}
        </span>
        {/* Diff stats */}
        {(meta.linesAdded !== undefined && meta.linesAdded > 0) && (
          <span className="text-[10px] font-medium text-success shrink-0">
            +{meta.linesAdded}
          </span>
        )}
        {(meta.linesRemoved !== undefined && meta.linesRemoved > 0) && (
          <span className="text-[10px] font-medium text-destructive shrink-0">
            −{meta.linesRemoved}
          </span>
        )}
        {meta.isNewFile && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-success border-success/30 shrink-0">
            new
          </Badge>
        )}
        <StatusDot status={toolCall.status} />
        <ChevronDown className="size-3 text-muted-foreground/40 transition-transform group-data-[state=open]:rotate-180 shrink-0" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-2">
        {hasContent ? (
          <div className="space-y-1">
            {toolCall.content!.map((item, i) => (
              <ContextCrease
                key={i}
                content={item}
                defaultOpen={true}
                flat
                sessionId={sessionId}
                isStreaming={toolCall.status === "in_progress"}
              />
            ))}
          </div>
        ) : (
          <FallbackMeta toolCall={toolCall} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Delete — red-accented card with deleted badge. */
function DeleteCard({
  toolCall,
  meta,
  hasContent,
  sessionId,
}: {
  toolCall: AcpToolCallState;
  meta: ParsedToolMeta;
  hasContent: boolean;
  sessionId?: string;
}) {
  return (
    <Collapsible className="group not-prose w-full rounded-md border border-destructive/25 bg-destructive/3 mb-1">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-destructive/5 transition-colors">
        <Trash2 className="size-3.5 text-destructive/70 shrink-0" />
        <span
          className="text-[12px] font-mono text-destructive/80 truncate flex-1 text-left line-through decoration-destructive/30"
          title={meta.filePath}
        >
          {meta.label}
        </span>
        <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4 shrink-0">
          deleted
        </Badge>
        <StatusDot status={toolCall.status} />
        {hasContent && (
          <ChevronDown className="size-3 text-destructive/40 transition-transform group-data-[state=open]:rotate-180 shrink-0" />
        )}
      </CollapsibleTrigger>
      {hasContent && (
        <CollapsibleContent className="px-3 pb-2">
          <div className="space-y-1">
            {toolCall.content!.map((item, i) => (
              <ContextCrease key={i} content={item} defaultOpen={false} flat sessionId={sessionId} isStreaming={toolCall.status === "in_progress"} />
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/** Execute — monospace command + exit code badge, with Snippet command header. */
function ExecuteCard({
  toolCall,
  meta,
  hasContent,
  sessionId,
}: {
  toolCall: AcpToolCallState;
  meta: ParsedToolMeta;
  hasContent: boolean;
  sessionId?: string;
}) {
  // Try to extract exit code from content text (often the last line or a JSON field)
  const exitCode = useMemo(() => {
    if (!toolCall.content) return undefined;
    for (const item of toolCall.content) {
      if (item.type === "text") {
        // Look for exit code pattern at end of text
        const match = item.text.match(/exit\s*(?:code|status)?[:\s]*(\d+)\s*$/i);
        if (match) return parseInt(match[1], 10);
      }
    }
    return undefined;
  }, [toolCall.content]);

  const isRunning = toolCall.status === "in_progress";
  const isFailed = toolCall.status === "failed";
  const fullCommand = meta.command ?? meta.label;

  return (
    <Collapsible
      defaultOpen={isRunning || isFailed}
      className="group not-prose w-full rounded-md border border-border/40 bg-card/30 mb-1 overflow-hidden"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent/30 transition-colors">
        <SquareTerminal className="size-3.5 text-muted-foreground shrink-0" />
        <code className="text-[11.5px] font-mono text-dim-foreground truncate flex-1 text-left">
          <span className="text-muted-foreground/50 mr-1">$</span>
          {fullCommand.length > 80 ? fullCommand.slice(0, 77) + "…" : fullCommand}
        </code>
        {/* Exit code badge */}
        {exitCode !== undefined && (
          <Badge
            variant={exitCode === 0 ? "secondary" : "destructive"}
            className="text-[9px] px-1.5 py-0 h-4 gap-0.5 font-mono shrink-0"
          >
            <Hash className="size-2.5" />
            {exitCode}
          </Badge>
        )}
        {isRunning && (
          <Loader2 className="size-3 animate-spin text-primary shrink-0" />
        )}
        {!isRunning && exitCode === undefined && <StatusDot status={toolCall.status} />}
        <ChevronDown className="size-3 text-muted-foreground/40 transition-transform group-data-[state=open]:rotate-180 shrink-0" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Snippet command display */}
        <div className="border-t border-border/30 px-3 py-1.5">
          <Snippet code={fullCommand} className="h-8 text-[11px] bg-zinc-950/50 border-border/30">
            <SnippetAddon>
              <DollarSign className="size-3 text-muted-foreground/50" />
            </SnippetAddon>
            <SnippetInput className="text-[11px] text-dim-foreground" />
            <SnippetCopyButton />
          </Snippet>
        </div>
        {hasContent ? (
          <div>
            <div className="max-h-[300px] overflow-y-auto">
              {toolCall.content!.map((item, i) => (
                <div key={i} className="px-3 py-1.5">
                  <ContextCrease
                    content={item}
                    defaultOpen={true}
                    flat
                    sessionId={sessionId}
                    isStreaming={isRunning}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : !isRunning ? (
          <div className="border-t border-border/30 px-3 py-2">
            <FallbackMeta toolCall={toolCall} />
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Search — query display + result count. */
function SearchCard({
  toolCall,
  meta,
  hasContent,
  sessionId,
}: {
  toolCall: AcpToolCallState;
  meta: ParsedToolMeta;
  hasContent: boolean;
  sessionId?: string;
}) {
  return (
    <Collapsible className="group not-prose w-full rounded-md border border-border/40 bg-card/30 mb-1">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent/30 transition-colors">
        <Search className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-[12px] text-dim-foreground truncate flex-1 text-left">
          <span className="font-mono text-primary/80">{meta.query ?? meta.label}</span>
        </span>
        {meta.resultCount !== undefined && meta.resultCount > 0 && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0">
            {meta.resultCount} result{meta.resultCount !== 1 ? "s" : ""}
          </span>
        )}
        <StatusDot status={toolCall.status} />
        {hasContent && (
          <ChevronDown className="size-3 text-muted-foreground/40 transition-transform group-data-[state=open]:rotate-180 shrink-0" />
        )}
      </CollapsibleTrigger>
      {hasContent && (
        <CollapsibleContent className="px-3 pb-2">
          <div className="space-y-1">
            {toolCall.content!.map((item, i) => (
              <ContextCrease key={i} content={item} defaultOpen={false} flat sessionId={sessionId} isStreaming={toolCall.status === "in_progress"} />
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/** Think — renders as a ChainOfThought step for standalone think tool calls. */
function ThinkCard({ toolCall }: { toolCall: AcpToolCallState }) {
  const thinkingText = useMemo(() => {
    if (!toolCall.content) return toolCall.title || "";
    return toolCall.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("\n");
  }, [toolCall.content, toolCall.title]);

  const isStreaming = toolCall.status === "in_progress";

  if (!thinkingText && !isStreaming) return null;

  return (
    <div className="py-0.5 pl-1">
      <ChainOfThought defaultOpen={isStreaming}>
        <ChainOfThoughtStep
          icon={Brain}
          status={isStreaming ? "active" : "complete"}
          label={
            isStreaming ? (
              <Shimmer duration={2}>Thinking...</Shimmer>
            ) : (
              <span className="text-xs">Thought</span>
            )
          }
          className="[&>div:first-child>div:last-child]:hidden"
        >
          {thinkingText && (
            <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-40 overflow-y-auto border-l-2 border-muted-foreground/15 pl-3">
              {thinkingText}
            </div>
          )}
        </ChainOfThoughtStep>
      </ChainOfThought>
    </div>
  );
}

/** Fetch — URL display with external link icon. */
function FetchCard({
  toolCall,
  meta,
  hasContent,
  sessionId,
}: {
  toolCall: AcpToolCallState;
  meta: ParsedToolMeta;
  hasContent: boolean;
  sessionId?: string;
}) {
  const displayUrl = meta.url
    ? meta.url.length > 60
      ? meta.url.slice(0, 57) + "…"
      : meta.url
    : meta.label;

  return (
    <Collapsible className="group not-prose w-full rounded-md border border-border/40 bg-card/30 mb-1">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent/30 transition-colors">
        <Globe className="size-3.5 text-muted-foreground shrink-0" />
        <span
          className="text-[12px] font-mono text-primary/70 truncate flex-1 text-left"
          title={meta.url}
        >
          {displayUrl}
        </span>
        {meta.url && (
          <ExternalLink className="size-3 text-muted-foreground/40 shrink-0" />
        )}
        <StatusDot status={toolCall.status} />
        {hasContent && (
          <ChevronDown className="size-3 text-muted-foreground/40 transition-transform group-data-[state=open]:rotate-180 shrink-0" />
        )}
      </CollapsibleTrigger>
      {hasContent && (
        <CollapsibleContent className="px-3 pb-2">
          <div className="space-y-1">
            {toolCall.content!.map((item, i) => (
              <ContextCrease key={i} content={item} defaultOpen={false} flat sessionId={sessionId} isStreaming={toolCall.status === "in_progress"} />
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/** Generic card — fallback for unknown kinds and non-informational MCP tools. */
function GenericCard({
  toolCall,
  icon: Icon,
  label,
  hasContent,
  mcpToolName,
  sessionId,
}: {
  toolCall: AcpToolCallState;
  icon: React.ElementType;
  label: string;
  hasContent: boolean;
  mcpToolName?: string | null;
  sessionId?: string;
}) {
  const statusCfg = STATUS_CONFIG[toolCall.status] ?? STATUS_CONFIG.pending;

  return (
    <Collapsible className="group not-prose w-full rounded-md border border-border/50 mb-1">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 cursor-pointer">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-4 text-muted-foreground shrink-0" />
          <span className="text-[13px] text-dim-foreground truncate">
            {label}
          </span>
          <Badge className="gap-1 rounded-full text-[11px] shrink-0" variant={statusCfg.variant}>
            {statusCfg.icon}
            {statusCfg.label}
          </Badge>
        </div>
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 shrink-0" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-3 pb-3 text-sm">
        {hasContent ? (
          <div className="space-y-1">
            {toolCall.content!.map((item, i) => (
              <ContextCrease
                key={i}
                content={item}
                defaultOpen={toolCall.status === "in_progress"}
                flat
                sessionId={sessionId}
                isStreaming={toolCall.status === "in_progress"}
              />
            ))}
          </div>
        ) : (
          <FallbackMeta toolCall={toolCall} mcpToolName={mcpToolName} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Shared sub-components ──

/** Compact status dot indicator. */
function StatusDot({ status }: { status: string }) {
  switch (status) {
    case "in_progress":
      return <Loader2 className="size-3 animate-spin text-primary shrink-0" />;
    case "completed":
      return <CheckCircle2 className="size-3 text-success shrink-0" />;
    case "failed":
      return <XCircle className="size-3 text-destructive shrink-0" />;
    case "pending":
      return <Circle className="size-2.5 text-yellow-500/60 shrink-0" />;
    default:
      return null;
  }
}

/** Fallback metadata display when no rich content is available. */
function FallbackMeta({
  toolCall,
  mcpToolName,
}: {
  toolCall: AcpToolCallState;
  mcpToolName?: string | null;
}) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
      <p className="break-all">{toolCall.title}</p>
      <p className="mt-1 text-[10px] text-muted-foreground/60">
        {mcpToolName ?? toolCall.kind} &middot; {toolCall.tool_call_id}
      </p>
    </div>
  );
}

// ── Exported helpers ──

// ── Faber MCP tool helpers ──

/** Extract the faber MCP tool name from a tool call, or null if not a faber tool.
 *  Handles both PTY-mode IDs (mcp_faber_<name>-<n>) and ACP-mode IDs
 *  (mcp__faber__<name>-<n>), plus a title-based fallback for ACP agents.
 */
export function getFaberToolName(tc: AcpToolCallState): string | null {
  const id = tc.tool_call_id;
  const ptyMatch = id.match(/^mcp_faber_(.+)-\d+$/);
  if (ptyMatch) return ptyMatch[1];
  const acpMatch = id.match(/^mcp__faber__(.+)-\d+$/);
  if (acpMatch) return acpMatch[1];
  if (tc.title) {
    const titleMatch = tc.title.match(/mcp__faber__(\w+)/);
    if (titleMatch) return titleMatch[1];
  }
  return null;
}

/** Tools that are purely internal — never shown in the chat timeline. */
const HIDDEN_FABER_TOOLS = new Set([
  "report_status",     // ambient state, redundant with progress
  "get_task",          // internal data fetch
  "update_task_plan",  // plan update (shown via plan UI)
  "list_tasks",        // internal data fetch
]);

/** Check if a tool call renders as an informational inline pill (for grouping in timeline). */
export function isInformationalToolCall(toolCall: AcpToolCallState): boolean {
  const toolName = getFaberToolName(toolCall);
  if (!toolName) return false;
  const INFORMATIONAL_TOOLS = new Set([
    "get_task", "report_progress", "update_task_plan", "update_task",
    "report_files_changed", "report_complete", "create_task", "list_tasks",
  ]);
  return INFORMATIONAL_TOOLS.has(toolName);
}

/** Check if a tool call should be hidden from the timeline. */
export function isHiddenToolCall(toolCall: AcpToolCallState): boolean {
  const toolName = getFaberToolName(toolCall);
  if (!toolName) return false;
  return HIDDEN_FABER_TOOLS.has(toolName);
}

/** Check if a tool call is a faber MCP tool (hidden or visible).
 *  Used to avoid narration splits on internal tool calls.
 */
export function isFaberToolCall(toolCall: AcpToolCallState): boolean {
  return getFaberToolName(toolCall) !== null;
}

/** Check if a tool call is a report_waiting that should be shown as an agent message. */
export function isWaitingToolCall(toolCall: AcpToolCallState): { question: string } | null {
  const toolName = getFaberToolName(toolCall);
  if (toolName !== "report_waiting") return null;
  // In PTY mode, params are in the title; in ACP mode, they're in content
  try {
    const params = JSON.parse(toolCall.title);
    if (typeof params.question === "string") {
      return { question: params.question };
    }
  } catch {
    // not valid JSON in title — try content (ACP mode)
  }
  if (toolCall.content?.length) {
    for (const item of toolCall.content) {
      if (item.type === "text") {
        try {
          const params = JSON.parse(item.text) as Record<string, unknown>;
          if (typeof params.question === "string") {
            return { question: params.question };
          }
        } catch { /* not JSON */ }
      }
    }
  }
  return null;
}
