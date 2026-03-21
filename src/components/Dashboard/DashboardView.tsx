import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo, useRef, useState } from "react";

import { useDashboardFilters } from "../../hooks/useDashboardFilters";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { usePersistedBoolean } from "../../hooks/usePersistedState";
import { useAppStore } from "../../store/appStore";
import LaunchContinuousDialog from "../Launchers/LaunchContinuousDialog";
import ContinuousModeBar from "../Shell/ContinuousModeBar";
import { ViewLayout } from "../Shell/ViewLayout";
import CreateTaskDialog from "../TaskDetail/CreateTaskDialog";
import DependencyGraph from "./DependencyGraph";
import EmptyState from "./EmptyState";
import FilterBar from "./FilterBar";
import KanbanBoard from "./KanbanBoard";
import LaunchResearchDialog from "../Launchers/LaunchResearchDialog";
import LaunchTaskDialog from "../Launchers/LaunchTaskDialog";
import SummaryHeader from "./SummaryHeader";
import type { DashboardMode } from "./SummaryHeader";

import type { Session, Task, TaskStatus } from "../../types";

export default function DashboardView() {
  const tasks = useAppStore((s) => s.tasks);
  const sessions = useAppStore((s) => s.sessions);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setActiveTask = useAppStore((s) => s.setActiveTask);
  const setTasks = useAppStore((s) => s.setTasks);
  const updateTask = useAppStore((s) => s.updateTask);
  const setGridLayout = useAppStore((s) => s.setGridLayout);
  const accentColor = useProjectAccentColor();
  const { filters, dispatchFilter, hasActiveFilters, matchesFilters } =
    useDashboardFilters();

  const continuousMode = useAppStore((s) => s.continuousMode);
  const hasContinuousRun = !!(activeProjectId && continuousMode[activeProjectId]);

  // Dialog state
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [launchTaskId, setLaunchTaskId] = useState<string | null>(null);
  const [researchTaskId, setResearchTaskId] = useState<string | null>(null);
  const [showContinuousMode, setShowContinuousMode] = useState(false);

  // Dashboard mode: board (kanban) or graph (swimlane)
  const [graphMode, setGraphMode] = usePersistedBoolean("dashboard_show_graph", false);
  const dashboardMode: DashboardMode = graphMode ? "graph" : "board";
  const hasDependencies = useMemo(
    () => tasks.some((t) => t.depends_on.length > 0),
    [tasks],
  );
  const handleDashboardModeChange = useCallback(
    (mode: DashboardMode) => {
      setGraphMode(mode === "graph");
    },
    [setGraphMode],
  );

  // Ready tasks for continuous mode
  const readyTasks = useMemo(
    () => tasks.filter((t) => t.status === "ready"),
    [tasks],
  );

  // Snapshot for optimistic revert
  const preUpdateTasksRef = useRef<Task[]>(tasks);

  // Build session map: taskId → most recent active session
  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) {
      if (!s.task_id) continue;
      const existing = map.get(s.task_id);
      if (!existing || s.started_at > existing.started_at) {
        map.set(s.task_id, s);
      }
    }
    return map;
  }, [sessions]);

  // Non-archived tasks only (board shows 5 columns)
  const boardTasks = useMemo(
    () => tasks.filter((t) => t.status !== "archived"),
    [tasks],
  );

  // Apply filters
  const filteredTasks = useMemo(
    () => (hasActiveFilters ? boardTasks.filter(matchesFilters) : boardTasks),
    [boardTasks, hasActiveFilters, matchesFilters],
  );

  // Unique labels and agents for filter bar
  const allLabels = useMemo(
    () => [...new Set(boardTasks.flatMap((t) => t.labels))].sort(),
    [boardTasks],
  );
  const allAgents = useMemo(
    () =>
      [
        ...new Set(
          boardTasks.map((t) => t.agent).filter((a): a is string => a !== null),
        ),
      ].sort(),
    [boardTasks],
  );

  // Task click → navigate to task detail
  const handleTaskClick = useCallback(
    (taskId: string) => {
      setActiveTask(taskId);
      setActiveView("task-detail");
    },
    [setActiveTask, setActiveView],
  );

  // Drag-end → optimistic status update + IPC
  const handleStatusChange = useCallback(
    async (taskId: string, newStatus: TaskStatus) => {
      // Read tasks non-reactively at call time to avoid stale closure
      const currentTasks = useAppStore.getState().tasks;
      preUpdateTasksRef.current = currentTasks;

      // Optimistic update
      const optimistic = currentTasks.map((t) =>
        t.id === taskId ? { ...t, status: newStatus } : t,
      );
      setTasks(optimistic);

      try {
        const updated = await invoke<Task>("update_task_status", {
          projectId: activeProjectId,
          taskId,
          status: newStatus,
        });
        updateTask(updated);
      } catch (err) {
        // Revert on failure + notify user
        setTasks(preUpdateTasksRef.current);
        useAppStore.getState().flashError("Failed to update task status");
        console.error("Task status update failed:", err);
      }
    },
    [setTasks, updateTask, activeProjectId],
  );

  // Open launch dialog for a task
  const handleStartSession = useCallback((taskId: string) => {
    setLaunchTaskId(taskId);
  }, []);

  // Open research dialog for a task
  const handleResearchSession = useCallback((taskId: string) => {
    setResearchTaskId(taskId);
  }, []);

  // Navigate to a session's terminal pane
  const handleViewSession = useCallback(
    (sessionId: string) => {
      setGridLayout({ focusedPaneId: sessionId });
      setActiveView("sessions");
    },
    [setGridLayout, setActiveView],
  );

  // Resolve the task being launched
  const launchTask = useMemo(
    () =>
      launchTaskId ? (tasks.find((t) => t.id === launchTaskId) ?? null) : null,
    [launchTaskId, tasks],
  );

  // Resolve the task being researched
  const researchTask = useMemo(
    () =>
      researchTaskId ? (tasks.find((t) => t.id === researchTaskId) ?? null) : null,
    [researchTaskId, tasks],
  );

  // Create & Start callback — closes create dialog, opens launch dialog
  const handleCreateAndStart = useCallback(
    (taskId: string) => {
      setShowCreateTask(false);
      setLaunchTaskId(taskId);
    },
    [],
  );

  // Create task dialog
  const createTaskDialog = showCreateTask && (
    <CreateTaskDialog
      onDismiss={() => setShowCreateTask(false)}
      onStartTask={handleCreateAndStart}
    />
  );

  // Launch task dialog
  const launchTaskDialog = launchTask && activeProjectId && (
    <LaunchTaskDialog
      task={launchTask}
      projectId={activeProjectId}
      onLaunched={() => {
        setLaunchTaskId(null);
        setActiveView("sessions");
      }}
      onDismiss={() => setLaunchTaskId(null)}
    />
  );

  // Research task dialog
  const researchTaskDialog = researchTask && activeProjectId && (
    <LaunchResearchDialog
      task={researchTask}
      projectId={activeProjectId}
      onLaunched={() => {
        setResearchTaskId(null);
        setActiveView("sessions");
      }}
      onDismiss={() => setResearchTaskId(null)}
    />
  );

  // Continuous mode dialog
  const continuousModeDialog = showContinuousMode && activeProjectId && (
    <LaunchContinuousDialog
      projectId={activeProjectId}
      readyTasks={readyTasks}
      onStarted={() => {
        setShowContinuousMode(false);
        setActiveView("sessions");
      }}
      onDismiss={() => setShowContinuousMode(false)}
    />
  );

  // Shared toolbar
  const toolbar = (
    <SummaryHeader
      accentColor={accentColor}
      tasks={boardTasks}
      onNewTask={() => setShowCreateTask(true)}
      onContinuousMode={() => setShowContinuousMode(true)}
      continuousModeEnabled={readyTasks.length >= 2 && !hasContinuousRun}
      dashboardMode={dashboardMode}
      onDashboardModeChange={handleDashboardModeChange}
      hasDependencies={hasDependencies}
    />
  );

  // Empty state
  if (boardTasks.length === 0) {
    return (
      <ViewLayout>
        <ViewLayout.Toolbar>
          {toolbar}
        </ViewLayout.Toolbar>
        <EmptyState onNewTask={() => setShowCreateTask(true)} />
        {createTaskDialog}
        {launchTaskDialog}
        {researchTaskDialog}
        {continuousModeDialog}
      </ViewLayout>
    );
  }

  return (
    <ViewLayout>
      <ViewLayout.Toolbar>
        {toolbar}
      </ViewLayout.Toolbar>

      <div className="flex flex-col flex-1 min-h-0">
        {activeProjectId && hasContinuousRun && (
          <ContinuousModeBar projectId={activeProjectId} />
        )}

        <FilterBar
          filters={filters}
          dispatchFilter={dispatchFilter}
          hasActiveFilters={hasActiveFilters}
          allLabels={allLabels}
          allAgents={allAgents}
        />

        {dashboardMode === "board" ? (
          <KanbanBoard
            tasks={filteredTasks}
            sessionMap={sessionMap}
            onTaskClick={handleTaskClick}
            onStatusChange={handleStatusChange}
            onStartSession={handleStartSession}
            onResearchSession={handleResearchSession}
            onViewSession={handleViewSession}
          />
        ) : (
          /* Tree / outline view — full height, replaces kanban */
          <div className="flex-1 min-h-0">
            <DependencyGraph
              tasks={filteredTasks}
              sessionMap={sessionMap}
              onTaskClick={handleTaskClick}
              onStartSession={handleStartSession}
              onResearchSession={handleResearchSession}
              onViewSession={handleViewSession}
            />
          </div>
        )}
      </div>
      {createTaskDialog}
      {launchTaskDialog}
      {researchTaskDialog}
      {continuousModeDialog}
    </ViewLayout>
  );
}
