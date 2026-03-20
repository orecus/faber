import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  History,
  Layers,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { usePersistedString } from "../../hooks/usePersistedState";
import { formatErrorWithHint } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import { cn } from "@/lib/utils";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import AgentCardGrid from "../Launchers/AgentCardGrid";
import ConfirmDialog from "../Review/ConfirmDialog";
import ChatPane from "./ChatPane";
import ThreadStatusBadge from "./ThreadStatusBadge";

import type { NarrationMode } from "./ChatPane";
import type { AgentSessionInfo, Session } from "../../types";

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
  const agentSessionListLoading = useAppStore(
    (s) => s.agentSessionListLoading,
  );

  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [launching, setLaunching] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  // Narration rendering mode — persisted across sessions
  const [narrationMode, setNarrationMode] = usePersistedString(
    "chat_narration_mode",
    "split-turns",
  ) as [NarrationMode, (v: NarrationMode) => void, boolean];

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

  // Auto-fetch session list when empty state is shown
  useEffect(() => {
    if (
      !chatSession &&
      selectedAgentName &&
      activeProjectId &&
      sessionHistory === null &&
      !isListLoading
    ) {
      fetchAgentSessionList(selectedAgentName, activeProjectId);
    }
  }, [
    chatSession,
    selectedAgentName,
    activeProjectId,
    sessionHistory,
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

  // Whether to show the session history sidebar
  const showHistory =
    acpAgents.length > 0 && (sessionHistory !== null || isListLoading);

  // Active chat session → render ChatPane
  if (chatSession) {
    return (
      <div
        className="flex flex-col px-3 py-2 gap-2 min-h-0 overflow-hidden bg-card/80"
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
          {/* Narration mode toggle */}
          <div className="inline-flex items-center rounded-md ring-1 ring-border/40 overflow-hidden">
            <button
              onClick={() => setNarrationMode("split-turns")}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors",
                narrationMode === "split-turns"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
              title="Split turns — each narration becomes its own turn with tool calls"
            >
              <Rows3 size={12} />
              <span className="hidden @xl:inline">Split</span>
            </button>
            <div className="w-px h-4 bg-border/40" />
            <button
              onClick={() => setNarrationMode("inline")}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors",
                narrationMode === "inline"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
              title="Inline — narration shown inline between tool steps in a single turn"
            >
              <Layers size={12} />
              <span className="hidden @xl:inline">Inline</span>
            </button>
          </div>
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
              narrationMode={narrationMode}
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

/** Right-side session history panel with search and scrollable list. */
const SessionHistorySidebar = memo(function SessionHistorySidebar({
  sessions,
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

  return (
    <div className="flex flex-col w-72 shrink-0 border-l border-border/40 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30 shrink-0">
        <History size={13} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">
          Previous Sessions
        </span>
        {hasData && sessions.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">
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

      {/* Search bar — always visible when there's data */}
      {hasData && isSupported && (
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
        {/* Loading state */}
        {isLoading && !hasData && (
          <div className="flex items-center justify-center gap-2 py-10">
            <Loader2
              size={14}
              className="animate-spin text-muted-foreground"
            />
            <span className="text-xs text-muted-foreground">
              Loading sessions...
            </span>
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
              className="text-[11px] text-primary hover:underline"
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
            <div className="flex flex-col items-center gap-1.5 py-10">
              <MessageCircle size={16} className="text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">
                No previous sessions
              </p>
            </div>
          )}

        {/* No search results */}
        {hasData &&
          isSupported &&
          searchFilter &&
          sessions.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-10 px-4">
              <p className="text-xs text-muted-foreground">
                No sessions matching
              </p>
              <p className="text-xs text-foreground font-medium truncate max-w-full">
                "{searchFilter}"
              </p>
            </div>
          )}

        {/* Session list */}
        {hasData &&
          isSupported &&
          sessions.length > 0 &&
          sessions.map((session) => (
            <SessionHistoryItem
              key={session.session_id}
              session={session}
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

/** Individual session row in the history list with dual actions. */
const SessionHistoryItem = memo(function SessionHistoryItem({
  session,
  onResumeInChat,
  onLaunchAsSession,
  isResuming,
  isDisabled,
  isLoadSupported,
}: {
  session: AgentSessionInfo;
  onResumeInChat: (sessionId: string) => void;
  onLaunchAsSession: (sessionId: string) => void;
  isResuming: boolean;
  isDisabled: boolean;
  isLoadSupported: boolean;
}) {
  const actionsDisabled = isDisabled || !isLoadSupported;

  return (
    <div
      className={cn(
        "group px-3 py-2.5 border-b border-border/10 last:border-b-0",
        "hover:bg-accent/30 transition-colors",
        isDisabled && !isResuming && "opacity-50 pointer-events-none",
      )}
    >
      {/* Session info */}
      <div className="min-w-0 mb-1.5">
        <p className="text-xs font-medium text-foreground truncate">
          {session.title || "Untitled session"}
        </p>
        {session.updated_at && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
            <Clock size={10} className="shrink-0" />
            {formatRelativeTime(session.updated_at)}
          </p>
        )}
      </div>

      {/* Action buttons — appear on hover */}
      <div
        className={cn(
          "flex items-center gap-1.5 transition-all",
          "opacity-0 max-h-0 group-hover:opacity-100 group-hover:max-h-8 overflow-hidden",
          isResuming && "opacity-100 max-h-8",
        )}
      >
        {isResuming ? (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 size={11} className="animate-spin" />
            Resuming...
          </span>
        ) : (
          <>
            <button
              onClick={() => onResumeInChat(session.session_id)}
              disabled={actionsDisabled}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors",
                isLoadSupported
                  ? "text-muted-foreground hover:text-primary hover:bg-primary/10"
                  : "text-muted-foreground/40 cursor-not-allowed",
              )}
              title={
                isLoadSupported
                  ? "Resume in chat view"
                  : "This agent doesn't support resuming sessions"
              }
            >
              <MessageCircle size={11} />
              Resume
            </button>
            <button
              onClick={() => onLaunchAsSession(session.session_id)}
              disabled={actionsDisabled}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors",
                isLoadSupported
                  ? "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  : "text-muted-foreground/40 cursor-not-allowed",
              )}
              title={
                isLoadSupported
                  ? "Open as session pane"
                  : "This agent doesn't support resuming sessions"
              }
            >
              <ExternalLink size={11} />
              Session
            </button>
          </>
        )}
      </div>
    </div>
  );
});

export default ChatView;
