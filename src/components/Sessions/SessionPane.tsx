import { useDraggable, useDroppable } from "@dnd-kit/core";
import { invoke } from "@tauri-apps/api/core";
import { Pencil, RotateCcw, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { AgentIcon } from "../../lib/agentIcons";
import { useAppStore } from "../../store/appStore";
import { ChatPane } from "../Chat";
import Terminal from "../Terminal";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles, ringColors } from "../ui/orecus.io/lib/color-utils";
import QuickActionBar from "./QuickActionBar";
import ResearchCompleteBar from "./ResearchCompleteBar";

import type { Session } from "../../types";

const MODE_TOOLTIP: Record<string, string> = {
  task: "Task mode",
  vibe: "Vibe mode",
  shell: "Shell session",
  research: "Research mode",
};

const STATUS_COLOR: Record<string, string> = {
  starting: "var(--warning)",
  running: "var(--success)",
  paused: "var(--muted-foreground)",
  stopped: "var(--muted-foreground)",
  finished: "var(--dim-foreground)",
  error: "var(--destructive)",
};

const ACTIVE_STATUSES = new Set(["running", "starting", "paused"]);

interface SessionPaneProps {
  session: Session;
  isFocused: boolean;
  onFocus: (sessionId: string) => void;
  onMaximizeToggle: (sessionId: string) => void;
  onDismiss: (sessionId: string) => void;
  onStop: (sessionId: string) => void;
  onRelaunch: (sessionId: string) => void;
  dragDisabled?: boolean;
}

