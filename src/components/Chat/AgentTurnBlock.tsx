import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardPlus,
  Clock,
  Copy,
  FileCode,
  FileDiff,
  FileText,
  Globe,
  Loader2,
  MessageCircle,
  Pencil,
  RefreshCw,
  Search,
  SquareTerminal,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import {
  ChainOfThought,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import ContextCrease from "./ContextCrease";
import ChatMessage from "./ChatMessage";
import { parseToolMeta, getFaberToolName } from "./ToolCallCard";

import type { AcpChatMessage, AcpThinkingBlock, AcpToolCallState } from "../../types";

// ── Faber MCP tool classification ──
// getFaberToolName is imported from ToolCallCard.tsx (shared between both files)

/** Tools that are purely internal — never shown in UI */
const HIDDEN_TOOLS = new Set([
  "report_status", // ambient state, redundant with progress
  "get_task", "update_task_plan",
  "list_tasks",
]);

/** Parse params/result from a tool call.
 * In ACP mode, the title is the tool name (e.g. "mcp__faber__create_task")
 * and the content[0].text contains the JSON result from the MCP server.
 * In PTY mode, the title may contain JSON params directly.
 */
function parseToolParams(tc: AcpToolCallState): Record<string, unknown> {
  // Try content first — ACP mode puts the result in content[0].text
  if (tc.content?.length) {
    for (const item of tc.content) {
      if (item.type === "text") {
        try { return JSON.parse(item.text) as Record<string, unknown>; }
        catch { /* not JSON, continue */ }
      }
    }
  }
  // Fallback: try parsing the title (PTY mode)
  try { return JSON.parse(tc.title) as Record<string, unknown>; }
  catch { return {}; }
}

// ── Classify tool calls ──

interface ClassifiedTools {
  /** Regular ACP tool calls (read, edit, execute, etc.) */
  steps: AcpToolCallState[];
  /** Latest progress report (only the most recent) */
  progress: { currentStep: number; totalSteps: number; description: string } | null;
  /** Files changed reports (merged) */
  filesChanged: { path: string; action: string }[];
  /** Error reports */
  errors: { error: string; details?: string }[];
  /** Completion report (last one) */
  completion: { summary: string } | null;
  /** Waiting reports (last one — most important) */
  waiting: { question: string } | null;
  /** Tasks created */
  tasksCreated: { title: string; taskId?: string; priority?: string; labels?: string[]; dependsOn?: string[] }[];
  /** Task updates */
  taskUpdates: { taskId?: string; fields: Record<string, unknown> }[];
}

function classifyToolCalls(toolCalls: AcpToolCallState[]): ClassifiedTools {
  const result: ClassifiedTools = {
    steps: [],
    progress: null,
    filesChanged: [],
    errors: [],
    completion: null,
    waiting: null,
    tasksCreated: [],
    taskUpdates: [],
  };

  for (const tc of toolCalls) {
    const faberName = getFaberToolName(tc);

    if (!faberName) {
      // Regular ACP tool call
      result.steps.push(tc);
      continue;
    }

    if (HIDDEN_TOOLS.has(faberName)) continue;

    const params = parseToolParams(tc);

    switch (faberName) {
      case "report_progress": {
        const cs = params.current_step as number | undefined;
        const ts = params.total_steps as number | undefined;
        const desc = params.description as string | undefined;
        if (cs !== undefined && ts !== undefined) {
          result.progress = { currentStep: cs, totalSteps: ts, description: desc ?? "" };
        }
        break;
      }
      case "report_files_changed": {
        const files = params.files as { path: string; action: string }[] | undefined;
        if (Array.isArray(files)) {
          result.filesChanged.push(...files);
        }
        break;
      }
      case "report_error": {
        const error = params.error as string | undefined;
        const details = params.details as string | undefined;
        if (error) result.errors.push({ error, details });
        break;
      }
      case "report_complete": {
        const summary = params.summary as string | undefined;
        if (summary) result.completion = { summary };
        break;
      }
      case "report_waiting": {
        const question = params.question as string | undefined;
        if (question) result.waiting = { question };
        break;
      }
      case "create_task": {
        const title = params.title as string | undefined;
        if (title) {
          result.tasksCreated.push({
            title,
            taskId: params.task_id as string | undefined,
            priority: params.priority as string | undefined,
            labels: params.labels as string[] | undefined,
            dependsOn: params.depends_on as string[] | undefined,
          });
        }
        break;
      }
      case "update_task": {
        const taskId = params.task_id as string | undefined;
        // Collect all fields that were updated (exclude task_id)
        const fields: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(params)) {
          if (key !== "task_id" && val !== undefined) fields[key] = val;
        }
        if (Object.keys(fields).length > 0) {
          result.taskUpdates.push({ taskId, fields });
        }
        break;
      }
    }
  }

  return result;
}

