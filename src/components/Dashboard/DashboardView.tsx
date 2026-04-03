import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDashboardFilters } from "../../hooks/useDashboardFilters";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { usePersistedBoolean } from "../../hooks/usePersistedState";
import { useAppStore } from "../../store/appStore";
import LaunchQueueDialog from "../Launchers/LaunchQueueDialog";
import QueueModeBar from "../Shell/QueueModeBar";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { ViewLayout } from "../Shell/ViewLayout";
import CreateTaskDialog from "../TaskDetail/CreateTaskDialog";
import DependencyGraph from "./DependencyGraph";
import EmptyState from "./EmptyState";
import FilterBar from "./FilterBar";
import KanbanBoard from "./KanbanBoard";
import ArchivedTaskList from "./ArchivedTaskList";
import LaunchBreakdownDialog from "../Launchers/LaunchBreakdownDialog";
import LaunchResearchDialog from "../Launchers/LaunchResearchDialog";
import LaunchTaskDialog from "../Launchers/LaunchTaskDialog";
import SummaryHeader from "./SummaryHeader";
import type { DashboardMode } from "./SummaryHeader";

import type { Session, Task, TaskStatus } from "../../types";
import { SearchX } from "lucide-react";

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

  // Search input ref for keyboard shortcut focus
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Keyboard shortcut: "/" or Ctrl+F to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept if user is typing in an input/textarea/contenteditable
      const tag = (e.target as HTMLElement).tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;

      if (e.key === "/" && !isEditable) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const queueMode = useAppStore((s) => s.queueMode);
  const hasQueueRun = !!(activeProjectId && queueMode[activeProjectId]);

  // Dialog state
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [launchTaskId, setLaunchTaskId] = useState<string | null>(null);
  const [researchTaskId, setResearchTaskId] = useState<string | null>(null);
  const [breakdownTaskId, setBreakdownTaskId] = useState<string | null>(null);
  const [showQueueMode, setShowQueueMode] = useState(false);

  // Epic click on Kanban card → toggle FilterBar epic filter
  const handleEpicClick = useCallback(
    (epicId: string) => {
      dispatchFilter({ type: "TOGGLE_EPIC", epicId });
    },
    [dispatchFilter],
  );

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

  // Ready tasks for queue mode
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

  // Archived tasks
  const archivedTasks = useMemo(
    () => tasks.filter((t) => t.status === "archived"),
    [tasks],
  );

  // Filtered archived tasks (search applies)
  const filteredArchivedTasks = useMemo(
    () =>
      filters.searchQuery.length > 0
        ? archivedTasks.filter(matchesFilters)
        : archivedTasks,
    [archivedTasks, filters.searchQuery, matchesFilters],
  );

  const handleToggleArchived = useCallback(() => {
    dispatchFilter({ type: "TOGGLE_ARCHIVED" });
  }, [dispatchFilter]);

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
  const allEpics = useMemo(
    () => boardTasks.filter((t) => t.task_type === "epic").map((t) => ({ id: t.id, title: t.title })),
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

  // Open breakdown dialog for an epic
  const handleBreakdownEpic = useCallback((taskId: string) => {
    setBreakdownTaskId(taskId);
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

  // Resolve the epic being broken down
  const breakdownTask = useMemo(
    () =>
      breakdownTaskId ? (tasks.find((t) => t.id === breakdownTaskId) ?? null) : null,
    [breakdownTaskId, tasks],
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

  // Breakdown epic dialog
  const breakdownTaskDialog = breakdownTask && activeProjectId && (
    <LaunchBreakdownDialog
      task={breakdownTask}
      projectId={activeProjectId}
      onLaunched={() => {
        setBreakdownTaskId(null);
        setActiveView("sessions");
      }}
      onDismiss={() => setBreakdownTaskId(null)}
    />
  );

  // Queue mode dialog
  const queueModeDialog = showQueueMode && activeProjectId && (
    <LaunchQueueDialog
      projectId={activeProjectId}
      readyTasks={readyTasks}
      onStarted={() => {
        setShowQueueMode(false);
        setActiveView("sessions");
      }}
      onDismiss={() => setShowQueueMode(false)}
    />
  );

  // Restore archived task → backlog
  const handleRestoreTask = useCallback(
    async (taskId: string) => {
      const currentTasks = useAppStore.getState().tasks;
      preUpdateTasksRef.current = currentTasks;
      const optimistic = currentTasks.map((t) =>
        t.id === taskId ? { ...t, status: "backlog" as TaskStatus } : t,
      );
      setTasks(optimistic);
      try {
        const updated = await invoke<Task>("update_task_status", {
          projectId: activeProjectId,
          taskId,
          status: "backlog",
        });
        updateTask(updated);
      } catch {
        setTasks(preUpdateTasksRef.current);
        useAppStore.getState().flashError("Failed to restore task");
      }
    },
    [setTasks, updateTask, activeProjectId],
  );

  // Permanently delete a task
  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      try {
        await invoke("delete_task", {
          projectId: activeProjectId,
          taskId,
        });
        const freshTasks = await invoke<Task[]>("list_tasks", {
          projectId: activeProjectId,
        });
        setTasks(freshTasks);
      } catch {
        useAppStore.getState().flashError("Failed to delete task");
      }
    },
    [activeProjectId, setTasks],
  );

  // Shared toolbar
  const toolbar = (
    <SummaryHeader
      accentColor={accentColor}
      tasks={boardTasks}
      archivedCount={archivedTasks.length}
      showArchived={filters.showArchived}
      onToggleArchived={handleToggleArchived}
      onNewTask={() => setShowCreateTask(true)}
      onQueueMode={() => setShowQueueMode(true)}
      queueModeEnabled={readyTasks.length >= 2 && !hasQueueRun}
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
        {breakdownTaskDialog}
        {queueModeDialog}
      </ViewLayout>
    );
  }

  return (
    <ViewLayout>
      <ViewLayout.Toolbar>
        {toolbar}
      </ViewLayout.Toolbar>

      <div className="flex flex-col flex-1 min-h-0 gap-1.5">
        {activeProjectId && hasQueueRun && (
          <QueueModeBar projectId={activeProjectId} />
        )}

        <FilterBar
          filters={filters}
          dispatchFilter={dispatchFilter}
          hasActiveFilters={hasActiveFilters}
          allLabels={allLabels}
          allAgents={allAgents}
          allEpics={allEpics}
          searchInputRef={searchInputRef}
        />

        {filters.showArchived ? (
          <ArchivedTaskList
            tasks={filteredArchivedTasks}
            onTaskClick={handleTaskClick}
            onRestore={handleRestoreTask}
            onDelete={handleDeleteTask}
          />
        ) : filteredTasks.length === 0 && hasActiveFilters ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <SearchX className="size-8 opacity-40" />
            <p className="text-sm">No tasks match your filters</p>
            <Button
              variant="link"
              size="sm"
              hoverEffect="none"
              clickEffect="none"
              onClick={() => dispatchFilter({ type: "CLEAR_ALL" })}
            >
              Clear filters
            </Button>
          </div>
        ) : dashboardMode === "board" ? (
          <KanbanBoard
            tasks={filteredTasks}
            sessionMap={sessionMap}
            allLabels={allLabels}
            onTaskClick={handleTaskClick}
            onStatusChange={handleStatusChange}
            onStartSession={handleStartSession}
            onResearchSession={handleResearchSession}
            onBreakdownEpic={handleBreakdownEpic}
            onViewSession={handleViewSession}
            onEpicClick={handleEpicClick}
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
      {breakdownTaskDialog}
      {queueModeDialog}
    </ViewLayout>
  );
}
