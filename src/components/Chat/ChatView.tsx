import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Layers,
  Loader2,
  MessageCircle,
  Plus,
  RotateCcw,
  Rows3,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { usePersistedString } from "../../hooks/usePersistedState";
import { AgentIcon, getAgentColor } from "../../lib/agentIcons";
import { AGENT_DESCRIPTIONS } from "../../lib/agentDescriptions";
import { formatErrorWithHint } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import { cn } from "@/lib/utils";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { borderAccentColors } from "../ui/orecus.io/lib/color-utils";
import ConfirmDialog from "../Review/ConfirmDialog";
import ChatPane from "./ChatPane";
import ThreadStatusBadge from "./ThreadStatusBadge";

import type { NarrationMode } from "./ChatPane";
import type { Session } from "../../types";

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

  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

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

  // Also find any stopped/finished chat sessions for the "restart" flow
  const stoppedChatSession: Session | undefined = useMemo(
    () =>
      sessions.find(
        (s) =>
          s.project_id === activeProjectId &&
          s.mode === "chat" &&
          s.transport === "acp" &&
          (s.status === "stopped" ||
            s.status === "finished" ||
            s.status === "error"),
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

  const handleRestartChat = useCallback(async () => {
    if (!stoppedChatSession || launching) return;
    setError(null);
    setLaunching(true);
    const taskLabel = "Restarting chat session";
    addBackgroundTask(taskLabel);
    try {
      await invoke("relaunch_session", {
        sessionId: stoppedChatSession.id,
      });
    } catch (err) {
      setError(formatErrorWithHint(err, "agent-launch"));
    } finally {
      setLaunching(false);
      removeBackgroundTask(taskLabel);
    }
  }, [stoppedChatSession, launching, addBackgroundTask, removeBackgroundTask]);

  const handleCloseChat = useCallback(async () => {
    if (!chatSession) return;
    try {
      // stop_and_remove_session atomically stops + deletes — emits session-removed
      // which the store handles by removing it from sessions list
      await invoke("stop_and_remove_session", { sessionId: chatSession.id });
    } catch (err) {
      console.error("Failed to close chat session:", err);
      // Fallback: just remove the session record (it may already be stopped)
      try {
        await invoke("remove_session", { sessionId: chatSession.id });
      } catch (innerErr) {
        console.error("Fallback remove also failed:", innerErr);
      }
    }
    // Clean up ACP state in the store
    useAppStore.getState().cleanupSessionAcp(chatSession.id);
  }, [chatSession]);

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

  // No active session → empty state
  return (
    <div
      className="flex flex-col items-center justify-center min-h-0 overflow-hidden bg-card/80"
      style={{ gridArea: "content" }}
    >
      <div className="flex flex-col items-center gap-6 max-w-md px-6">
        {/* Icon */}
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 ring-1 ring-primary/20">
          <MessageCircle size={28} strokeWidth={1.5} className="text-primary" />
        </div>

        {/* Title & description */}
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground mb-1.5">
            Project Chat
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Have a conversation about your project — discuss architecture,
            explore ideas, or ask questions without launching a task or session.
          </p>
        </div>

        {/* Agent selector */}
        {acpAgents.length > 0 ? (
          <div className="w-full">
            <label className="mb-1.5 block text-xs text-dim-foreground">
              Agent
            </label>
            <div className="grid grid-cols-3 gap-2">
              {acpAgents.map((agent) => {
                const isSelected = selectedAgentName === agent.name;
                const color = getAgentColor(agent.name);
                return (
                  <button
                    key={agent.name}
                    onClick={() => setSelectedAgentName(agent.name)}
                    className={`flex flex-col gap-1.5 rounded-[var(--radius-element)] px-3 py-2.5 text-left transition-all duration-150 border ${
                      isSelected
                        ? `${borderAccentColors[accentColor]} bg-accent`
                        : "border-border bg-popover"
                    } cursor-pointer`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                        style={{ background: `${color}20` }}
                      >
                        <AgentIcon agent={agent.name} size={18} />
                      </span>
                      <span
                        className={`text-xs ${isSelected ? "font-medium" : "font-normal"} text-foreground`}
                      >
                        {agent.display_name}
                      </span>
                    </div>
                    <div className="text-[11px] leading-snug text-muted-foreground">
                      {AGENT_DESCRIPTIONS[agent.name] ?? "AI coding agent"}
                    </div>
                  </button>
                );
              })}
            </div>
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

        {/* Actions */}
        <div className="flex items-center gap-2">
          {stoppedChatSession && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestartChat}
              disabled={launching}
              loading={launching}
              leftIcon={<RotateCcw className="size-3.5" />}
              hoverEffect="scale"
              clickEffect="scale"
            >
              Resume
            </Button>
          )}
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
            Start Chat
          </Button>
        </div>
      </div>
    </div>
  );
});

export default ChatView;
