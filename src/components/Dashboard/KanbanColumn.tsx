import { memo, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import TaskCard from "./TaskCard";
import type { TaskCardVariant } from "./TaskCard";
import { ringColors } from "../ui/orecus.io/lib/color-utils";
import { isTaskBlocked, computeTreeDepths } from "../../lib/taskSort";

import type { Session, Task, TaskStatus } from "../../types";

const COLUMN_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  "in-progress": "In Progress",
  "in-review": "In Review",
  done: "Done",
  archived: "Archived",
};

/** Map column status to the TaskCard variant it should use */
function getVariantForColumn(status: TaskStatus): TaskCardVariant {
  switch (status) {
    case "backlog":
      return "tree-node";
    case "in-progress":
      return "detailed";
    case "done":
      return "compact";
    default:
      return "default";
  }
}

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  allTasks?: Task[];
  taskMap: Map<string, Task>;
  dependentsMap: Record<string, string[]>;
  sessionMap: Map<string, Session>;
  onTaskClick: (taskId: string) => void;
  onStartSession: (taskId: string) => void;
  onResearchSession: (taskId: string) => void;
  onViewSession: (sessionId: string) => void;
}

const KanbanColumn = memo(function KanbanColumn({
  status,
  tasks,
  taskMap,
  dependentsMap,
  sessionMap,
  onTaskClick,
  onStartSession,
  onResearchSession,
  onViewSession,
}: KanbanColumnProps) {
  const accentColor = useProjectAccentColor();
  const { isOver, setNodeRef } = useDroppable({ id: status });

  const variant = getVariantForColumn(status);

  // Compute tree depths for backlog column
  const treeDepths = useMemo(
    () => (status === "backlog" ? computeTreeDepths(tasks) : new Map<string, number>()),
    [status, tasks],
  );

  // Count blocked tasks for column subtitle
  const blockedCount = useMemo(() => {
    if (status !== "backlog" && status !== "ready") return 0;
    return tasks.filter((t) => isTaskBlocked(t, taskMap)).length;
  }, [status, tasks, taskMap]);

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[180px] min-h-0 flex flex-col rounded-[var(--radius-panel)] overflow-hidden transition-all duration-150 ${
        isOver
          ? `ring-1 ${ringColors[accentColor]} bg-accent/50`
          : "ring-1 ring-border/40 bg-card/50"
      }`}
    >
      {/* Column header */}
      <div className="px-2.5 py-2 flex items-center justify-between border-b border-border/60">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-dim-foreground uppercase tracking-[0.5px]">
            {COLUMN_LABELS[status]}
          </span>
          {blockedCount > 0 && (
            <span className="text-[9px] text-warning bg-warning/10 px-1 rounded">
              {blockedCount} blocked
            </span>
          )}
        </div>
        <span className={`text-[11px] tabular-nums min-w-[1.25rem] text-center rounded-full px-1 ${
          tasks.length > 0 ? "text-dim-foreground bg-accent" : "text-muted-foreground"
        }`}>
          {tasks.length}
        </span>
      </div>

      {/* Card list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-1.5">
        {tasks.map((task) => {
          const session = sessionMap.get(task.id) ?? null;
          const blocked = isTaskBlocked(task, taskMap);
          const deps = dependentsMap[task.id] ?? [];
          return (
            <TaskCard
              key={task.id}
              task={task}
              linkedSession={session}
              onClick={onTaskClick}
              onStartSession={onStartSession}
              onResearchSession={onResearchSession}
              onViewSession={onViewSession}
              variant={variant}
              taskMap={taskMap}
              dependents={deps}
              isBlocked={blocked}
              treeDepth={treeDepths.get(task.id) ?? 0}
            />
          );
        })}
      </div>
    </div>
  );
});

export default KanbanColumn;
