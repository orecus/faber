import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  FolderSync,
  History,
  Loader2,
  MessageSquare,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useAppStore } from "../../store/appStore";
import type {
  McpSessionState,
  Session,
  TaskActivity,
  TaskActivityEventType,
} from "../../types";

interface AgentActivityTabProps {
  linkedSession: Session | null | undefined;
  taskId: string;
  projectId: string;
}

// ── Main Component ──

export default function AgentActivityTab({
  linkedSession,
  taskId,
  projectId,
}: AgentActivityTabProps) {
  const mcpStatus = useAppStore(
    (s) =>
      (linkedSession?.id ? s.mcpStatus[linkedSession.id] : undefined) as
        | McpSessionState
        | undefined,
  );

  const [history, setHistory] = useState<TaskActivity[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadHistory = useCallback(() => {
    if (!taskId || !projectId) return;
    setLoadingHistory(true);
    invoke<TaskActivity[]>("get_task_activity", {
      projectId,
      taskId,
      limit: 100,
    })
      .then(setHistory)
      .catch((err) => {
        console.warn("Failed to load task activity:", err);
        setHistory([]);
      })
      .finally(() => setLoadingHistory(false));
  }, [taskId, projectId]);

  // Load on mount and when task changes
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Reload when MCP status changes (new events arrive)
  useEffect(() => {
    if (mcpStatus) {
      const timer = setTimeout(loadHistory, 2000);
      return () => clearTimeout(timer);
    }
  }, [mcpStatus?.status, mcpStatus?.current_step, mcpStatus?.completed, loadHistory]);

  const hasLiveStatus = linkedSession && mcpStatus;
  const hasHistory = history.length > 0;

  if (!hasLiveStatus && !hasHistory && !loadingHistory) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <Activity size={20} className="opacity-40" />
        <p className="text-xs">No agent activity or history yet</p>
        <p className="text-2xs opacity-60">
          Launch a session for this task to see agent activity
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      {/* Live status */}
      {hasLiveStatus && (
        <LiveStatusSection mcpStatus={mcpStatus} />
      )}

      {/* History timeline */}
      {(hasHistory || loadingHistory) && (
        <HistorySection
          history={history}
          loading={loadingHistory}
          hasLiveStatus={!!hasLiveStatus}
        />
      )}
    </div>
  );
}

// ── Live Status Section ──

function LiveStatusSection({ mcpStatus }: { mcpStatus: McpSessionState }) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* Status row */}
      <div className="flex items-center gap-2">
        <StatusIcon mcpStatus={mcpStatus} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">
            {mcpStatus.message || mcpStatus.status || "Working"}
          </p>
          {mcpStatus.activity && (
            <p className="text-2xs text-muted-foreground capitalize">
              {mcpStatus.activity}
            </p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {mcpStatus.current_step != null && mcpStatus.total_steps != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-2xs text-muted-foreground">
            <span>{mcpStatus.description || "Processing"}</span>
            <span>
              {mcpStatus.current_step}/{mcpStatus.total_steps}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-accent">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${(mcpStatus.current_step / mcpStatus.total_steps) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {mcpStatus.error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <p className="flex-1">{mcpStatus.error_message || "An error occurred"}</p>
        </div>
      )}

      {/* Waiting */}
      {mcpStatus.waiting && (
        <div className="flex items-start gap-2 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">
          <MessageSquare size={13} className="mt-0.5 shrink-0" />
          <p className="flex-1">
            {mcpStatus.waiting_question || "Waiting for input"}
          </p>
        </div>
      )}

      {/* Completed */}
      {mcpStatus.completed && (
        <div className="flex items-start gap-2 rounded-md bg-success/10 px-2.5 py-2 text-xs text-success">
          <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
          <p className="flex-1">{mcpStatus.summary || "Task completed"}</p>
        </div>
      )}
    </div>
  );
}

// ── StatusIcon ──

function StatusIcon({ mcpStatus }: { mcpStatus: McpSessionState }) {
  if (mcpStatus.completed) {
    return <CheckCircle2 size={14} className="shrink-0 text-success" />;
  }
  if (mcpStatus.error) {
    return <AlertCircle size={14} className="shrink-0 text-destructive" />;
  }
  if (mcpStatus.waiting) {
    return <MessageSquare size={14} className="shrink-0 text-warning" />;
  }
  return <Loader2 size={14} className="shrink-0 animate-spin text-primary" />;
}

// ── History Section ──

