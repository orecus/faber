import { memo, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useDroppable, useDndContext } from "@dnd-kit/core";
import { ArrowUpDown, PanelLeftClose, PanelLeftOpen, Check, ChevronDown } from "lucide-react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import TaskCard from "./TaskCard";
import type { TaskCardVariant } from "./TaskCard";
import TaskCardContextMenu from "./TaskCardContextMenu";
import GhostParentCard from "./GhostParentCard";
import { ringColors } from "../ui/orecus.io/lib/color-utils";
import { isTaskBlocked, buildColumnItems, SORT_MODE_LABELS, type ColumnSortMode } from "../../lib/taskSort";

import type { Session, Task, TaskStatus } from "../../types";
import { useAppStore } from "../../store/appStore";
import { DEFAULT_PRIORITIES } from "../../lib/priorities";

/** Small vertical connector arrow shown between epic children that depend on each other */
function EpicDepConnector() {
  return (
    <div className="flex items-center justify-center h-2.5 -my-px relative">
      <div className="w-px h-full bg-primary/25" />
      <ChevronDown className="size-2 text-primary/40 absolute -bottom-0.5" />
    </div>
  );
}

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
  allLabels: string[];
  onTaskClick: (taskId: string) => void;
  onStartSession: (taskId: string) => void;
  onResearchSession: (taskId: string) => void;
  onBreakdownEpic?: (taskId: string) => void;
  onViewSession: (sessionId: string) => void;
  onEpicClick?: (epicId: string) => void;
  sortMode: ColumnSortMode;
  onSortChange: (mode: ColumnSortMode) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const SORT_MODES: ColumnSortMode[] = ["topological", "priority", "newest", "oldest", "alphabetical", "agent"];

