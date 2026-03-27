import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { formatErrorWithHint } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import AgentCardGrid from "../Launchers/AgentCardGrid";
import ConfirmDialog from "../Review/ConfirmDialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import ChatPane from "./ChatPane";
import ThreadStatusBadge from "./ThreadStatusBadge";

import type { AgentSessionInfo, Session, SessionMode } from "../../types";
import { cn } from "@/lib/utils";

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

/** Faber metadata matched from active sessions by acp_session_id. */
interface FaberSessionMeta {
  mode: SessionMode;
  taskId: string | null;
  isActive: boolean;
}

const MODE_CONFIG: Record<string, { label: string; className: string }> = {
  chat: { label: "Chat", className: "bg-primary/15 text-primary" },
  vibe: { label: "Vibe", className: "bg-violet-500/15 text-violet-400" },
  task: { label: "Task", className: "bg-success/15 text-success" },
  research: { label: "Research", className: "bg-warning/15 text-warning" },
  shell: { label: "Shell", className: "bg-muted text-muted-foreground" },
};

/**
 * ChatView — project-scoped chat view.
 *
 * Finds or launches a lightweight ACP "chat" session per project,
 * then renders ChatPane with that session. No task binding, no worktree.
 */
const ChatView = memo(function ChatView() {
  const accentColor = useProjectAccentColor();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const sessions = useAppStore((s) => s.sessions);
  const agents = useAppStore((s) => s.agents);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const fetchAgentSessionList = useAppStore((s) => s.fetchAgentSessionList);
  const retryAgentSessionList = useAppStore((s) => s.retryAgentSessionList);
  const removeAgentSession = useAppStore((s) => s.removeAgentSession);
  const agentSessionList = useAppStore((s) => s.agentSessionList);
  const agentSessionListSupported = useAppStore(
    (s) => s.agentSessionListSupported,
  );
  const agentLoadSessionSupported = useAppStore(
    (s) => s.agentLoadSessionSupported,
  );
  const agentSessionListLoading = useAppStore((s) => s.agentSessionListLoading);
  const agentSessionListFetchedAt = useAppStore(
    (s) => s.agentSessionListFetchedAt,
  );

  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [launching, setLaunching] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  // Find the active chat session for this project
  const chatSession: Session | undefined = useMemo(
    () =>
      sessions.find(
        (s) =>
          s.project_id === activeProjectId &&
          s.mode === "chat" &&
          s.transport === "acp" &&
          (s.status === "running" || s.status === "starting"),
      ),
    [sessions, activeProjectId],
  );

  // ACP-capable agents only
  const acpAgents = useMemo(
    () => agents.filter((a) => a.installed && a.acp_installed),
    [agents],
  );

  // Default to first ACP agent
  useEffect(() => {
    if (acpAgents.length > 0 && !selectedAgentName) {
      setSelectedAgentName(acpAgents[0].name);
    }
  }, [acpAgents, selectedAgentName]);

  // Session list key and data
  const sessionListKey =
    selectedAgentName && activeProjectId
      ? `${selectedAgentName}:${activeProjectId}`
      : null;
  const sessionHistory = sessionListKey
    ? (agentSessionList[sessionListKey] ?? null)
    : null;
  const isListLoading = sessionListKey
    ? (agentSessionListLoading[sessionListKey] ?? false)
    : false;
  const isListSupported = selectedAgentName
    ? (agentSessionListSupported[selectedAgentName] ?? true)
    : true;
  const isLoadSupported = selectedAgentName
    ? (agentLoadSessionSupported[selectedAgentName] ?? true)
    : true;

  // Auto-fetch session list when empty state is shown or cache is stale (>60s)
  const SESSION_LIST_TTL_MS = 60_000;
  useEffect(() => {
    if (
      !chatSession &&
      selectedAgentName &&
      activeProjectId &&
      !isListLoading
    ) {
      const fetchedAt = sessionListKey
        ? (agentSessionListFetchedAt[sessionListKey] ?? 0)
        : 0;
      const isStale =
        sessionHistory === null || Date.now() - fetchedAt > SESSION_LIST_TTL_MS;
      if (isStale) {
        fetchAgentSessionList(selectedAgentName, activeProjectId);
      }
    }
  }, [
    chatSession,
    selectedAgentName,
    activeProjectId,
    sessionHistory,
    sessionListKey,
    agentSessionListFetchedAt,
    isListLoading,
    fetchAgentSessionList,
  ]);

  // Re-fetch when agent changes
  const handleAgentSelect = useCallback(
    (name: string) => {
      setSelectedAgentName(name);
      if (activeProjectId) {
        fetchAgentSessionList(name, activeProjectId);
      }
    },
    [activeProjectId, fetchAgentSessionList],
  );

  // Filter sessions by search
  const filteredSessions = useMemo(() => {
    if (!sessionHistory) return [];
    if (!searchFilter.trim()) return sessionHistory;
    const q = searchFilter.toLowerCase();
    return sessionHistory.filter(
      (s) =>
        s.title?.toLowerCase().includes(q) ||
        s.session_id.toLowerCase().includes(q),
    );
  }, [sessionHistory, searchFilter]);

  const handleStartChat = useCallback(async () => {
    if (!activeProjectId || !selectedAgentName || launching) return;
    setError(null);
    setLaunching(true);
    const taskLabel = "Starting chat session";
    addBackgroundTask(taskLabel);
    try {
      await invoke("start_chat_session", {
        projectId: activeProjectId,
        agentName: selectedAgentName,
      });
    } catch (err) {
      setError(formatErrorWithHint(err, "agent-launch"));
    } finally {
      setLaunching(false);
      removeBackgroundTask(taskLabel);
    }
  }, [
    activeProjectId,
    selectedAgentName,
    launching,
    addBackgroundTask,
    removeBackgroundTask,
  ]);

  /** Resume into ChatView (stays on chat tab). */
  const handleResumeInChat = useCallback(
    async (agentSessionId: string) => {
      if (!activeProjectId || !selectedAgentName || resuming) return;
      setError(null);
      setResuming(agentSessionId);
      const taskLabel = "Resuming chat session";
      addBackgroundTask(taskLabel);
      try {
        await invoke("resume_acp_session", {
          projectId: activeProjectId,
          agentName: selectedAgentName,
          agentSessionId,
        });
      } catch (err) {
        setError(formatErrorWithHint(err, "agent-launch"));
        // Remove the failed session from cache (expired/deleted by agent)
        removeAgentSession(selectedAgentName, activeProjectId, agentSessionId);
      } finally {
        setResuming(null);
        removeBackgroundTask(taskLabel);
      }
    },
    [
      activeProjectId,
      selectedAgentName,
      resuming,
      addBackgroundTask,
      removeBackgroundTask,
      removeAgentSession,
    ],
  );

  /** Resume and open in Sessions view as a session pane. */
  const handleLaunchAsSession = useCallback(
    async (agentSessionId: string) => {
      if (!activeProjectId || !selectedAgentName || resuming) return;
      setError(null);
      setResuming(agentSessionId);
      const taskLabel = "Launching session";
      addBackgroundTask(taskLabel);
      try {
        await invoke("resume_acp_session", {
          projectId: activeProjectId,
          agentName: selectedAgentName,
          agentSessionId,
          target: "session",
        });
        // Navigate to Sessions view so it appears as a session pane
        setActiveView("sessions");
      } catch (err) {
        setError(formatErrorWithHint(err, "agent-launch"));
        // Remove the failed session from cache (expired/deleted by agent)
        removeAgentSession(selectedAgentName, activeProjectId, agentSessionId);
      } finally {
        setResuming(null);
        removeBackgroundTask(taskLabel);
      }
    },
    [
      activeProjectId,
      selectedAgentName,
      resuming,
      addBackgroundTask,
      removeBackgroundTask,
      removeAgentSession,
      setActiveView,
    ],
  );

  const handleCloseChat = useCallback(async () => {
    if (!chatSession) return;
    try {
      await invoke("stop_and_remove_session", { sessionId: chatSession.id });
    } catch (err) {
      console.error("Failed to close chat session:", err);
      try {
        await invoke("remove_session", { sessionId: chatSession.id });
      } catch (innerErr) {
        console.error("Fallback remove also failed:", innerErr);
      }
    }
    useAppStore.getState().cleanupSessionAcp(chatSession.id);
  }, [chatSession]);

  const handleRefreshList = useCallback(() => {
    if (selectedAgentName && activeProjectId) {
      fetchAgentSessionList(selectedAgentName, activeProjectId);
    }
  }, [selectedAgentName, activeProjectId, fetchAgentSessionList]);

  /** Retry after "not supported" — clears persisted flag and re-probes. */
  const handleRetry = useCallback(() => {
    if (selectedAgentName && activeProjectId) {
      retryAgentSessionList(selectedAgentName, activeProjectId);
    }
  }, [selectedAgentName, activeProjectId, retryAgentSessionList]);

  // Cross-reference: map agent session IDs to Faber session metadata for enrichment.
  // Only active sessions are in the store (DB deletes on close), so this enriches
  // currently-running sessions. Historical enrichment requires T-102 (history table).
  const acpSessionMap = useMemo(() => {
    const map = new Map<string, FaberSessionMeta>();
    for (const s of sessions) {
      if (s.acp_session_id && s.project_id === activeProjectId) {
        map.set(s.acp_session_id, {
          mode: s.mode,
          taskId: s.task_id,
          isActive: s.status === "running" || s.status === "starting",
        });
      }
    }
    return map;
  }, [sessions, activeProjectId]);

  // Whether to show the session history sidebar
  const showHistory =
    acpAgents.length > 0 && (sessionHistory !== null || isListLoading);

  // Active chat session → render ChatPane
  if (chatSession) {
    return (
      <div
        className="flex flex-col px-3 pt-2 gap-2 min-h-0 overflow-hidden bg-card/80"
        style={{ gridArea: "content" }}
      >
        {/* Minimal toolbar */}
        <div className="flex items-center gap-2 py-1.5 shrink-0">
          <MessageCircle size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">
            Project Chat
          </span>
          <span className="text-xs text-muted-foreground">
            &middot; {chatSession.agent}
          </span>
          <ThreadStatusBadge
            sessionId={chatSession.id}
            sessionStatus={chatSession.status}
          />
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCloseConfirm(true)}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            hoverEffect="none"
            clickEffect="none"
            leftIcon={<X size={12} />}
            title="Close chat session"
          >
            Close
          </Button>
        </div>

        {showCloseConfirm && (
          <ConfirmDialog
            title="Close chat session?"
            message="This will end the current chat session. Your conversation history will be lost."
            variant="danger"
            confirmLabel="Close"
            onConfirm={() => {
              setShowCloseConfirm(false);
              handleCloseChat();
            }}
            onCancel={() => setShowCloseConfirm(false)}
          />
        )}

        {/* Chat content */}
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0">
            <ChatPane
              sessionId={chatSession.id}
              sessionStatus={chatSession.status}
            />
          </div>
        </div>
      </div>
    );
  }

  // No active session → two-column layout: new chat (left) + session history (right)
  return (
    <div
      className="flex min-h-0 overflow-hidden bg-card/80"
      style={{ gridArea: "content" }}
    >
      {/* Left column — new chat launcher */}
      <div className="flex flex-col items-center justify-center flex-1 min-w-0 px-6">
        <div
          className={cn(
            "flex flex-col items-center gap-5 w-full",
            showHistory ? "max-w-sm" : "max-w-md",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <MessageCircle
              size={24}
              strokeWidth={1.5}
              className="text-primary"
            />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Project Chat
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Discuss architecture, explore ideas, or ask questions.
            </p>
          </div>

          {/* Agent selector */}
          {acpAgents.length > 0 ? (
            <div className="w-full">
              <label className="mb-1.5 block text-xs text-dim-foreground">
                Agent
              </label>
              <AgentCardGrid
                selectedAgentName={selectedAgentName}
                onSelect={handleAgentSelect}
                accentColor={accentColor}
                isDisabled={(a) => !a.installed || !a.acp_installed}
                showStatus
              />
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg bg-warning/10 ring-1 ring-warning/20 px-3 py-2.5 w-full">
              <AlertTriangle
                size={14}
                className="text-warning shrink-0 mt-0.5"
              />
              <p className="text-xs text-warning">
                No ACP-capable agents installed. Chat requires an agent with ACP
                support (e.g. Claude Code with the ACP adapter).
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 ring-1 ring-destructive/20 px-3 py-2.5 w-full">
              <AlertTriangle
                size={14}
                className="text-destructive shrink-0 mt-0.5"
              />
              <p className="text-xs text-destructive whitespace-pre-line">
                {error}
              </p>
            </div>
          )}

          {/* Start new chat */}
          <Button
            variant="color"
            color={accentColor}
            size="sm"
            onClick={handleStartChat}
            disabled={launching || acpAgents.length === 0}
            loading={launching}
            leftIcon={
              launching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )
            }
            hoverEffect="scale-glow"
            clickEffect="scale"
          >
            New Chat
          </Button>
        </div>
      </div>

      {/* Right column — session history sidebar */}
      {showHistory && (
        <SessionHistorySidebar
          sessions={filteredSessions}
          acpSessionMap={acpSessionMap}
          isLoading={isListLoading}
          isSupported={isListSupported}
          isLoadSupported={isLoadSupported}
          searchFilter={searchFilter}
          onSearchChange={setSearchFilter}
          onResumeInChat={handleResumeInChat}
          onLaunchAsSession={handleLaunchAsSession}
          onRefresh={handleRefreshList}
          onRetry={handleRetry}
          resumingId={resuming}
          hasData={sessionHistory !== null}
        />
      )}
    </div>
  );
});