function HistorySection({
  history,
  loading,
  hasLiveStatus,
}: {
  history: TaskActivity[];
  loading: boolean;
  hasLiveStatus: boolean;
}) {
  const grouped = groupBySession(history);

  return (
    <div className="flex flex-col gap-1.5">
      {hasLiveStatus && (
        <div className="border-t border-border/30 pt-2" />
      )}
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <History size={10} className="opacity-60" />
        <span className="font-medium uppercase tracking-wider">History</span>
        {loading && <Loader2 size={10} className="animate-spin ml-1" />}
      </div>

      <div className="flex flex-col">
        {grouped.map((group, gi) => (
          <div key={group.sessionId ?? gi} className="flex flex-col">
            <div className={`flex items-center gap-1.5 py-1.5 ${gi > 0 ? "mt-1" : ""}`}>
              <div className="flex-1 border-t border-border/20" />
              <span className="text-2xs text-muted-foreground/40 shrink-0">
                {formatSessionLabel(group)}
              </span>
              <div className="flex-1 border-t border-border/20" />
            </div>
            {group.events.map((event) => (
              <HistoryEntry key={event.id} event={event} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Single History Entry ──

function HistoryEntry({ event }: { event: TaskActivity }) {
  const time = formatTimestamp(event.timestamp);
  const display = useMemo(
    () => getEventDisplay(event.event_type, event.data),
    [event.event_type, event.data],
  );
  const { icon, label, details, color } = display;
  const [expanded, setExpanded] = useState(false);

  const EXPANDABLE_THRESHOLD = 50;
  const hasSeparateDetails = details != null && details !== label;
  const isExpandable = hasSeparateDetails || label.length > EXPANDABLE_THRESHOLD;

  return (
    <div
      className={`group py-[3px] ${isExpandable ? "cursor-pointer" : ""}`}
      onClick={isExpandable ? () => setExpanded((v) => !v) : undefined}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs leading-none tabular-nums text-muted-foreground/60 w-[38px] shrink-0">
          {time}
        </span>
        <span className={`shrink-0 flex items-center ${color}`}>
          {icon}
        </span>
        <p
          className={`text-xs leading-none text-muted-foreground flex-1 min-w-0 truncate transition-colors ${
            isExpandable ? "group-hover:text-foreground" : ""
          }`}
        >
          {label}
        </p>
        {isExpandable && (
          <ChevronDown
            size={12}
            className={`shrink-0 text-muted-foreground/40 transition-transform duration-150 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        )}
      </div>
      {expanded && (
        <p className="text-xs text-muted-foreground/80 leading-snug mt-1 ml-[54px] whitespace-pre-wrap break-words">
          {hasSeparateDetails ? details : label}
        </p>
      )}
    </div>
  );
}

// ── Helpers ──

interface SessionGroup {
  sessionId: string | null;
  events: TaskActivity[];
}

function groupBySession(events: TaskActivity[]): SessionGroup[] {
  const chronological = [...events].reverse();
  const groups: SessionGroup[] = [];
  let current: SessionGroup | null = null;

  for (const event of chronological) {
    if (!current || current.sessionId !== event.session_id) {
      current = { sessionId: event.session_id, events: [] };
      groups.push(current);
    }
    current.events.push(event);
  }

  return groups;
}

function formatSessionLabel(group: SessionGroup): string {
  const first = group.events[0];
  if (!first) return "session";

  try {
    const d = new Date(first.timestamp);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  } catch {
    return `session ${group.sessionId?.slice(-6) ?? ""}`;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "\u2014";
  }
}

interface EventDisplay {
  icon: React.ReactNode;
  label: string;
  details: string | null;
  color: string;
}

function getEventDisplay(
  eventType: TaskActivityEventType,
  data: Record<string, unknown>,
): EventDisplay {
  switch (eventType) {
    case "status": {
      const activity = data.activity as string | undefined;
      const message = data.message as string | undefined;
      const status = data.status as string | undefined;
      const activityLabel = activity || status || "working";
      const displayMsg = message || activityLabel;
      return {
        icon: <Activity size={10} />,
        label: displayMsg,
        details: displayMsg.length > 60 ? displayMsg : null,
        color: "text-primary/70",
      };
    }
    case "progress": {
      const step = data.current_step as number | undefined;
      const total = data.total_steps as number | undefined;
      const desc = data.description as string | undefined;
      const shortLabel = `${desc || "Step"} (${step ?? "?"}/${total ?? "?"})`;
      return {
        icon: <Clock size={10} />,
        label: shortLabel,
        details: desc && desc.length > 50 ? desc : null,
        color: "text-primary/70",
      };
    }
    case "files_changed": {
      const files = data.files as Array<{ path: string; action: string }> | undefined;
      const count = files?.length ?? 0;
      const shortLabel = `${count} file${count !== 1 ? "s" : ""} changed`;
      const fileList = files?.map((f) => `${f.path} (${f.action})`).join("\n") ?? null;
      return {
        icon: <FolderSync size={10} />,
        label: shortLabel,
        details: count > 0 ? fileList : null,
        color: "text-muted-foreground",
      };
    }
    case "error": {
      const error = data.error as string | undefined;
      const errorDetails = data.details as string | undefined;
      const shortLabel = error || "Error occurred";
      const full = errorDetails
        ? `${error}\n${errorDetails}`
        : error && error.length > 60
          ? error
          : null;
      return {
        icon: <AlertCircle size={10} />,
        label: shortLabel,
        details: full,
        color: "text-destructive/80",
      };
    }
    case "waiting": {
      const question = data.question as string | undefined;
      const shortLabel = question || "Waiting for input";
      return {
        icon: <MessageSquare size={10} />,
        label: shortLabel,
        details: shortLabel.length > 60 ? shortLabel : null,
        color: "text-warning/80",
      };
    }
    case "complete": {
      const summary = data.summary as string | undefined;
      const filesChanged = data.files_changed as number | undefined;
      const shortLabel = summary || "Completed";
      const full =
        summary && summary.length > 40
          ? filesChanged != null
            ? `${summary}\n\n${filesChanged} file${filesChanged !== 1 ? "s" : ""} changed`
            : summary
          : filesChanged != null && summary
            ? `${summary} (${filesChanged} file${filesChanged !== 1 ? "s" : ""} changed)`
            : null;
      return {
        icon: <CheckCircle2 size={10} />,
        label: shortLabel,
        details: full && full !== shortLabel ? full : null,
        color: "text-success/80",
      };
    }
    default:
      return {
        icon: <Activity size={10} />,
        label: eventType,
        details: null,
        color: "text-muted-foreground",
      };
  }
}