// ── Step helpers ──

function mapStepStatus(status: string): "complete" | "active" | "pending" {
  switch (status) {
    case "in_progress": return "active";
    case "completed":
    case "failed": return "complete";
    default: return "pending";
  }
}

const STEP_ICONS: Record<string, LucideIcon> = {
  read: FileText, edit: Pencil, delete: Trash2, execute: SquareTerminal,
  search: Search, think: Brain, fetch: Globe, other: Wrench,
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function getStepIcon(tc: AcpToolCallState): LucideIcon {
  if (tc.kind === "edit") {
    return tc.content?.some((c) => c.type === "diff" && c.old_text === null) ? FileCode : FileDiff;
  }
  return STEP_ICONS[tc.kind] ?? STEP_ICONS.other;
}

function getStepLabel(tc: AcpToolCallState): string {
  const m = parseToolMeta(tc);
  switch (tc.kind) {
    case "read": return m.label;
    case "edit": {
      const pfx = m.isNewFile ? "Create " : "Edit ";
      const st: string[] = [];
      if (m.linesAdded) st.push(`+${m.linesAdded}`);
      if (m.linesRemoved) st.push(`−${m.linesRemoved}`);
      return pfx + m.label + (st.length ? ` (${st.join(" ")})` : "");
    }
    case "delete": return `Delete ${m.label}`;
    case "execute": return m.command ? `$ ${truncate(m.command, 70)}` : m.label;
    case "search": {
      const q = m.query ? truncate(m.query, 50) : m.label;
      return `Search: ${q}${m.resultCount ? ` → ${m.resultCount} result${m.resultCount !== 1 ? "s" : ""}` : ""}`;
    }
    case "think": return "Thinking";
    case "fetch": return m.url ? truncate(m.url, 60) : m.label;
    default: return truncate(m.label, 60);
  }
}

// ── Step content renderer ──

function StepExpandedContent({ tc, sessionId }: { tc: AcpToolCallState; sessionId?: string }) {
  if (!tc.content?.length) return null;
  const streaming = tc.status === "in_progress";
  if (tc.kind === "read") return null;
  if (tc.kind === "think") {
    const text = tc.content.filter((c) => c.type === "text").map((c) => (c as { type: "text"; text: string }).text).join("\n");
    return text ? <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words border-l-2 border-muted-foreground/15 pl-3">{text}</div> : null;
  }
  return (
    <div className={tc.kind === "execute" ? "rounded-md overflow-hidden" : "space-y-1"}>
      {tc.content.map((item, i) => (
        <ContextCrease key={i} content={item} defaultOpen={tc.kind === "edit"} flat sessionId={sessionId} isStreaming={streaming} />
      ))}
    </div>
  );
}

function hasExpandableContent(tc: AcpToolCallState): boolean {
  if (!tc.content?.length) return false;
  if (tc.kind === "read") return false;
  if (tc.kind === "think") return tc.content.some((c) => c.type === "text" && (c as { type: "text"; text: string }).text.length > 0);
  return true;
}

// ── Tool call collapse threshold ──

/** When a turn has more than this many items, collapse the middle ones. */
const COLLAPSE_THRESHOLD = 5;
/** Number of items to keep visible at the start and end when collapsed. */
const VISIBLE_HEAD = 2;
const VISIBLE_TAIL = 2;

// ── Collapsible tool step ──

function CollapsibleToolStep({ tc, sessionId, hasNext }: {
  tc: AcpToolCallState; sessionId: string; hasNext: boolean;
}) {
  const expandable = hasExpandableContent(tc);
  const stepLabel = (
    <span className="font-mono text-xs leading-relaxed">
      {getStepLabel(tc)}
      {tc.status === "in_progress" && (
        <Badge variant="secondary" className="ml-1.5 text-[9px] px-1.5 py-0 h-4 gap-1 font-sans text-primary">
          <Loader2 className="size-2.5 animate-spin" />
          running
        </Badge>
      )}
      {tc.status === "failed" && <span className="ml-1.5 text-destructive text-[10px] font-sans">failed</span>}
    </span>
  );

  if (!expandable) {
    return (
      <ChainOfThoughtStep icon={getStepIcon(tc)} status={mapStepStatus(tc.status)}
        className={cn(hasNext && "pb-1.5 [&>div:first-child]:min-h-8", !hasNext && "[&>div:first-child>div:last-child]:hidden")}
        label={stepLabel}
      />
    );
  }

  return (
    <ChainOfThoughtStep icon={getStepIcon(tc)} status={mapStepStatus(tc.status)}
      className={cn(hasNext && "pb-1.5 [&>div:first-child]:min-h-8", !hasNext && "[&>div:first-child>div:last-child]:hidden")}
      label={
        <Collapsible defaultOpen={false} className="w-full">
          <CollapsibleTrigger className="flex w-full items-center gap-2 text-left transition-colors hover:text-foreground group/tool">
            <span className="flex-1 min-w-0">{stepLabel}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-data-[state=open]/tool:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1">
            <StepExpandedContent tc={tc} sessionId={sessionId} />
          </CollapsibleContent>
        </Collapsible>
      }
    />
  );
}

// ── Collapsed tool calls summary ──

/** Renders a single turn item (tool call, thinking block, or narration). */
function renderTurnItem(
  item: TurnItem,
  hasNext: boolean,
  sessionId: string,
) {
  if (item.type === "tool") {
    return (
      <CollapsibleToolStep
        key={item.data.tool_call_id}
        tc={item.data}
        sessionId={sessionId}
        hasNext={hasNext}
      />
    );
  }
  if (item.type === "narration") {
    const msg = item.data;
    return (
      <ChainOfThoughtStep
        key={msg.id}
        icon={MessageCircle}
        status="complete"
        className={cn(
          hasNext && "pb-1.5 [&>div:first-child]:min-h-8",
          !hasNext && "[&>div:first-child>div:last-child]:hidden",
        )}
        label={
          <span className="text-xs text-muted-foreground italic leading-relaxed">
            {msg.text}
          </span>
        }
      />
    );
  }
  const tb = item.data;
  return (
    <ChainOfThoughtStep
      key={tb.id}
      icon={Brain}
      status="complete"
      className={cn(
        hasNext && "pb-1.5 [&>div:first-child]:min-h-8",
        !hasNext && "[&>div:first-child>div:last-child]:hidden",
      )}
      label={
        <Reasoning duration={tb.duration} defaultOpen={false} className="mb-0 w-full">
          <ReasoningTrigger>
            <span className="flex-1 text-left text-sm text-muted-foreground">
              {tb.duration
                ? `Thought for ${tb.duration} second${tb.duration !== 1 ? "s" : ""}`
                : "Thought for a few seconds"}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform" />
          </ReasoningTrigger>
          <ReasoningContent>{tb.text}</ReasoningContent>
        </Reasoning>
      }
    />
  );
}

/** Summary row shown when tool calls exceed the threshold. */
function CollapsedToolCallsSummary({
  collapsedItems,
  totalCount,
  runningCount,
  sessionId,
  hasNextAfterTail,
}: {
  collapsedItems: TurnItem[];
  totalCount: number;
  runningCount: number;
  sessionId: string;
  hasNextAfterTail: boolean;
}) {
  return (
    <ChainOfThoughtStep
      icon={Wrench}
      status={runningCount > 0 ? "active" : "complete"}
      className="pb-1.5 [&>div:first-child]:min-h-8"
      label={
        <Collapsible defaultOpen={false} className="w-full">
          <CollapsibleTrigger className="flex w-full items-center gap-2 text-left transition-colors hover:text-foreground group/collapse">
            <span className="flex-1 min-w-0 text-xs text-muted-foreground">
              <span className="font-medium text-dim-foreground">{totalCount} tool calls</span>
              {runningCount > 0 && (
                <span className="ml-1.5">
                  &middot;{" "}
                  <span className="text-primary font-medium">{runningCount} running</span>
                </span>
              )}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-data-[state=open]/collapse:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 space-y-0 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1">
            {collapsedItems.map((item, i) => {
              const isLast = i === collapsedItems.length - 1;
              const hasNext = !isLast || hasNextAfterTail;
              return renderTurnItem(item, hasNext, sessionId);
            })}
          </CollapsibleContent>
        </Collapsible>
      }
    />
  );
}

// ── MCP visual elements ──

/** Progress bar — compact inline indicator */
function ProgressIndicator({ progress }: { progress: ClassifiedTools["progress"] }) {
  if (!progress) return null;
  const pct = Math.round((progress.currentStep / progress.totalSteps) * 100);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground px-1 py-1">
      <Loader2 className="size-3 animate-spin text-primary shrink-0" />
      <span className="shrink-0 font-mono text-[10px]">{progress.currentStep}/{progress.totalSteps}</span>
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      {progress.description && <span className="truncate text-[11px]">{progress.description}</span>}
    </div>
  );
}

