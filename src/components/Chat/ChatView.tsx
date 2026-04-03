import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Loader2,
  MessageCircle,
  Send,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { formatErrorWithHint } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import AgentModelPicker from "../Launchers/AgentModelPicker";
import ConfirmDialog from "../Review/ConfirmDialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import ChatPane from "./ChatPane";
import ThreadStatusBadge from "./ThreadStatusBadge";

import type { AgentInfo, Session } from "../../types";

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

  const [selectedAgentName, setSelectedAgentName] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ACP-capable agents only
  const acpAgents = useMemo(
    () => agents.filter((a) => a.installed && a.acp_installed),
    [agents],
  );

  const acpFilter = useCallback(
    (a: AgentInfo) => a.supports_acp,
    [],
  );

  // Default to first ACP agent
  useEffect(() => {
    if (acpAgents.length > 0 && !selectedAgentName) {
      setSelectedAgentName(acpAgents[0].name);
    }
  }, [acpAgents, selectedAgentName]);

  const [launching, setLaunching] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

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

  const handleAgentSelect = useCallback((name: string) => {
    setSelectedAgentName(name);
    setSelectedModel("");
  }, []);

  const handleModelSelect = useCallback((model: string) => {
    setSelectedModel(model);
  }, []);

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
        model: selectedModel || null,
        userPrompt: userPrompt.trim() || null,
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
    selectedModel,
    userPrompt,
    launching,
    addBackgroundTask,
    removeBackgroundTask,
    setError,
  ]);

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

  // Active chat session → render ChatPane
  if (chatSession) {
    return (
      <div
        className="flex flex-col pt-2 gap-2 min-h-0 overflow-hidden bg-card/80"
        style={{ gridArea: "content" }}
      >
        {/* Minimal toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 shrink-0">
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

  // No active session → centered new chat launcher
  return (
    <div
      className="flex min-h-0 overflow-hidden bg-card/80"
      style={{ gridArea: "content" }}
    >
      <div className="flex flex-col items-center justify-center flex-1 min-w-0 px-6">
        <div className="flex flex-col items-center gap-5 w-full max-w-md">
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

          {/* Agent + Model picker */}
          {acpAgents.length > 0 ? (
            <AgentModelPicker
              selectedAgent={selectedAgentName}
              selectedModel={selectedModel}
              onAgentChange={handleAgentSelect}
              onModelChange={handleModelSelect}
              accentColor={accentColor}
              filter={acpFilter}
              disabled={launching}
            />
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

          {/* Prompt textarea + Start button */}
          <div className="w-full flex flex-col gap-2">
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleStartChat();
                  }
                }}
                placeholder="What would you like to discuss?"
                rows={3}
                disabled={launching || acpAgents.length === 0}
                className="w-full resize-none rounded-lg border border-border bg-muted/30 px-3 py-2.5 pr-12 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring transition-colors disabled:opacity-50"
              />
              <Button
                variant="color"
                color={accentColor}
                size="icon-sm"
                onClick={handleStartChat}
                disabled={launching || acpAgents.length === 0}
                loading={launching}
                hoverEffect="scale-glow"
                clickEffect="scale"
                className="absolute right-2 bottom-2"
                title="Start chat (Ctrl+Enter)"
              >
                {launching ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
});

export default ChatView;
