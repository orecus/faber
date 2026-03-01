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
import { topoSortTasks, buildDependentsMap } from "../../lib/taskSort";
import KanbanColumn from "./KanbanColumn";
import TaskCard from "./TaskCard";

const BOARD_COLUMNS: TaskStatus[] = ["backlog", "ready", "in-progress", "in-review", "done"];

interface KanbanBoardProps {
  tasks: Task[];
  sessionMap: Map<string, Session>;
  onTaskClick: (taskId: string) => void;
  onStatusChange: (taskId: string, newStatus: TaskStatus) => void;
  onStartSession: (taskId: string) => void;
  onResearchSession: (taskId: string) => void;
  onViewSession: (sessionId: string) => void;
}

export default function KanbanBoard({
  tasks,
  sessionMap,
  onTaskClick,
  onStatusChange,
  onStartSession,
  onResearchSession,
  onViewSession,
}: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

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

  // Group tasks into columns with topological sorting
  const columnTasks = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const col of BOARD_COLUMNS) map.set(col, []);
    for (const task of tasks) {
      const col = map.get(task.status);
      if (col) col.push(task);
    }
    // Apply topological sort within each column
    for (const col of BOARD_COLUMNS) {
      const colTasks = map.get(col);
      if (colTasks && colTasks.length > 1) {
        map.set(col, topoSortTasks(colTasks, tasks));
      }
    }
    return map;
  }, [tasks]);

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
            onTaskClick={onTaskClick}
            onStartSession={onStartSession}
            onResearchSession={onResearchSession}
            onViewSession={onViewSession}
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