/** Files changed — compact badge list */
function FilesChangedIndicator({ files }: { files: ClassifiedTools["filesChanged"] }) {
  if (files.length === 0) return null;
  const actionColors: Record<string, string> = {
    created: "text-success border-success/30",
    modified: "text-primary border-primary/30",
    deleted: "text-destructive border-destructive/30",
  };
  return (
    <ChainOfThoughtStep
      icon={FileText}
      status="complete"
      className="pb-1.5 [&>div:first-child]:min-h-8"
      label={
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">{files.length} file{files.length !== 1 ? "s" : ""} changed</span>
          {files.map((f, i) => (
            <Badge key={i} variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5 font-mono", actionColors[f.action] ?? "")}>
              {f.path.split("/").pop()} <span className="ml-0.5 opacity-60">{f.action}</span>
            </Badge>
          ))}
        </div>
      }
    />
  );
}

/** Error callout — destructive styling */
function ErrorIndicator({ errors, hasNext }: { errors: ClassifiedTools["errors"]; hasNext: boolean }) {
  if (errors.length === 0) return null;
  return (
    <>
      {errors.map((err, i) => (
        <ChainOfThoughtStep
          key={`error-${i}`}
          icon={XCircle}
          status="complete"
          className={cn(
            "text-destructive",
            hasNext && "pb-1.5 [&>div:first-child]:min-h-8",
            !hasNext && "[&>div:first-child>div:last-child]:hidden",
          )}
          label={
            <div className="w-full">
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
                <p className="text-xs font-medium text-destructive">{err.error}</p>
                {err.details && <p className="text-[11px] text-destructive/70 mt-1">{err.details}</p>}
              </div>
            </div>
          }
        />
      ))}
    </>
  );
}

