import {
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";

import type { FaberSessionMeta } from "../../hooks/useSessionHistory";
import type { AgentInfo, AgentSessionInfo } from "../../types";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ============================================================================
// Helpers
// ============================================================================

/** Format an ISO timestamp to a relative time string. */
function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** Assign a date group label for grouping session items. */
function getDateGroup(isoString: string | null): string {
  if (!isoString) return "Older";
  const date = new Date(isoString);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  if (date >= startOfToday) return "Today";
  if (date >= startOfYesterday) return "Yesterday";
  return "Older";
}

const MODE_CONFIG: Record<string, { label: string; className: string }> = {
  chat: { label: "Chat", className: "bg-primary/15 text-primary" },
  vibe: { label: "Vibe", className: "bg-violet-500/15 text-violet-400" },
  task: { label: "Task", className: "bg-success/15 text-success" },
  research: { label: "Research", className: "bg-warning/15 text-warning" },
  shell: { label: "Shell", className: "bg-muted text-muted-foreground" },
};

// ============================================================================
// Sub-components
// ============================================================================

/** Skeleton placeholder row matching SessionHistoryItem shape. */
const SessionItemSkeleton = memo(function SessionItemSkeleton({
  widthClass,
}: {
  widthClass: string;
}) {
  return (
    <div className="px-3 py-2.5 border-b border-border/10">
      <div
        className={cn(
          "h-3.5 rounded bg-muted-foreground/10 animate-pulse",
          widthClass,
        )}
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="h-3 w-12 rounded bg-muted-foreground/[0.06] animate-pulse" />
        <div
          className={cn(
            "h-3.5 rounded bg-muted-foreground/10 animate-pulse",
            widthClass,
          )}
        />
      </div>
      <div className="h-3 w-16 rounded bg-muted-foreground/[0.06] animate-pulse" />
    </div>
  );
});

/** Date group header between session items. */
const DateGroupHeader = memo(function DateGroupHeader({
  label,
  collapsed,
  onToggle,
  count,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  count: number;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 px-3 pt-3 pb-1.5 w-full cursor-pointer group/dg"
    >
      <ChevronRight
        size={10}
        className={cn(
          "text-muted-foreground/40 transition-transform duration-150",
          !collapsed && "rotate-90",
        )}
      />
      <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/50 group-hover/dg:text-muted-foreground transition-colors">
        {label}
      </span>
      {collapsed && (
        <span className="text-2xs text-muted-foreground/30 tabular-nums">
          {count}
        </span>
      )}
      <div className="flex-1 h-px bg-border/20" />
    </button>
  );
});

/** Individual session row with mode badge, task link, active indicator, and actions. */
const SessionHistoryItem = memo(function SessionHistoryItem({
  session,
  faberMeta,
  onResumeInChat,
  onLaunchAsSession,
  isResuming,
  isDisabled,
  isLoadSupported,
  chatSessionActive = false,
}: {
  session: AgentSessionInfo;
  faberMeta: FaberSessionMeta | undefined;
  onResumeInChat: (sessionId: string) => void;
  onLaunchAsSession: (sessionId: string) => void;
  isResuming: boolean;
  isDisabled: boolean;
  isLoadSupported: boolean;
  chatSessionActive?: boolean;
}) {
  const actionsDisabled = isDisabled || !isLoadSupported;
  const resumeInChatDisabled = actionsDisabled || chatSessionActive;
  const modeConfig = faberMeta ? MODE_CONFIG[faberMeta.mode] : null;

  return (
    <div
      className={cn(
        "group flex items-start gap-2 px-3 py-2.5 border-b border-border/10 last:border-b-0",
        "hover:bg-accent/30 transition-colors",
        isDisabled && !isResuming && "opacity-50 pointer-events-none",
      )}
    >
      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Title row with badges */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Active indicator */}
          {faberMeta?.isActive && (
            <span
              className="shrink-0 w-1.5 h-1.5 rounded-full bg-success"
              title="Active in Faber"
            />
          )}
          <p className="text-xs font-medium text-foreground truncate">
            {session.title || "Untitled session"}
          </p>
        </div>

        {/* Meta row: time, mode badge, task ID */}
        <div className="flex items-center gap-1.5 mt-0.5">
          {session.updated_at && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock size={9} className="shrink-0" />
              {formatRelativeTime(session.updated_at)}
            </span>
          )}
          {modeConfig && (
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-px rounded text-2xs font-medium leading-tight",
                modeConfig.className,
              )}
            >
              {modeConfig.label}
            </span>
          )}
          {faberMeta?.taskId && (
            <span className="inline-flex items-center px-1 py-px rounded bg-accent/60 text-2xs font-mono text-dim-foreground leading-tight">
              {faberMeta.taskId}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons — always visible, compact icon buttons */}
      <div className="flex items-center gap-0.5 shrink-0 pt-0.5">
        {isResuming ? (
          <Loader2 size={12} className="animate-spin text-muted-foreground" />
        ) : (
          <>
            <button
              onClick={() => onResumeInChat(session.session_id)}
              disabled={resumeInChatDisabled}
              className={cn(
                "p-1 rounded transition-colors",
                isLoadSupported && !chatSessionActive
                  ? "text-muted-foreground/50 hover:text-primary hover:bg-primary/10"
                  : "text-muted-foreground/20 cursor-not-allowed",
              )}
              title={
                chatSessionActive
                  ? "A chat session is already active"
                  : isLoadSupported
                    ? "Resume in chat"
                    : "This agent doesn't support resuming sessions"
              }
            >
              <MessageCircle size={12} />
            </button>
            <button
              onClick={() => onLaunchAsSession(session.session_id)}
              disabled={actionsDisabled}
              className={cn(
                "p-1 rounded transition-colors",
                isLoadSupported
                  ? "text-muted-foreground/50 hover:text-foreground hover:bg-accent/50"
                  : "text-muted-foreground/20 cursor-not-allowed",
              )}
              title={
                isLoadSupported
                  ? "Open as session pane"
                  : "This agent doesn't support resuming sessions"
              }
            >
              <ExternalLink size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// SessionHistorySidebar
// ============================================================================

export interface SessionHistoryContentProps {
  sessions: AgentSessionInfo[];
  acpSessionMap: Map<string, FaberSessionMeta>;
  isLoading: boolean;
  isSupported: boolean;
  isLoadSupported: boolean;
  searchFilter: string;
  onSearchChange: (value: string) => void;
  onResumeInChat: (sessionId: string) => void;
  onLaunchAsSession: (sessionId: string) => void;
  onRefresh: () => void;
  onRetry: () => void;
  resumingId: string | null;
  hasData: boolean;
  /** Whether "Resume in Chat" should be disabled (e.g. a chat session is already active) */
  chatSessionActive?: boolean;
  /** Available ACP agents for the selector (only shown when 2+) */
  acpAgents?: AgentInfo[];
  /** Currently selected agent name */
  selectedAgentName?: string;
  /** Callback when user picks a different agent */
  onAgentSelect?: (name: string) => void;
}

/**
 * Session history content — renders search, list, skeletons, and empty states.
 * Designed to be embedded inside any container (right sidebar tab, standalone panel, etc.).
 * Does NOT render its own panel wrapper — the parent provides the container.
 */
export const SessionHistoryContent = memo(function SessionHistoryContent({
  sessions,
  acpSessionMap,
  isLoading,
  isSupported,
  isLoadSupported,
  searchFilter,
  onSearchChange,
  onResumeInChat,
  onLaunchAsSession,
  onRefresh,
  onRetry,
  resumingId,
  hasData,
  chatSessionActive = false,
  acpAgents,
  selectedAgentName,
  onAgentSelect,
}: SessionHistoryContentProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({
    Yesterday: true,
    Older: true,
  });

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }, []);

  // Group sessions by date (skip grouping when search is active)
  const groupedSessions = useMemo(() => {
    if (!sessions.length || searchFilter) return null;
    const groups: { label: string; items: AgentSessionInfo[] }[] = [];
    let currentLabel = "";
    for (const s of sessions) {
      const label = getDateGroup(s.updated_at);
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, items: [s] });
      } else {
        groups[groups.length - 1].items.push(s);
      }
    }
    return groups;
  }, [sessions, searchFilter]);

  const showAgentSelector =
    acpAgents && acpAgents.length > 1 && onAgentSelect;
  const selectedAgent = acpAgents?.find((a) => a.name === selectedAgentName);

  return (
    <>
      {/* Toolbar: agent selector / count + refresh */}
      <div className={cn(
        "flex items-center gap-2 px-3 shrink-0 border-b border-border",
        showAgentSelector ? "py-2" : "h-[33px]",
      )}>
        {showAgentSelector ? (
          <Select
            value={selectedAgentName ?? ""}
            onValueChange={(v) => v && onAgentSelect(v)}
            items={acpAgents.map((a) => ({ value: a.name, label: a.display_name }))}
          >
            <SelectTrigger
              size="sm"
              className="min-w-0 flex-1 h-7 text-xs border-border bg-muted/50"
            >
              <SelectValue placeholder="Select agent" />
            </SelectTrigger>
            <SelectContent>
              {acpAgents.map((agent) => (
                <SelectItem key={agent.name} value={agent.name}>
                  {agent.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground truncate min-w-0">
            {selectedAgent?.display_name ??
              (hasData && sessions.length > 0
                ? `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`
                : "Previous Sessions")}
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {hasData && sessions.length > 0 && showAgentSelector && (
            <span className="text-2xs text-muted-foreground/60 tabular-nums">
              {sessions.length}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh session list"
          >
            <RefreshCw size={12} className={cn(isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Search bar — always visible when supported (shown during loading for layout stability) */}
      {(hasData || isLoading) && isSupported && (
        <div className="shrink-0 px-2 py-1.5 border-b border-border">
          <div className="relative flex items-center">
            <Search
              size={12}
              className="absolute left-2 text-muted-foreground pointer-events-none"
            />
            <input
              ref={searchRef}
              type="text"
              value={searchFilter}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search sessions..."
              className="w-full h-6 pl-6 pr-6 rounded bg-muted/50 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchFilter && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content area — scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Skeleton loading state */}
        {isLoading && !hasData && (
          <div className="pt-1">
            <SessionItemSkeleton widthClass="w-3/4" />
            <SessionItemSkeleton widthClass="w-1/2" />
            <SessionItemSkeleton widthClass="w-5/6" />
            <SessionItemSkeleton widthClass="w-2/3" />
            <SessionItemSkeleton widthClass="w-3/5" />
          </div>
        )}

        {/* Not supported */}
        {!isLoading && !isSupported && (
          <div className="flex flex-col items-center gap-2 py-10 px-4">
            <p className="text-xs text-muted-foreground text-center">
              This agent doesn't support session history.
            </p>
            <button
              onClick={onRetry}
              className="text-xs text-primary hover:underline cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty list */}
        {!isLoading &&
          isSupported &&
          hasData &&
          sessions.length === 0 &&
          !searchFilter && (
            <div className="flex flex-col items-center gap-2 py-10 px-4">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-muted/50">
                <MessageCircle size={16} className="text-muted-foreground/40" />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                No previous sessions yet.
                <br />
                <span className="text-muted-foreground/60">
                  Start a new chat to get going.
                </span>
              </p>
            </div>
          )}

        {/* No search results */}
        {hasData && isSupported && searchFilter && sessions.length === 0 && (
          <div className="flex flex-col items-center gap-1 py-10 px-4">
            <p className="text-xs text-muted-foreground">
              No sessions matching
            </p>
            <p className="text-xs text-foreground font-medium truncate max-w-full">
              &ldquo;{searchFilter}&rdquo;
            </p>
          </div>
        )}

        {/* Date-grouped session list */}
        {hasData && isSupported && sessions.length > 0 && groupedSessions
          ? groupedSessions.map((group) => (
              <div key={group.label}>
                <DateGroupHeader
                  label={group.label}
                  collapsed={!!collapsedGroups[group.label]}
                  onToggle={() => toggleGroup(group.label)}
                  count={group.items.length}
                />
                {!collapsedGroups[group.label] &&
                  group.items.map((session) => (
                    <SessionHistoryItem
                      key={session.session_id}
                      session={session}
                      faberMeta={acpSessionMap.get(session.session_id)}
                      onResumeInChat={onResumeInChat}
                      onLaunchAsSession={onLaunchAsSession}
                      isResuming={resumingId === session.session_id}
                      isDisabled={resumingId !== null}
                      isLoadSupported={isLoadSupported}
                      chatSessionActive={chatSessionActive}
                    />
                  ))}
              </div>
            ))
          : hasData &&
            isSupported &&
            sessions.length > 0 &&
            sessions.map((session) => (
              <SessionHistoryItem
                key={session.session_id}
                session={session}
                faberMeta={acpSessionMap.get(session.session_id)}
                onResumeInChat={onResumeInChat}
                onLaunchAsSession={onLaunchAsSession}
                isResuming={resumingId === session.session_id}
                isDisabled={resumingId !== null}
                isLoadSupported={isLoadSupported}
                chatSessionActive={chatSessionActive}
              />
            ))}
      </div>
    </>
  );
});
