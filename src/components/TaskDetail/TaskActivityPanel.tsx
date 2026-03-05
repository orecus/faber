import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  FolderSync,
  Github,
  History,
  Loader2,
  MessageSquare,
  MessageCircle,
  RefreshCw,
  Send,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import {
  streamdownControls,
  streamdownPlugins,
  streamdownTheme,
} from "../../lib/markdown";
import { formatError } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import { Tabs } from "../ui/orecus.io/navigation/tabs";

import type { ThemeColor } from "../ui/orecus.io/lib/color-utils";
import type {
  GitHubComment,
  McpSessionState,
  Session,
  TaskActivity,
  TaskActivityEventType,
} from "../../types";

type ActivityTab = "agent" | "github";

interface TaskActivityPanelProps {
  linkedSession: Session | null | undefined;
  githubIssue: string;
  accentColor: ThemeColor;
  taskId: string;
  projectId: string;
}

// ── Agent Activity Tab ──

function AgentActivityContent({
  linkedSession,
  taskId,
  projectId,
}: {
  linkedSession: Session | null | undefined;
  taskId: string;
  projectId: string;
}) {
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
      // Debounce reload to avoid excessive fetches during rapid updates
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
        <p className="text-[10px] opacity-60">
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
            <p className="text-[10px] text-muted-foreground capitalize">
              {mcpStatus.activity}
            </p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {mcpStatus.current_step != null && mcpStatus.total_steps != null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
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
  // Group by session_id for visual separation
  const grouped = groupBySession(history);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Divider + header */}
      {hasLiveStatus && (
        <div className="border-t border-border/30 pt-2" />
      )}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <History size={10} className="opacity-60" />
        <span className="font-medium uppercase tracking-wider">History</span>
        {loading && <Loader2 size={10} className="animate-spin ml-1" />}
      </div>

      {/* Timeline entries */}
      <div className="flex flex-col max-h-[240px] overflow-y-auto">
        {grouped.map((group, gi) => (
          <div key={group.sessionId ?? gi} className="flex flex-col">
            {/* Session header */}
            {gi > 0 && (
              <div className="flex items-center gap-1.5 py-1.5 mt-1">
                <div className="flex-1 border-t border-border/20" />
                <span className="text-[9px] text-muted-foreground/40 shrink-0">
                  {formatSessionLabel(group)}
                </span>
                <div className="flex-1 border-t border-border/20" />
              </div>
            )}
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

  const hasDetails = details != null && details !== label;

  return (
    <div
      className={`group py-[3px] ${hasDetails ? "cursor-pointer" : ""}`}
      onClick={hasDetails ? () => setExpanded((v) => !v) : undefined}
    >
      {/* First row — icon, time, label all vertically centered */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] leading-none tabular-nums text-muted-foreground/60 w-[38px] shrink-0">
          {time}
        </span>
        <span className={`shrink-0 flex items-center ${color}`}>
          {icon}
        </span>
        <p
          className={`text-[11px] leading-none text-muted-foreground flex-1 min-w-0 transition-colors ${
            hasDetails ? "group-hover:text-foreground" : ""
          } ${expanded ? "" : "truncate"}`}
        >
          {label}
          {hasDetails && !expanded && (
            <span className="ml-1 text-[9px] text-muted-foreground/40">
              &#x25BC;
            </span>
          )}
        </p>
      </div>
      {/* Expanded details — indented to align with label text */}
      {expanded && details && (
        <p className="text-[11px] text-muted-foreground/80 leading-snug mt-1 ml-[54px] whitespace-pre-wrap break-words">
          {details}
        </p>
      )}
    </div>
  );
}

// ── StatusIcon (reused for live status) ──

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

// ── GitHub Activity Tab ──

/** Parse issue number from a github_issue ref like "owner/repo#123" or just "123". */
function parseIssueNumber(githubIssue: string): number | null {
  const match = githubIssue.match(/#?(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/** Format an ISO timestamp into a relative string like "2h ago", "3d ago". */
function relativeTime(iso: string): string {
  try {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    const diffMo = Math.floor(diffDay / 30);
    if (diffMo < 12) return `${diffMo}mo ago`;
    return `${Math.floor(diffMo / 12)}y ago`;
  } catch {
    return "";
  }
}

function GitHubActivityContent({
  githubIssue,
  projectId,
}: {
  githubIssue: string;
  projectId: string;
}) {
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const issueNumber = useMemo(
    () => parseIssueNumber(githubIssue),
    [githubIssue],
  );

  const fetchComments = useCallback(() => {
    if (!issueNumber || !projectId) return;
    setLoading(true);
    setError(null);
    invoke<GitHubComment[]>("fetch_issue_comments", {
      projectId,
      issueNumber,
    })
      .then(setComments)
      .catch((err) => {
        console.warn("Failed to fetch issue comments:", err);
        setError(formatError(err) || "Failed to load comments");
        setComments([]);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [projectId, issueNumber]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchComments();
  }, [fetchComments]);

  const handlePost = useCallback(() => {
    if (!issueNumber || !projectId || !commentBody.trim()) return;
    setPosting(true);
    invoke("post_issue_comment", {
      projectId,
      issueNumber,
      body: commentBody.trim(),
    })
      .then(() => {
        setCommentBody("");
        fetchComments();
      })
      .catch((err) => {
        console.warn("Failed to post comment:", err);
        setError(formatError(err) || "Failed to post comment");
      })
      .finally(() => setPosting(false));
  }, [projectId, issueNumber, commentBody, fetchComments]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handlePost();
      }
    },
    [handlePost],
  );

  if (!githubIssue) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <Github size={20} className="opacity-40" />
        <p className="text-xs">No GitHub issue linked</p>
        <p className="text-[10px] opacity-60">
          Link a GitHub issue to see comments and activity
        </p>
      </div>
    );
  }

  if (loading && comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <Loader2 size={18} className="animate-spin opacity-50" />
        <p className="text-xs">Loading comments…</p>
      </div>
    );
  }

  if (error && comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
        <AlertCircle size={18} className="opacity-50 text-destructive" />
        <p className="text-xs text-destructive/80">{error}</p>
        <button
          onClick={handleRefresh}
          className="mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-primary hover:bg-accent transition-colors"
        >
          <RefreshCw size={10} />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* Header with issue ref + refresh */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase">
          {githubIssue}
        </span>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
          title="Refresh comments"
        >
          <RefreshCw
            size={10}
            className={refreshing ? "animate-spin" : ""}
          />
        </button>
      </div>

      {/* Error banner (non-blocking, when we already have comments) */}
      {error && (
        <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
          <AlertCircle size={10} className="shrink-0" />
          <span className="flex-1 truncate">{error}</span>
        </div>
      )}

      {/* Comment list */}
      {comments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-muted-foreground">
          <MessageCircle size={16} className="opacity-30" />
          <p className="text-xs">No comments yet</p>
          <p className="text-[10px] opacity-50">Be the first to comment</p>
        </div>
      ) : (
        <div className="flex flex-col gap-0 -mx-0.5 px-0.5">
          {comments.map((comment, i) => (
            <React.Fragment key={comment.id}>
              {i > 0 && <div className="border-t border-border/20 my-1.5" />}
              <CommentEntry comment={comment} />
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
        <textarea
          ref={textareaRef}
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a comment…"
          rows={2}
          disabled={posting}
          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground/40">
            {commentBody.trim() ? "⌘↵ to send" : ""}
          </span>
          <button
            onClick={handlePost}
            disabled={posting || !commentBody.trim()}
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            {posting ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Send size={10} />
            )}
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Single Comment Entry ──

const CommentEntry = React.memo(function CommentEntry({
  comment,
}: {
  comment: GitHubComment;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* Author row */}
      <div className="flex items-center gap-1.5">
        {comment.author_avatar ? (
          <img
            src={comment.author_avatar}
            alt={comment.author}
            className="size-5 rounded-full ring-1 ring-border/30"
          />
        ) : (
          <div className="size-5 rounded-full bg-accent flex items-center justify-center">
            <span className="text-[9px] font-medium text-muted-foreground">
              {comment.author.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <span className="text-[11px] font-medium text-foreground">
          {comment.author}
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {relativeTime(comment.created_at)}
        </span>
      </div>
      {/* Comment body — compact markdown */}
      <div className="ml-[26px] comment-markdown">
        <Streamdown mode="static" plugins={streamdownPlugins} shikiTheme={streamdownTheme} controls={streamdownControls}>{comment.body}</Streamdown>
      </div>
    </div>
  );
});

// ── Helpers ──

interface SessionGroup {
  sessionId: string | null;
  events: TaskActivity[];
}

function groupBySession(events: TaskActivity[]): SessionGroup[] {
  // Events come in DESC order from DB; reverse for chronological display
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

/** Build a readable label for a session separator. Shows the session start time
 *  derived from the group's first event timestamp. */
function formatSessionLabel(group: SessionGroup): string {
  const first = group.events[0];
  if (!first) return "session";

  try {
    const d = new Date(first.timestamp);
    const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${dateStr}, ${timeStr}`;
  } catch {
    return `session ${group.sessionId?.slice(-6) ?? ""}`;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

interface EventDisplay {
  icon: React.ReactNode;
  /** Short single-line summary shown in the collapsed row. */
  label: string;
  /**
   * Optional expanded details. When present and different from `label`,
   * the entry becomes clickable and shows `details` below `label` when expanded.
   */
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
      // Show full message as details when it's long
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
      // Expand to show individual file paths
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
      // Combine error + details for expanded view
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
      // Summaries are often multi-line or long — always make expandable if > 40 chars
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

// ── Main Panel ──

const TaskActivityPanel = React.memo(function TaskActivityPanel({
  linkedSession,
  githubIssue,
  accentColor,
  taskId,
  projectId,
}: TaskActivityPanelProps) {
  const [activeTab, setActiveTab] = useState<ActivityTab>("agent");

  return (
    <div className="flex flex-col">
      <Tabs<ActivityTab>
        value={activeTab}
        onChange={setActiveTab}
        animation="slide"
        variant="none"
        indicatorVariant="color"
        size="sm"
        color={accentColor}
        align="start"
        barRadius="md"
        tabRadius="md"
        fullWidth={false}
      >
        <Tabs.Tab value="agent" icon={<Activity size={12} />}>
          Agent Activity
        </Tabs.Tab>
        <Tabs.Tab
          value="github"
          icon={<Github size={12} />}
          disabled={!githubIssue}
        >
          Comments
        </Tabs.Tab>
      </Tabs>

      <div className="mt-1">
        {activeTab === "agent" && (
          <AgentActivityContent
            linkedSession={linkedSession}
            taskId={taskId}
            projectId={projectId}
          />
        )}
        {activeTab === "github" && (
          <GitHubActivityContent
            githubIssue={githubIssue}
            projectId={projectId}
          />
        )}
      </div>
    </div>
  );
});

export default TaskActivityPanel;