const KanbanColumn = memo(function KanbanColumn({
  status,
  tasks,
  taskMap,
  dependentsMap,
  sessionMap,
  allLabels,
  onTaskClick,
  onStartSession,
  onResearchSession,
  onBreakdownEpic,
  onViewSession,
  onEpicClick,
  sortMode,
  onSortChange,
  collapsed,
  onToggleCollapsed,
}: KanbanColumnProps) {
  const accentColor = useProjectAccentColor();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const priorities = useAppStore((s) =>
    activeProjectId ? (s.projectPriorities[activeProjectId] ?? DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES
  );
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const { active } = useDndContext();
  const activeDragId = active?.id as string | undefined;
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const variant = getVariantForColumn(status);

  // Close sort menu on outside click
  useEffect(() => {
    if (!showSortMenu) return;
    const handler = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSortMenu]);

  const handleSortSelect = useCallback((mode: ColumnSortMode) => {
    onSortChange(mode);
    setShowSortMenu(false);
  }, [onSortChange]);

  // Build column items — topological mode uses full tree structure,
  // other modes use flat list but still nest epic children under their epic
  const columnItems = useMemo(
    () => {
      if (sortMode === "topological") {
        return buildColumnItems(tasks, taskMap, priorities);
      }
      // For non-topological modes, still group epic children under their epic
      const columnIds = new Set(tasks.map((t) => t.id));
      const epicChildIds = new Set<string>();
      const epicChildren = new Map<string, Task[]>();
      for (const t of tasks) {
        if (t.epic_id && columnIds.has(t.epic_id) && t.task_type !== "epic") {
          epicChildIds.add(t.id);
          if (!epicChildren.has(t.epic_id)) epicChildren.set(t.epic_id, []);
          epicChildren.get(t.epic_id)!.push(t);
        }
      }
      const items: import("../../lib/taskSort").ColumnItem[] = [];
      for (const task of tasks) {
        if (epicChildIds.has(task.id)) continue; // rendered under epic
        items.push({ type: "task", task, depth: 0 });
        if (task.task_type === "epic" && epicChildren.has(task.id)) {
          for (const child of epicChildren.get(task.id)!) {
            items.push({ type: "task", task: child, depth: 1 });
          }
        }
      }
      return items;
    },
    [tasks, taskMap, sortMode],
  );

  // Count blocked tasks for column subtitle
  const blockedCount = useMemo(() => {
    if (status === "done") return 0;
    return tasks.filter((t) => isTaskBlocked(t, taskMap)).length;
  }, [status, tasks, taskMap]);

  // Collapsed view — narrow vertical strip
  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        role="region"
        aria-label={`${COLUMN_LABELS[status]} column, ${tasks.length} tasks, collapsed`}
        className={`w-10 min-h-0 flex flex-col items-center rounded-[var(--radius-panel)] overflow-hidden transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isOver
            ? `ring-1 ${ringColors[accentColor]} bg-accent/50`
            : "ring-1 ring-border/40 bg-card/50"
        }`}
        tabIndex={0}
        onClick={onToggleCollapsed}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleCollapsed(); } }}
        title={`Expand ${COLUMN_LABELS[status]}`}
      >
        <div className="py-2">
          <PanelLeftOpen className="size-3.5 text-muted-foreground" />
        </div>
        <span className={`text-xs tabular-nums rounded-full px-1 ${
          tasks.length > 0 ? "text-dim-foreground bg-accent" : "text-muted-foreground"
        }`}>
          {tasks.length}
        </span>
        <div className="flex-1 flex items-center justify-center">
          <span
            className="text-xs font-semibold text-dim-foreground uppercase tracking-[0.5px]"
            style={{ writingMode: "vertical-lr", textOrientation: "mixed" }}
          >
            {COLUMN_LABELS[status]}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-label={`${COLUMN_LABELS[status]} column, ${tasks.length} tasks`}
      className={`flex-1 min-w-40 min-h-0 flex flex-col rounded-[var(--radius-panel)] overflow-hidden transition-all duration-150 ${
        isOver
          ? `ring-1 ${ringColors[accentColor]} bg-accent/50`
          : "ring-1 ring-border/40 bg-card/50"
      }`}
    >
      {/* Column header */}
      <div className="px-2.5 py-2 flex items-center justify-between border-b border-border/60">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-dim-foreground uppercase tracking-[0.5px]">
            {COLUMN_LABELS[status]}
          </span>
          {blockedCount > 0 && (
            <span className="text-2xs text-warning bg-warning/10 px-1 rounded">
              {blockedCount} blocked
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Sort button */}
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={() => setShowSortMenu((v) => !v)}
              aria-label={`Sort ${COLUMN_LABELS[status]}: ${SORT_MODE_LABELS[sortMode]}`}
              aria-expanded={showSortMenu}
              className={`p-0.5 rounded hover:bg-accent/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                sortMode !== "topological" ? "text-primary" : "text-muted-foreground"
              }`}
              title={`Sort: ${SORT_MODE_LABELS[sortMode]}`}
            >
              <ArrowUpDown className="size-3" />
            </button>
            {showSortMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-md">
                {SORT_MODES.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleSortSelect(mode)}
                    className="flex items-center gap-2 w-full px-2 py-1 text-xs text-left rounded hover:bg-accent/60 transition-colors"
                  >
                    <Check className={`size-3 ${sortMode === mode ? "opacity-100" : "opacity-0"}`} />
                    <span className={sortMode === mode ? "text-foreground font-medium" : "text-muted-foreground"}>
                      {SORT_MODE_LABELS[mode]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Collapse button */}
          <button
            onClick={onToggleCollapsed}
            aria-label={`Collapse ${COLUMN_LABELS[status]}`}
            aria-expanded={true}
            className="p-0.5 rounded hover:bg-accent/60 transition-colors text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={`Collapse ${COLUMN_LABELS[status]}`}
          >
            <PanelLeftClose className="size-3" />
          </button>
          {/* Task count */}
          <span className={`text-xs tabular-nums min-w-[1.25rem] text-center rounded-full px-1 ${
            tasks.length > 0 ? "text-dim-foreground bg-accent" : "text-muted-foreground"
          }`}>
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Card list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-1.5">
        {columnItems.length === 0 && (
          <p className="text-2xs text-muted-foreground text-center py-6 select-none">
            {status === "done"
              ? "Completed tasks appear here"
              : status === "in-review"
                ? "Tasks awaiting review appear here"
                : status === "in-progress"
                  ? "Start a session to move tasks here"
                  : "Drop tasks here"}
          </p>
        )}
        {columnItems.map((item, idx) => {
          if (item.type === "ghost") {
            return (
              <GhostParentCard
                key={`ghost-${item.parentTask.id}`}
                parentTask={item.parentTask}
                onClick={onTaskClick}
              />
            );
          }
          const { task, depth } = item;
          const session = sessionMap.get(task.id) ?? null;
          const blocked = isTaskBlocked(task, taskMap);
          const deps = dependentsMap[task.id] ?? [];

          // Check if we should render a dependency connector before this card
          // (epic children that depend on the previous epic sibling)
          const prevItem = idx > 0 ? columnItems[idx - 1] : null;
          const showConnector =
            depth > 0 &&
            prevItem?.type === "task" &&
            prevItem.depth > 0 &&
            task.depends_on.includes(prevItem.task.id);

          const isBeingDragged = activeDragId === task.id;

          return (
            <div key={task.id} className={isBeingDragged ? "opacity-0 pointer-events-none" : ""}>
              {showConnector && (
                <div style={{ marginLeft: `${depth * 12}px` }}>
                  <EpicDepConnector />
                </div>
              )}
              <TaskCardContextMenu
                task={task}
                allLabels={allLabels}
                onTaskClick={onTaskClick}
                onStartSession={onStartSession}
                onResearchSession={onResearchSession}
                onBreakdownEpic={onBreakdownEpic}
                onViewSession={onViewSession}
              >
                {(menuProps) => (
                  <TaskCard
                    task={task}
                    linkedSession={session}
                    onClick={onTaskClick}
                    onStartSession={onStartSession}
                    onResearchSession={onResearchSession}
                    onBreakdownEpic={onBreakdownEpic}
                    onViewSession={onViewSession}
                    onEpicClick={onEpicClick}
                    variant={variant}
                    taskMap={taskMap}
                    allTasks={tasks}
                    dependents={deps}
                    isBlocked={blocked}
                    treeDepth={depth}
                    onContextMenu={menuProps.onContextMenu}
                    isEditingTitle={menuProps.isEditingTitle}
                    onTitleSave={menuProps.onTitleSave}
                    onTitleEditCancel={menuProps.onTitleEditCancel}
                  />
                )}
              </TaskCardContextMenu>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default KanbanColumn;