export default React.memo(function SessionPane({
  session,
  isFocused,
  onFocus,
  onMaximizeToggle,
  onDismiss,
  onStop,
  onRelaunch,
  dragDisabled,
}: SessionPaneProps) {
  const { isGlass } = useTheme();
  const accentColor = useProjectAccentColor();
  const mcpData = useAppStore((s) => s.mcpStatus[session.id]);
  const hasPermissionRequests = useAppStore(
    (s) => (s.acpPermissionRequests[session.id] ?? []).length > 0,
  );
  const isResearchComplete = useAppStore(
    (s) => s.researchCompleteSessionIds.includes(session.id),
  );
  const setSessions = useAppStore((s) => s.setSessions);
  const isEnded = !ACTIVE_STATUSES.has(session.status);
  const isMcpWaiting = mcpData?.waiting || mcpData?.status === "waiting";
  const isMcpError = mcpData?.error || mcpData?.status === "error";
  const showWaitingState = isMcpWaiting && !isEnded;
  const showErrorState = isMcpError && !isMcpWaiting && !isEnded;
  const showPermissionState = hasPermissionRequests && !isEnded;

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: session.id, disabled: dragDisabled });

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: session.id });

  const handleHeaderDoubleClick = useCallback(() => {
    onMaximizeToggle(session.id);
  }, [session.id, onMaximizeToggle]);

  const handlePaneClick = useCallback(() => {
    onFocus(session.id);
  }, [session.id, onFocus]);

  const startEditing = useCallback(() => {
    setEditValue(session.name ?? "");
    setIsEditing(true);
  }, [session.name]);

  const commitRename = useCallback(async () => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    const newName = trimmed || null;
    if (newName === (session.name ?? null)) return;
    try {
      const updated = await invoke<Session>("rename_session", {
        sessionId: session.id,
        name: newName,
      });
      // Read sessions non-reactively at call time to avoid subscribing to the whole array
      const store = useAppStore.getState();
      const updatedSessions = store.sessions.map((s) => (s.id === updated.id ? updated : s));
      setSessions(updatedSessions);
      // Also update the per-project cache so the sidebar reflects the new name
      const pid = updated.project_id;
      const projSessions = store.projectSessions[pid];
      if (projSessions) {
        store.updateProjectSessions(
          pid,
          projSessions.map((s) => (s.id === updated.id ? updated : s)),
        );
      }
      // Flash "Saved" indicator
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1500);
    } catch {
      // Ignore rename errors
    }
  }, [editValue, session.id, session.name, setSessions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        commitRename();
      } else if (e.key === "Escape") {
        setIsEditing(false);
      }
    },
    [commitRename],
  );

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const displayName = session.name || session.agent;

  return (
    <div
      ref={setDropRef}
      tabIndex={0}
      role="region"
      aria-label={`${displayName} session — ${session.status}`}
      data-session-pane={session.id}
      onClick={handlePaneClick}
      className={`flex flex-col min-h-0 min-w-0 rounded-[var(--radius-panel)] overflow-hidden relative transition-shadow duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${glassStyles[isGlass ? "subtle" : "solid"]} ${
        showPermissionState
          ? isFocused ? "ring-2 ring-warning shadow-md shadow-warning/15" : "ring-2 ring-warning/60 shadow-sm shadow-warning/10"
          : showErrorState
            ? isFocused ? "ring-2 ring-destructive/50" : "ring-1 ring-destructive/50"
            : showWaitingState
              ? isFocused ? "ring-2 ring-warning/50" : "ring-1 ring-warning/50"
              : isFocused ? `ring-2 ${ringColors[accentColor]}` : "ring-1 ring-border/40"
      } ${isDragging ? "opacity-30" : ""} ${
        isOver && !isDragging ? `ring-2 ${ringColors[accentColor]}` : ""
      }`}
    >
      {/* Pane Header */}
      <div
        ref={setDragRef}
        {...attributes}
        {...listeners}
        onDoubleClick={handleHeaderDoubleClick}
        className={`group/header flex items-center gap-2 px-2 py-1 border-b select-none shrink-0 transition-colors duration-200 ${
          showPermissionState
            ? "bg-warning/15 border-warning/50 animate-pulse"
            : showErrorState
              ? "bg-destructive/10 border-destructive/40"
              : showWaitingState
                ? "bg-warning/10 border-warning/40 animate-pulse"
                : "bg-popover border-border"
        } ${dragDisabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      >
        {/* Agent icon */}
        <span
          title={`${session.agent} — ${MODE_TOOLTIP[session.mode] ?? session.mode}`}
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center"
        >
          <AgentIcon
            agent={session.mode === "shell" ? "shell" : session.agent}
            size={14}
          />
        </span>

        {/* Session name (editable) */}
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onPointerDown={(e) => e.stopPropagation()}
            placeholder={session.agent}
            className="text-xs bg-transparent border border-border rounded px-1 py-0 text-foreground outline-none focus:border-primary min-w-0 w-auto min-w-24 max-w-48"
          />
        ) : (
          <span className="flex items-center gap-1 shrink-0 min-w-0">
            <span
              className="text-xs text-foreground overflow-hidden text-ellipsis whitespace-nowrap"
              title={
                session.name
                  ? `${session.name} (${session.agent})`
                  : session.agent
              }
            >
              {displayName}
            </span>
            {showSaved && (
              <span className="text-2xs text-success font-medium animate-in fade-in duration-200">
                Saved
              </span>
            )}
          </span>
        )}

        {/* Edit name button */}
        {!isEditing && (
          <Button
            variant="ghost"
            size="icon-xs"
            hoverEffect="none"
            clickEffect="none"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
            aria-label="Rename session"
            title="Rename session"
            className="text-muted-foreground opacity-30 group-hover/header:opacity-100 group-focus-within/header:opacity-100 hover:!opacity-100 shrink-0"
          >
            <Pencil size={10} />
          </Button>
        )}

        {/* MCP Progress + Status Message */}
        {mcpData?.current_step != null && mcpData.total_steps != null && (
          <span className="text-xs text-dim-foreground overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
            Step {mcpData.current_step}/{mcpData.total_steps}
            {mcpData.description ? `: ${mcpData.description}` : ""}
            {mcpData.message ? ` — ${mcpData.message}` : ""}
          </span>
        )}
        {mcpData && mcpData.current_step == null && mcpData.message && !isMcpError && !isMcpWaiting && (
          <span className="text-xs overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0 text-muted-foreground">
            {mcpData.message}
          </span>
        )}
        {(!mcpData || (!mcpData.current_step && !mcpData.message) || isMcpError || isMcpWaiting) && (
          <span className="flex-1" />
        )}

        {/* Permission badge (when ACP permission requests are pending) */}
        {showPermissionState && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-warning/20 ring-1 ring-warning/30 text-2xs font-bold text-warning uppercase tracking-wider shrink-0">
            Approval needed
          </span>
        )}

        {/* Status dot + waiting/error message */}
        <span className="flex items-center gap-1.5 shrink-0 min-w-0 max-w-[40%]" aria-live="polite" aria-atomic="true">
          <span
            title={
              showPermissionState
                ? "Permission request pending"
                : isMcpError
                  ? "Error reported"
                  : isMcpWaiting
                    ? "Waiting for input"
                    : session.status.charAt(0).toUpperCase() + session.status.slice(1)
            }
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${isMcpWaiting || showPermissionState ? "animate-pulse" : ""}`}
            style={{
              background: showPermissionState
                ? "var(--warning)"
                : isMcpError
                  ? "var(--destructive)"
                  : isMcpWaiting
                    ? "var(--warning)"
                    : STATUS_COLOR[session.status] ?? "var(--muted-foreground)",
            }}
          />
          {showErrorState && mcpData?.error_message && (
            <span className="text-xs text-destructive font-medium overflow-hidden text-ellipsis whitespace-nowrap" title={mcpData.error_message}>
              {mcpData.error_message}
            </span>
          )}
          {showWaitingState && mcpData?.waiting_question && (
            <span className="text-xs text-warning font-medium overflow-hidden text-ellipsis whitespace-nowrap animate-pulse" title={mcpData.waiting_question}>
              {mcpData.waiting_question}
            </span>
          )}
        </span>

        {/* Action buttons */}
        <Button
          variant="ghost"
          size="icon-xs"
          hoverEffect="none"
          clickEffect="none"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onStop(session.id);
          }}
          aria-label="Close session"
          title="Close session"
          className="text-muted-foreground hover:text-destructive"
        >
          <X size={12} />
        </Button>
      </div>

      {/* Content area — Terminal or Chat depending on transport */}
      <div className={`group/pane flex-1 min-h-0 relative ${session.transport === "acp" ? "bg-card/80" : "bg-white dark:bg-[#0d1117]"}`}>
        {session.transport === "acp" ? (
          <ChatPane sessionId={session.id} sessionStatus={session.status} />
        ) : (
          <>
            <Terminal sessionId={session.id} />

            {/* Quick Action Bar — floating at bottom center on hover (PTY only) */}
            <QuickActionBar
              sessionId={session.id}
              sessionStatus={session.status}
              sessionMode={session.mode}
            />
          </>
        )}

        {/* Research Complete Bar — slides in when a research session finishes */}
        {isResearchComplete && session.task_id && (
          <ResearchCompleteBar
            sessionId={session.id}
            taskId={session.task_id}
            onCloseSession={onDismiss}
          />
        )}

        {/* Session Ended Overlay */}
        {isEnded && (
          <div className="absolute inset-0 z-10 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
            <div
              className="text-sm font-medium"
              style={{
                color:
                  session.status === "error"
                    ? "var(--destructive)"
                    : "var(--dim-foreground)",
              }}
            >
              Session {session.status}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                title="Relaunch session"
                onClick={(e) => {
                  e.stopPropagation();
                  onRelaunch(session.id);
                }}
              >
                <RotateCcw size={12} className="mr-1.5" />
                Relaunch
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                title="Dismiss session"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(session.id);
                }}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
