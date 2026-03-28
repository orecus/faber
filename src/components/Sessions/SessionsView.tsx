import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useAppStore } from "../../store/appStore";
import { ptyBuffer } from "../../lib/ptyBuffer";
import type { GridLayoutState } from "../../store/appStore";
import type { Session } from "../../types";
import ContinuousModeBar from "../Shell/ContinuousModeBar";
import LaunchTaskDialog from "../Launchers/LaunchTaskDialog";
import { ViewLayout } from "../Shell/ViewLayout";
import SessionsToolbar from "./SessionsToolbar";
import SessionGrid from "./SessionGrid";
import SessionPane from "./SessionPane";
import SessionsEmptyState from "./SessionsEmptyState";
import SessionDragOverlay from "./SessionDragOverlay";
import LaunchSessionDialog from "../Launchers/LaunchSessionDialog";

export default function SessionsView() {
  const sessions = useAppStore((s) => s.sessions);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const continuousMode = useAppStore((s) => s.continuousMode);
  const gridLayout = useAppStore((s) => s.gridLayout);
  const setGridLayout = useAppStore((s) => s.setGridLayout);
  const dismissEndedPane = useAppStore((s) => s.dismissEndedPane);
  const reorderSession = useAppStore((s) => s.reorderSession);
  const tasks = useAppStore((s) => s.tasks);
  const launchTaskForSessionId = useAppStore((s) => s.launchTaskForSessionId);
  const setLaunchTaskForSession = useAppStore((s) => s.setLaunchTaskForSession);
  const dismissResearchComplete = useAppStore((s) => s.dismissResearchComplete);

  const [showLauncher, setShowLauncher] = useState(false);
  const [draggedSession, setDraggedSession] = useState<Session | null>(null);

  // DnD sensors — 8px activation distance to avoid accidental drags
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Ready tasks for launcher


  // Sessions visible in the grid: active + ended-but-not-dismissed
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (gridLayout.dismissedEndedSessionIds.includes(s.id)) return false;
      // Chat sessions are shown in the Chat view, not the session grid
      if (s.mode === "chat") return false;
      return true;
    });
  }, [sessions, gridLayout.dismissedEndedSessionIds]);

  // Sort by sessionOrder position (unknowns go to end)
  const visibleSessions = useMemo(() => {
    const orderMap = new Map(gridLayout.sessionOrder.map((id, i) => [id, i]));
    return [...filteredSessions].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Infinity;
      const bi = orderMap.get(b.id) ?? Infinity;
      return ai - bi;
    });
  }, [filteredSessions, gridLayout.sessionOrder]);

  // Disable drag in 1-up/maximized mode
  const isDragDisabled = gridLayout.mode === "1-up" || gridLayout.maximizedPaneId !== null;

  // Layout change handler
  const handleLayoutChange = useCallback(
    (update: Partial<GridLayoutState>) => {
      setGridLayout(update);
    },
    [setGridLayout],
  );

  // Dismiss ended pane and remove session from backend
  const handleDismiss = useCallback(
    (sessionId: string) => {
      dismissEndedPane(sessionId);
      ptyBuffer.clear(sessionId);
      invoke("remove_session", { sessionId }).catch(() => {
        // Ignore removal errors — session may already be gone
      });
    },
    [dismissEndedPane],
  );

  // Focus pane
  const handleFocus = useCallback(
    (sessionId: string) => {
      setGridLayout({ focusedPaneId: sessionId });
    },
    [setGridLayout],
  );

  // Stop session and remove it atomically — dismiss from grid immediately so UI
  // responds instantly, backend handles stop + cleanup + delete + event in one call.
  const handleStop = useCallback(
    (sessionId: string) => {
      // Immediately remove from grid for instant visual response
      dismissEndedPane(sessionId);
      ptyBuffer.clear(sessionId);
      // Atomic backend call: stop PTY → cleanup MCP/worktree → delete from DB → emit session-removed
      invoke("stop_and_remove_session", { sessionId }).catch((err) => {
        console.error(`[sessions] Failed to stop and remove session ${sessionId}:`, err);
        useAppStore.getState().flashError("Failed to stop session");
      });
    },
    [dismissEndedPane],
  );

  // Maximize toggle
  const handleMaximizeToggle = useCallback(
    (sessionId: string) => {
      const next =
        gridLayout.maximizedPaneId === sessionId ? null : sessionId;
      setGridLayout({ maximizedPaneId: next });
    },
    [gridLayout.maximizedPaneId, setGridLayout],
  );

  // DnD handlers
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const session = visibleSessions.find((s) => s.id === event.active.id);
      setDraggedSession(session ?? null);
    },
    [visibleSessions],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggedSession(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = visibleSessions.findIndex((s) => s.id === active.id);
      const newIndex = visibleSessions.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      reorderSession(active.id as string, newIndex);
    },
    [visibleSessions, reorderSession],
  );

  // Relaunch a stopped/ended session with the same config
  const handleRelaunch = useCallback(
    async (sessionId: string) => {
      const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
      addBackgroundTask("Relaunching session");
      try {
        await invoke("relaunch_session", { sessionId });
        // Dismiss the old session after successful relaunch
        handleDismiss(sessionId);
      } catch {
        // If relaunch fails, leave the old session visible
      } finally {
        removeBackgroundTask("Relaunching session");
      }
    },
    [handleDismiss],
  );

  const handleSessionStarted = useCallback(() => {
    setShowLauncher(false);
  }, []);

  // ── Research → Implementation flow ──

  // Resolve the session + task for the LaunchTaskDialog when triggered from ResearchCompleteBar
  const researchSession = useMemo(
    () => launchTaskForSessionId ? sessions.find((s) => s.id === launchTaskForSessionId) : null,
    [launchTaskForSessionId, sessions],
  );
  const researchTask = useMemo(
    () => researchSession?.task_id ? tasks.find((t) => t.id === researchSession.task_id) : null,
    [researchSession, tasks],
  );

  const handleResearchLaunched = useCallback(() => {
    if (!launchTaskForSessionId) return;
    const sessionIdToClose = launchTaskForSessionId;

    // Dismiss the research complete bar
    dismissResearchComplete(sessionIdToClose);
    // Close the dialog
    setLaunchTaskForSession(null);

    // Auto-close the research session after a short delay so the user sees both briefly
    setTimeout(() => {
      handleStop(sessionIdToClose);
    }, 4000);
  }, [launchTaskForSessionId, dismissResearchComplete, setLaunchTaskForSession, handleStop]);

  const handleResearchLaunchDismiss = useCallback(() => {
    setLaunchTaskForSession(null);
  }, [setLaunchTaskForSession]);

  // ── Keyboard navigation between panes ──
  const activeView = useAppStore((s) => s.activeView);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle when sessions view is active
      if (activeView !== "sessions") return;
      // Skip when typing in an input/textarea/contenteditable
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) return;

      // Tab / Shift+Tab — cycle focus between panes
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (visibleSessions.length <= 1) return;
        e.preventDefault();
        const ids = visibleSessions.map((s) => s.id);
        const currentIdx = ids.indexOf(gridLayout.focusedPaneId ?? "");
        let nextIdx: number;
        if (e.shiftKey) {
          nextIdx = currentIdx <= 0 ? ids.length - 1 : currentIdx - 1;
        } else {
          nextIdx = currentIdx >= ids.length - 1 ? 0 : currentIdx + 1;
        }
        const nextId = ids[nextIdx];
        setGridLayout({ focusedPaneId: nextId });
        // Move DOM focus to the actual pane element
        const paneEl = document.querySelector<HTMLElement>(`[data-session-pane="${nextId}"]`);
        paneEl?.focus();
        return;
      }

      // Arrow keys — navigate between panes based on grid layout
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (visibleSessions.length <= 1) return;
        e.preventDefault();
        const ids = visibleSessions.map((s) => s.id);
        const currentIdx = ids.indexOf(gridLayout.focusedPaneId ?? "");
        if (currentIdx === -1) {
          // No pane focused — focus the first
          const nextId = ids[0];
          setGridLayout({ focusedPaneId: nextId });
          document.querySelector<HTMLElement>(`[data-session-pane="${nextId}"]`)?.focus();
          return;
        }
        // Compute cols from current layout (mirrors SessionGrid logic)
        const count = ids.length;
        const cols = gridLayout.mode === "2-up-v" ? 1
          : gridLayout.mode === "2-up" ? Math.max(2, count)
          : gridLayout.mode === "4-up" ? 2
          : gridLayout.mode === "1-up" ? 1
          : count <= 1 ? 1 : count <= 4 ? 2 : 2; // auto mode
        const col = currentIdx % cols;
        let nextIdx = currentIdx;
        switch (e.key) {
          case "ArrowRight": nextIdx = col < cols - 1 && currentIdx + 1 < count ? currentIdx + 1 : currentIdx; break;
          case "ArrowLeft": nextIdx = col > 0 ? currentIdx - 1 : currentIdx; break;
          case "ArrowDown": nextIdx = currentIdx + cols < count ? currentIdx + cols : currentIdx; break;
          case "ArrowUp": nextIdx = currentIdx - cols >= 0 ? currentIdx - cols : currentIdx; break;
        }
        if (nextIdx !== currentIdx) {
          const nextId = ids[nextIdx];
          setGridLayout({ focusedPaneId: nextId });
          document.querySelector<HTMLElement>(`[data-session-pane="${nextId}"]`)?.focus();
        }
        return;
      }

      // Ctrl+Shift+S — stop the focused session
      if (e.key === "S" && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const focusedId = gridLayout.focusedPaneId;
        if (focusedId && visibleSessions.some((s) => s.id === focusedId)) {
          handleStop(focusedId);
        }
        return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeView, visibleSessions, gridLayout.focusedPaneId, setGridLayout, handleStop]);

  const hasContinuousRun = !!(activeProjectId && continuousMode[activeProjectId]);

  return (
    <ViewLayout>
      <SessionsToolbar
        layout={gridLayout}
        onLayoutChange={handleLayoutChange}
        activeProjectId={activeProjectId}
        onNewSession={() => setShowLauncher(true)}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main content */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {activeProjectId && hasContinuousRun && (
            <ContinuousModeBar projectId={activeProjectId} />
          )}

          {visibleSessions.length === 0 ? (
            <SessionsEmptyState activeProjectId={activeProjectId} onNewAgent={() => setShowLauncher(true)} />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SessionGrid layout={gridLayout} onLayoutChange={handleLayoutChange}>
                {visibleSessions.map((session) => (
                  <SessionPane
                    key={session.id}
                    session={session}
                    isFocused={gridLayout.focusedPaneId === session.id}
                    onFocus={handleFocus}
                    onMaximizeToggle={handleMaximizeToggle}
                    onDismiss={handleDismiss}
                    onStop={handleStop}
                    onRelaunch={handleRelaunch}
                    dragDisabled={isDragDisabled}
                  />
                ))}
              </SessionGrid>
              <DragOverlay dropAnimation={null}>
                {draggedSession ? <SessionDragOverlay session={draggedSession} /> : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>

      </div>

      {showLauncher && activeProjectId && (
        <LaunchSessionDialog
          projectId={activeProjectId}
          onSessionStarted={handleSessionStarted}
          onDismiss={() => setShowLauncher(false)}
        />
      )}

      {/* LaunchTaskDialog triggered from ResearchCompleteBar */}
      {researchTask && researchSession && activeProjectId && (
        <LaunchTaskDialog
          task={researchTask}
          projectId={activeProjectId}
          onLaunched={handleResearchLaunched}
          onDismiss={handleResearchLaunchDismiss}
        />
      )}
    </ViewLayout>
  );
}
