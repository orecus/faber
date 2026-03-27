import React, { useMemo, useCallback, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Lock,
  Play,
  Lightbulb,
  Search,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  CirclePause,
  Minus,
} from "lucide-react";
import type { Task, Session } from "../../types";
import { useAppStore } from "../../store/appStore";
import { isTaskBlocked, buildDependentsMap } from "../../lib/taskSort";
import { TASK_STATUS_DOT_COLORS, TASK_STATUS_LABELS } from "../../lib/taskStatusColors";
import PriorityBadge from "./PriorityBadge";
import { Button } from "../ui/orecus.io/components/enhanced-button";

// ── Build tree structure ──

interface TreeNode {
  task: Task;
  children: TreeNode[];
}

function buildTree(tasks: Task[]): TreeNode[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const taskIds = new Set(tasks.map((t) => t.id));

  // Find which tasks are children (appear in someone's depends_on within our set)
  const childIds = new Set<string>();
  for (const t of tasks) {
    for (const depId of t.depends_on) {
      if (taskIds.has(depId)) {
        // t depends on depId => t is a child of depId
        childIds.add(t.id);
      }
    }
  }

  // Build adjacency: parent → children
  // If task B depends_on A, then A is parent, B is child
  const childrenMap = new Map<string, string[]>();
  for (const t of tasks) {
    for (const depId of t.depends_on) {
      if (taskIds.has(depId)) {
        if (!childrenMap.has(depId)) childrenMap.set(depId, []);
        childrenMap.get(depId)!.push(t.id);
      }
    }
  }

  // Recursively build tree nodes (with cycle protection)
  function buildNode(taskId: string, visited: Set<string>): TreeNode | null {
    const task = taskMap.get(taskId);
    if (!task || visited.has(taskId)) return null;
    visited.add(taskId);

    const childTaskIds = childrenMap.get(taskId) ?? [];
    const children: TreeNode[] = [];
    for (const childId of childTaskIds) {
      const childNode = buildNode(childId, visited);
      if (childNode) children.push(childNode);
    }

    // Sort children: P0 first, then P1, then P2, then alphabetical
    const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
    children.sort((a, b) => {
      const pa = priorityOrder[a.task.priority] ?? 2;
      const pb = priorityOrder[b.task.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.task.title.localeCompare(b.task.title);
    });

    return { task, children };
  }

  // Root tasks: tasks that are NOT a child of any other task in the set
  const roots: TreeNode[] = [];
  for (const t of tasks) {
    if (!childIds.has(t.id)) {
      const node = buildNode(t.id, new Set());
      if (node) roots.push(node);
    }
  }

  // Sort roots same way
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  roots.sort((a, b) => {
    const pa = priorityOrder[a.task.priority] ?? 2;
    const pb = priorityOrder[b.task.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.task.title.localeCompare(b.task.title);
  });

  return roots;
}

// ── Tree row component ──

function TreeRow({
  node,
  depth,
  isLast,
  ancestors,
  taskMap,
  sessionMap,
  collapsed,
  onToggle,
  onTaskClick,
  onStartSession,
  onResearchSession,
  onViewSession,
}: {
  node: TreeNode;
  depth: number;
  isLast: boolean;
  ancestors: boolean[]; // whether each ancestor is the last child at its level
  taskMap: Map<string, Task>;
  sessionMap: Map<string, Session>;
  collapsed: Set<string>;
  onToggle: (taskId: string) => void;
  onTaskClick: (taskId: string) => void;
  onStartSession?: (taskId: string) => void;
  onResearchSession?: (taskId: string) => void;
  onViewSession?: (sessionId: string) => void;
}) {
  const { task, children } = node;
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(task.id);
  const blocked = isTaskBlocked(task, taskMap);
  const session = sessionMap.get(task.id) ?? null;
  const mcpData = useAppStore((s) =>
    session ? s.mcpStatus[session.id] : undefined,
  );
  const isActive =
    session != null &&
    (session.status === "running" || session.status === "starting") &&
    !mcpData?.completed;

  return (
    <>
      {/* This row */}
      <div
        className={`group flex items-center gap-0 hover:bg-accent/50 transition-colors rounded-[var(--radius-element)] cursor-pointer ${
          blocked ? "opacity-70" : ""
        }`}
        onClick={() => onTaskClick(task.id)}
      >
        {/* Tree guide lines */}
        <div className="flex items-center shrink-0" style={{ width: depth * 20 }}>
          {ancestors.map((isAncestorLast, i) => (
            <div key={i} className="w-5 h-8 flex items-center justify-center shrink-0">
              {!isAncestorLast && (
                <div className="w-px h-full bg-border/40" />
              )}
            </div>
          ))}
        </div>

        {/* Connector for non-root items */}
        {depth > 0 && (
          <div className="w-5 h-8 flex items-center shrink-0 relative">
            {/* Vertical line from parent */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-px bg-border/40"
              style={{ top: 0, height: isLast ? "50%" : "100%" }}
            />
            {/* Horizontal branch */}
            <div className="absolute top-1/2 left-1/2 w-2.5 h-px bg-border/40" />
          </div>
        )}

        {/* Expand/collapse or leaf indicator */}
        <button
          className="w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-accent cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(task.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {hasChildren ? (
            isCollapsed ? (
              <ChevronRight className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            )
          ) : (
            <Minus className="size-2.5 text-border" />
          )}
        </button>

        {/* Status dot */}
        <div className={`size-2 rounded-full shrink-0 mr-2 ${TASK_STATUS_DOT_COLORS[task.status]}`} />

        {/* Priority */}
        <div className="shrink-0 mr-1.5">
          <PriorityBadge priority={task.priority} />
        </div>

        {/* Title */}
        <span className="text-xs font-medium text-foreground truncate flex-1 leading-none">
          {task.title}
        </span>

        {/* Blocked indicator */}
        {blocked && (
          <span className="flex items-center gap-0.5 text-2xs text-warning mr-2 shrink-0">
            <Lock className="size-3" />
            blocked
          </span>
        )}

        {/* Status label */}
        <span className="text-2xs text-muted-foreground mr-2 shrink-0 w-16 text-right">
          {TASK_STATUS_LABELS[task.status]}
        </span>

        {/* Agent */}
        {task.agent && (
          <span className="text-2xs text-muted-foreground mr-2 shrink-0 w-16 truncate text-right">
            {task.agent}
          </span>
        )}

        {/* MCP / Session status */}
        <div className="w-24 shrink-0 flex items-center justify-end gap-1 mr-1">
          {isActive && mcpData ? (
            <>
              {mcpData.completed ? (
                <CheckCircle2 className="size-3 text-success" />
              ) : mcpData.error || mcpData.status === "error" ? (
                <AlertTriangle className="size-3 text-destructive" />
              ) : mcpData.waiting || mcpData.status === "waiting" ? (
                <CirclePause className="size-3 text-warning" />
              ) : (
                <Loader2 className="size-3 text-primary animate-spin" />
              )}
              <span className="text-2xs text-muted-foreground truncate">
                {mcpData.current_step != null && mcpData.total_steps != null
                  ? `${mcpData.current_step}/${mcpData.total_steps}`
                  : mcpData.message || "Working"}
              </span>
            </>
          ) : isActive ? (
            <>
              <Loader2 className="size-3 text-primary animate-spin" />
              <span className="text-2xs text-muted-foreground">Starting</span>
            </>
          ) : null}
        </div>

        {/* Action buttons */}
        <div className="w-14 shrink-0 flex items-center justify-end gap-0.5 opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {!isActive && (task.status === "backlog" || task.status === "ready") && onResearchSession && (
            <Button
              variant="ghost"
              size="icon-xs"
              hoverEffect="scale"
              clickEffect="scale"
              title="Research task"
              onClick={(e) => {
                e.stopPropagation();
                onResearchSession(task.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Lightbulb className="size-3 text-warning" />
            </Button>
          )}
          {!isActive && task.status !== "done" && task.status !== "in-review" && onStartSession && (
            <Button
              variant="ghost"
              size="icon-xs"
              hoverEffect="scale"
              clickEffect="scale"
              title="Start task"
              onClick={(e) => {
                e.stopPropagation();
                onStartSession(task.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Play className="size-3" />
            </Button>
          )}
          {task.status === "in-review" && session && onViewSession && (
            <Button
              variant="ghost"
              size="icon-xs"
              hoverEffect="scale"
              clickEffect="scale"
              title="View session"
              onClick={(e) => {
                e.stopPropagation();
                onViewSession(session.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Search className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Children (if expanded) */}
      {hasChildren &&
        !isCollapsed &&
        children.map((child, i) => (
          <TreeRow
            key={child.task.id}
            node={child}
            depth={depth + 1}
            isLast={i === children.length - 1}
            ancestors={[...ancestors, isLast]}
            taskMap={taskMap}
            sessionMap={sessionMap}
            collapsed={collapsed}
            onToggle={onToggle}
            onTaskClick={onTaskClick}
            onStartSession={onStartSession}
            onResearchSession={onResearchSession}
            onViewSession={onViewSession}
          />
        ))}
    </>
  );
}

// ── Main component ──

interface DependencyGraphProps {
  tasks: Task[];
  sessionMap: Map<string, Session>;
  onTaskClick: (taskId: string) => void;
  onStartSession?: (taskId: string) => void;
  onResearchSession?: (taskId: string) => void;
  onViewSession?: (sessionId: string) => void;
}

export default React.memo(function DependencyGraph({
  tasks,
  sessionMap,
  onTaskClick,
  onStartSession,
  onResearchSession,
  onViewSession,
}: DependencyGraphProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const tree = useMemo(() => buildTree(tasks), [tasks]);

  // Count stats
  const stats = useMemo(() => {
    const depCount = tasks.filter((t) => t.depends_on.length > 0).length;
    const blockedCount = tasks.filter((t) => isTaskBlocked(t, taskMap)).length;
    const rootCount = tree.length;
    return { depCount, blockedCount, rootCount };
  }, [tasks, taskMap, tree]);

  const handleToggle = useCallback((taskId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    // Collapse every node that has children
    const ids = new Set<string>();
    const dependentsMap = buildDependentsMap(tasks);
    for (const id of Object.keys(dependentsMap)) {
      if (dependentsMap[id].length > 0) ids.add(id);
    }
    setCollapsed(ids);
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No tasks to display
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tree toolbar */}
      <div className="flex items-center gap-3 px-2 py-1.5 border-b border-border/40 shrink-0">
        <span className="text-xs text-muted-foreground">
          {stats.rootCount} root{stats.rootCount !== 1 ? "s" : ""}
        </span>
        {stats.depCount > 0 && (
          <>
            <span className="text-border">·</span>
            <span className="text-xs text-muted-foreground">
              {stats.depCount} with dependencies
            </span>
          </>
        )}
        {stats.blockedCount > 0 && (
          <>
            <span className="text-border">·</span>
            <span className="text-xs text-warning">
              {stats.blockedCount} blocked
            </span>
          </>
        )}
        <div className="flex-1" />
        <button
          onClick={handleExpandAll}
          className="text-2xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          Expand all
        </button>
        <button
          onClick={handleCollapseAll}
          className="text-2xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          Collapse all
        </button>
      </div>

      {/* Tree content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
        {tree.map((node, i) => (
          <TreeRow
            key={node.task.id}
            node={node}
            depth={0}
            isLast={i === tree.length - 1}
            ancestors={[]}
            taskMap={taskMap}
            sessionMap={sessionMap}
            collapsed={collapsed}
            onToggle={handleToggle}
            onTaskClick={onTaskClick}
            onStartSession={onStartSession}
            onResearchSession={onResearchSession}
            onViewSession={onViewSession}
          />
        ))}
      </div>
    </div>
  );
});