/** Waiting prompt — warning styling with prominent question */
function WaitingIndicator({ waiting, hasNext }: { waiting: ClassifiedTools["waiting"]; hasNext: boolean }) {
  if (!waiting) return null;
  return (
    <ChainOfThoughtStep
      icon={Clock}
      status="active"
      className={cn(
        hasNext && "pb-1.5 [&>div:first-child]:min-h-8",
        !hasNext && "[&>div:first-child>div:last-child]:hidden",
      )}
      label={
        <div className="w-full">
          <div className="rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 animate-pulse">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="size-3 text-warning shrink-0" />
              <span className="text-[10px] font-medium text-warning uppercase tracking-wide">Waiting for input</span>
            </div>
            <p className="text-xs text-foreground">{waiting.question}</p>
          </div>
        </div>
      }
    />
  );
}

/** Completion summary — success styling */
function CompletionIndicator({ completion, hasNext }: { completion: ClassifiedTools["completion"]; hasNext: boolean }) {
  if (!completion) return null;
  return (
    <ChainOfThoughtStep
      icon={CheckCircle2}
      status="complete"
      className={cn(
        hasNext && "pb-1.5 [&>div:first-child]:min-h-8",
        !hasNext && "[&>div:first-child>div:last-child]:hidden",
      )}
      label={
        <div className="w-full">
          <div className="rounded-lg bg-success/10 border border-success/20 px-3 py-2">
            <p className="text-xs text-success">{completion.summary}</p>
          </div>
        </div>
      }
    />
  );
}