/** Skeleton placeholder row matching SessionHistoryItem shape. */
const SessionItemSkeleton = memo(function SessionItemSkeleton({
  widthClass,
}: {
  widthClass: string;
}) {
  return (
    <div className="px-3 py-2.5 border-b border-border/10">
      <div className="flex items-center gap-2 mb-1.5">
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

/** Right-side session history panel with search, skeletons, and date-grouped list. */
const SessionHistorySidebar = memo(function SessionHistorySidebar({
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
}: {
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
}) {
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

  return (
    <div className="flex flex-col w-72 shrink-0 border-l border-border/40 bg-card/60 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30 shrink-0">
        <History size={13} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">
          Previous Sessions
        </span>
        {hasData && sessions.length > 0 && (
          <span className="text-2xs text-muted-foreground/60 tabular-nums">
            {sessions.length}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
          title="Refresh session list"
        >
          <RefreshCw size={12} className={cn(isLoading && "animate-spin")} />
        </button>
      </div>

      {/* Search bar — always visible when supported (shown during loading for layout stability) */}
      {(hasData || isLoading) && isSupported && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20 shrink-0">
          <Search size={12} className="text-muted-foreground/50 shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={searchFilter}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search sessions..."
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
          />
          {searchFilter && (
            <button
              onClick={() => onSearchChange("")}
              className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <X size={10} />
            </button>
          )}
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
              className="text-xs text-primary hover:underline"
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
              />
            ))}
      </div>
    </div>
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
}: {
  session: AgentSessionInfo;
  faberMeta: FaberSessionMeta | undefined;
  onResumeInChat: (sessionId: string) => void;
  onLaunchAsSession: (sessionId: string) => void;
  isResuming: boolean;
  isDisabled: boolean;
  isLoadSupported: boolean;
}) {
  const actionsDisabled = isDisabled || !isLoadSupported;
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
              disabled={actionsDisabled}
              className={cn(
                "p-1 rounded transition-colors",
                isLoadSupported
                  ? "text-muted-foreground/50 hover:text-primary hover:bg-primary/10"
                  : "text-muted-foreground/20 cursor-not-allowed",
              )}
              title={
                isLoadSupported
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

export default ChatView;
