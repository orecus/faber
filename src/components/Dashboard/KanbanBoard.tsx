import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Task, Session, TaskStatus } from "../../types";
import { topoSortTasks, buildDependentsMap, sortTasksByMode, type ColumnSortMode } from "../../lib/taskSort";
import { usePersistedString, usePersistedBoolean } from "../../hooks/usePersistedState";
import KanbanColumn from "./KanbanColumn";
import TaskCard from "./TaskCard";

const BOARD_COLUMNS: TaskStatus[] = ["backlog", "ready", "in-progress", "in-review", "done"];

interface KanbanBoardProps {
  tasks: Task[];
  sessionMap: Map<string, Session>;
  allLabels: string[];
  onTaskClick: (taskId: string) => void;
  onStatusChange: (taskId: string, newStatus: TaskStatus) => void;
  onStartSession: (taskId: string) => void;
  onResearchSession: (taskId: string) => void;
  onViewSession: (sessionId: string) => void;
}

export default function KanbanBoard({
  tasks,
  sessionMap,
  allLabels,
  onTaskClick,
  onStatusChange,
  onStartSession,
  onResearchSession,
  onViewSession,
}: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Persisted sort mode (shared across all columns)
  const [sortMode, setSortMode] = usePersistedString("kanban_sort_mode", "topological") as [ColumnSortMode, (v: string) => void, boolean];

  // Persisted collapsed state per column
  const [backlogCollapsed, setBacklogCollapsed] = usePersistedBoolean("kanban_col_backlog_collapsed", false);
  const [readyCollapsed, setReadyCollapsed] = usePersistedBoolean("kanban_col_ready_collapsed", false);
  const [inProgressCollapsed, setInProgressCollapsed] = usePersistedBoolean("kanban_col_in-progress_collapsed", false);
  const [inReviewCollapsed, setInReviewCollapsed] = usePersistedBoolean("kanban_col_in-review_collapsed", false);
  const [doneCollapsed, setDoneCollapsed] = usePersistedBoolean("kanban_col_done_collapsed", false);

  const collapsedMap = useMemo<Record<TaskStatus, boolean>>(() => ({
    backlog: backlogCollapsed,
    ready: readyCollapsed,
    "in-progress": inProgressCollapsed,
    "in-review": inReviewCollapsed,
    done: doneCollapsed,
    archived: false,
  }), [backlogCollapsed, readyCollapsed, inProgressCollapsed, inReviewCollapsed, doneCollapsed]);

  const toggleCollapsed = useCallback((status: TaskStatus) => {
    const setters: Record<string, (v: boolean) => void> = {
      backlog: setBacklogCollapsed,
      ready: setReadyCollapsed,
      "in-progress": setInProgressCollapsed,
      "in-review": setInReviewCollapsed,
      done: setDoneCollapsed,
    };
    const setter = setters[status];
    if (setter) setter(!collapsedMap[status]);
  }, [collapsedMap, setBacklogCollapsed, setReadyCollapsed, setInProgressCollapsed, setInReviewCollapsed, setDoneCollapsed]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      setActiveTask(task ?? null);
    },
    [tasks],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;
      const newStatus = over.id as TaskStatus;
      const task = tasks.find((t) => t.id === active.id);
      if (!task || task.status === newStatus) return;
      onStatusChange(task.id, newStatus);
    },
    [tasks, onStatusChange],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
  }, []);

  // Build task lookup map and dependency data (memoized)
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const dependentsMap = useMemo(() => buildDependentsMap(tasks), [tasks]);

  // Group tasks into columns with sorting
  const columnTasks = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const col of BOARD_COLUMNS) map.set(col, []);
    for (const task of tasks) {
      const col = map.get(task.status);
      if (col) col.push(task);
    }
    // Apply sort mode within each column
    for (const col of BOARD_COLUMNS) {
      const colTasks = map.get(col);
      if (colTasks && colTasks.length > 1) {
        if (sortMode === "topological") {
          map.set(col, topoSortTasks(colTasks, tasks));
        } else {
          map.set(col, sortTasksByMode(colTasks, sortMode));
        }
      }
    }
    return map;
  }, [tasks, sortMode]);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-2 flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-px">
        {BOARD_COLUMNS.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={columnTasks.get(status) ?? []}
            allTasks={tasks}
            taskMap={taskMap}
            dependentsMap={dependentsMap}
            sessionMap={sessionMap}
            allLabels={allLabels}
            onTaskClick={onTaskClick}
            onStartSession={onStartSession}
            onResearchSession={onResearchSession}
            onViewSession={onViewSession}
            sortMode={sortMode}
            onSortChange={setSortMode}
            collapsed={collapsedMap[status]}
            onToggleCollapsed={() => toggleCollapsed(status)}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div className="w-[200px]">
            <TaskCard
              task={activeTask}
              linkedSession={sessionMap.get(activeTask.id) ?? null}
              onClick={() => {}}
              isDragOverlay
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