/** Created task — collapsible card with task details */
function TaskCreatedIndicator({ tasks, hasNext }: { tasks: ClassifiedTools["tasksCreated"]; hasNext: boolean }) {
  if (tasks.length === 0) return null;
  return (
    <>
      {tasks.map((task, i) => {
        const isLast = i === tasks.length - 1;
        const showConnector = !isLast || hasNext;
        return (
          <ChainOfThoughtStep
            key={`task-created-${i}`}
            icon={ClipboardPlus}
            status="complete"
            className={cn(
              showConnector && "pb-1.5 [&>div:first-child]:min-h-8",
              !showConnector && "[&>div:first-child>div:last-child]:hidden",
            )}
            label={
              <Collapsible defaultOpen={false} className="w-full">
                <CollapsibleTrigger className="flex w-full items-center gap-2 text-left transition-colors hover:text-foreground group/task">
                  <span className="flex-1 min-w-0 text-xs">
                    <span className="text-muted-foreground">Created task</span>
                    {task.taskId && <span className="ml-1 font-mono text-primary">{task.taskId}</span>}
                    <span className="ml-1 text-foreground">{task.title}</span>
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-data-[state=open]/task:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                  <div className="rounded-lg bg-card border border-border/40 px-3 py-2 space-y-1.5 text-xs">
                    {task.priority && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">Priority</span>
                        <Badge variant="outline" className={cn(
                          "text-[10px] px-1.5 py-0 h-5",
                          task.priority === "P0" && "border-destructive/40 text-destructive",
                          task.priority === "P1" && "border-warning/40 text-warning",
                          task.priority === "P2" && "border-muted-foreground/40 text-muted-foreground",
                        )}>
                          {task.priority}
                        </Badge>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-16 shrink-0">Status</span>
                      <span className="text-dim-foreground">backlog</span>
                    </div>
                    {task.labels && task.labels.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">Labels</span>
                        <div className="flex flex-wrap gap-1">
                          {task.labels.map((label) => (
                            <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {task.dependsOn && task.dependsOn.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">Depends</span>
                        <span className="font-mono text-dim-foreground">{task.dependsOn.join(", ")}</span>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            }
          />
        );
      })}
    </>
  );
}

/** Updated task — shows which fields were changed */
function TaskUpdatedIndicator({ updates, hasNext }: { updates: ClassifiedTools["taskUpdates"]; hasNext: boolean }) {
  if (updates.length === 0) return null;

  // Human-friendly field labels
  const fieldLabels: Record<string, string> = {
    status: "Status", priority: "Priority", title: "Title",
    labels: "Labels", depends_on: "Dependencies",
    github_issue: "GitHub Issue", github_pr: "GitHub PR",
  };

  return (
    <>
      {updates.map((update, i) => {
        const isLast = i === updates.length - 1;
        const showConnector = !isLast || hasNext;
        const fieldNames = Object.keys(update.fields).map((k) => fieldLabels[k] ?? k);
        const summary = fieldNames.join(", ");

        return (
          <ChainOfThoughtStep
            key={`task-updated-${i}`}
            icon={RefreshCw}
            status="complete"
            className={cn(
              showConnector && "pb-1.5 [&>div:first-child]:min-h-8",
              !showConnector && "[&>div:first-child>div:last-child]:hidden",
            )}
            label={
              <Collapsible defaultOpen={false} className="w-full">
                <CollapsibleTrigger className="flex w-full items-center gap-2 text-left transition-colors hover:text-foreground group/taskup">
                  <span className="flex-1 min-w-0 text-xs">
                    <span className="text-muted-foreground">Updated task</span>
                    {update.taskId && <span className="ml-1 font-mono text-primary">{update.taskId}</span>}
                    <span className="ml-1 text-muted-foreground/70">({summary})</span>
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-data-[state=open]/taskup:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
                  <div className="rounded-lg bg-card border border-border/40 px-3 py-2 space-y-1.5 text-xs">
                    {Object.entries(update.fields).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-muted-foreground w-20 shrink-0">{fieldLabels[key] ?? key}</span>
                        <span className="text-dim-foreground font-mono text-[11px]">
                          {Array.isArray(value) ? value.join(", ") : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            }
          />
        );
      })}
    </>
  );
}

// ── Props ──

/** A merged item in the turn's chronological timeline. */
type TurnItem =
  | { type: "tool"; data: AcpToolCallState }
  | { type: "thinking"; data: AcpThinkingBlock }
  | { type: "narration"; data: AcpChatMessage };

interface AgentTurnBlockProps {
  toolCalls: AcpToolCallState[];
  thinkingBlocks?: AcpThinkingBlock[];
  agentMessage: AcpChatMessage | null;
  /** Narration messages to render inline between tool steps (Option B mode). */
  narrations?: AcpChatMessage[];
  isStreaming?: boolean;
  sessionId: string;
}

// ── Main Component ──

export default React.memo(function AgentTurnBlock({
  toolCalls,
  thinkingBlocks = [],
  agentMessage,
  narrations = [],
  isStreaming = false,
  sessionId,
}: AgentTurnBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!agentMessage) return;
    navigator.clipboard.writeText(agentMessage.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [agentMessage]);

  // Classify all tool calls
  const classified = useMemo(() => classifyToolCalls(toolCalls), [toolCalls]);

  // Merge regular tool call steps, thinking blocks, and narrations — sorted chronologically
  const turnItems = useMemo<TurnItem[]>(() => {
    const items: TurnItem[] = [
      ...classified.steps.map((tc) => ({ type: "tool" as const, data: tc })),
      ...thinkingBlocks.map((tb) => ({ type: "thinking" as const, data: tb })),
      ...narrations.map((msg) => ({ type: "narration" as const, data: msg })),
    ];
    items.sort((a, b) => a.data.timestamp - b.data.timestamp);
    return items;
  }, [classified.steps, thinkingBlocks, narrations]);

  const hasSteps = turnItems.length > 0;
  const hasMcpVisuals = classified.filesChanged.length > 0 || classified.errors.length > 0
    || classified.completion !== null || classified.waiting !== null
    || classified.tasksCreated.length > 0 || classified.taskUpdates.length > 0;
  const hasAnything = hasSteps || hasMcpVisuals;

  // Nothing to render
  if (!hasAnything && !agentMessage) return null;

  // No steps and no MCP visuals — plain assistant message
  if (!hasAnything && agentMessage) {
    return <ChatMessage message={agentMessage} isStreaming={isStreaming} />;
  }

  const hasResponse = agentMessage && agentMessage.text.length > 0;

  // Count remaining visual elements after tool/thinking steps
  const mcpElementCount = (classified.filesChanged.length > 0 ? 1 : 0)
    + classified.errors.length
    + (classified.waiting ? 1 : 0)
    + (classified.completion ? 1 : 0)
    + classified.tasksCreated.length
    + classified.taskUpdates.length;
  const hasAfterSteps = mcpElementCount > 0 || !!hasResponse;

  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        {/* Progress bar — ambient, not a step */}
        <ProgressIndicator progress={classified.progress} />

        <ChainOfThought defaultOpen className="space-y-0">
          {/* Interleaved tool calls and thinking blocks (chronological) */}
          {turnItems.length <= COLLAPSE_THRESHOLD ? (
            // Few enough items — render all directly
            turnItems.map((item, i) => {
              const isLast = i === turnItems.length - 1;
              const hasNext = !isLast || hasAfterSteps;
              return renderTurnItem(item, hasNext, sessionId);
            })
          ) : (
            // Too many items — show head, collapsed middle, tail
            <>
              {/* Head items (first N) */}
              {turnItems.slice(0, VISIBLE_HEAD).map((item) =>
                renderTurnItem(item, true, sessionId),
              )}

              {/* Collapsed middle */}
              {(() => {
                const middleItems = turnItems.slice(VISIBLE_HEAD, turnItems.length - VISIBLE_TAIL);
                const runningCount = middleItems.filter(
                  (item) => item.type === "tool" && (item.data as AcpToolCallState).status === "in_progress",
                ).length;
                return (
                  <CollapsedToolCallsSummary
                    collapsedItems={middleItems}
                    totalCount={middleItems.length}
                    runningCount={runningCount}
                    sessionId={sessionId}
                    hasNextAfterTail={true}
                  />
                );
              })()}

              {/* Tail items (last N) */}
              {turnItems.slice(turnItems.length - VISIBLE_TAIL).map((item, i) => {
                const isLast = i === VISIBLE_TAIL - 1;
                const hasNext = !isLast || hasAfterSteps;
                return renderTurnItem(item, hasNext, sessionId);
              })}
            </>
          )}

          {/* Files changed badges */}
          {classified.filesChanged.length > 0 && (
            <FilesChangedIndicator files={classified.filesChanged} />
          )}

          {/* Tasks created */}
          <TaskCreatedIndicator tasks={classified.tasksCreated}
            hasNext={classified.taskUpdates.length > 0 || classified.errors.length > 0 || !!classified.waiting || !!classified.completion || !!hasResponse} />

          {/* Task updates */}
          <TaskUpdatedIndicator updates={classified.taskUpdates}
            hasNext={classified.errors.length > 0 || !!classified.waiting || !!classified.completion || !!hasResponse} />

          {/* Error callouts */}
          <ErrorIndicator errors={classified.errors}
            hasNext={!!classified.waiting || !!classified.completion || !!hasResponse} />

          {/* Waiting prompt */}
          <WaitingIndicator waiting={classified.waiting}
            hasNext={!!classified.completion || !!hasResponse} />

          {/* Completion summary */}
          <CompletionIndicator completion={classified.completion}
            hasNext={!!hasResponse} />

          {/* Response step */}
          {hasResponse && (
            <ChainOfThoughtStep
              icon={MessageCircle}
              status={isStreaming ? "active" : "complete"}
              className="[&>div:first-child>div:last-child]:hidden text-foreground"
              label={
                <div className="min-w-0 rounded-lg bg-card px-4 py-3">
                  <MessageResponse mode={isStreaming ? "streaming" : "static"}>
                    {agentMessage.text}
                  </MessageResponse>
                </div>
              }
            />
          )}
        </ChainOfThought>
      </MessageContent>

      {hasResponse && (
        <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
          <MessageAction tooltip="Copy message" onClick={handleCopy}>
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
          </MessageAction>
        </MessageActions>
      )}
    </Message>
  );
});
