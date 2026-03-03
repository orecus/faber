import type { Task, TaskStatus } from "../types";

// ── Dependency helpers ──

/**
 * Build a reverse lookup: for each task ID, which other task IDs depend on it.
 */
export function buildDependentsMap(tasks: Task[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const task of tasks) {
    for (const depId of task.depends_on) {
      if (!map[depId]) map[depId] = [];
      map[depId].push(task.id);
    }
  }
  return map;
}

/**
 * Check if a task is blocked (has unmet dependencies).
 * A dependency is unmet if the depended-on task exists and is not "done" or "archived".
 */
export function isTaskBlocked(task: Task, taskMap: Map<string, Task>): boolean {
  if (task.depends_on.length === 0) return false;
  return task.depends_on.some((depId) => {
    const dep = taskMap.get(depId);
    return dep != null && dep.status !== "done" && dep.status !== "archived";
  });
}

/**
 * Count how many dependencies are unmet.
 */
export function unmetDependencyCount(task: Task, taskMap: Map<string, Task>): number {
  return task.depends_on.filter((depId) => {
    const dep = taskMap.get(depId);
    return dep != null && dep.status !== "done" && dep.status !== "archived";
  }).length;
}

// ── Topological sort within a column ──

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

/**
 * Topological sort: tasks whose dependencies are satisfied (or in other columns)
 * float above tasks that depend on them within the same column.
 *
 * Ties broken by priority (P0 > P1 > P2), then by creation date (oldest first).
 * Handles cycles gracefully by breaking them.
 */
export function topoSortTasks(columnTasks: Task[], _allTasks: Task[]): Task[] {
  if (columnTasks.length <= 1) return columnTasks;

  const columnIds = new Set(columnTasks.map((t) => t.id));

  // Build adjacency within this column only
  // Edge: depId → taskId means depId should appear before taskId
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const t of columnTasks) {
    inDegree.set(t.id, 0);
    adj.set(t.id, []);
  }

  for (const t of columnTasks) {
    for (const depId of t.depends_on) {
      if (columnIds.has(depId)) {
        // depId should come before t.id
        adj.get(depId)!.push(t.id);
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm with priority-based tie-breaking
  const taskById = new Map(columnTasks.map((t) => [t.id, t]));
  const queue: Task[] = [];

  for (const t of columnTasks) {
    if ((inDegree.get(t.id) ?? 0) === 0) {
      queue.push(t);
    }
  }

  // Sort queue by priority then creation date
  const compareTasks = (a: Task, b: Task): number => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return a.created_at.localeCompare(b.created_at);
  };

  queue.sort(compareTasks);

  const result: Task[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    result.push(current);

    for (const nextId of adj.get(current.id) ?? []) {
      const deg = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, deg);
      if (deg === 0 && !visited.has(nextId)) {
        const nextTask = taskById.get(nextId);
        if (nextTask) {
          queue.push(nextTask);
          queue.sort(compareTasks);
        }
      }
    }
  }

  // Append any remaining tasks (cycles) sorted by priority
  for (const t of columnTasks) {
    if (!visited.has(t.id)) {
      result.push(t);
    }
  }

  return result;
}

// ── Tree depth for backlog indentation ──

/**
 * Calculate tree depth for backlog tasks.
 * Depth = how many levels deep in the dependency chain within the same column.
 * A task with no in-column dependencies has depth 0.
 */
export function computeTreeDepths(
  columnTasks: Task[],
): Map<string, number> {
  const columnIds = new Set(columnTasks.map((t) => t.id));
  const depths = new Map<string, number>();

  function getDepth(taskId: string, visited: Set<string>): number {
    if (depths.has(taskId)) return depths.get(taskId)!;
    if (visited.has(taskId)) return 0; // cycle guard
    visited.add(taskId);

    const task = columnTasks.find((t) => t.id === taskId);
    if (!task) return 0;

    let maxParentDepth = -1;
    for (const depId of task.depends_on) {
      if (columnIds.has(depId)) {
        maxParentDepth = Math.max(maxParentDepth, getDepth(depId, visited));
      }
    }

    const depth = maxParentDepth + 1;
    depths.set(taskId, depth);
    return depth;
  }

  for (const t of columnTasks) {
    getDepth(t.id, new Set());
  }

  return depths;
}

// ── Column items with ghost parents ──

export type ColumnItem =
  | { type: "task"; task: Task; depth: number }
  | { type: "ghost"; parentTask: Task; depth: number };

const STATUS_ORDER: Record<TaskStatus, number> = {
  backlog: 0,
  ready: 1,
  "in-progress": 2,
  "in-review": 3,
  done: 4,
  archived: 5,
};

/**
 * Build a flat render list for a column that includes:
 * - Ghost parent headers for tasks whose dependencies live in other columns
 * - Proper depth (indentation) for all tasks — in-column nesting + cross-column nesting
 *
 * Tasks are expected to already be topologically sorted.
 */
export function buildColumnItems(
  columnTasks: Task[],
  taskMap: Map<string, Task>,
): ColumnItem[] {
  if (columnTasks.length === 0) return [];

  const columnIds = new Set(columnTasks.map((t) => t.id));
  const inColumnDepths = computeTreeDepths(columnTasks);

  // Find cross-column parents: group child tasks by their external parent
  // A cross-column parent is a depends_on target that exists but is NOT in this column
  // and is NOT done/archived (i.e. it's an active, unmet dependency)
  const ghostParentChildren = new Map<string, string[]>();
  const taskCrossParents = new Map<string, string[]>(); // taskId → cross-column parent IDs

  for (const task of columnTasks) {
    const crossDeps = task.depends_on.filter((depId) => {
      const dep = taskMap.get(depId);
      return dep != null && !columnIds.has(depId) && dep.status !== "done" && dep.status !== "archived";
    });
    if (crossDeps.length > 0) {
      taskCrossParents.set(task.id, crossDeps);
      // Use the first (primary) cross-column dep as the ghost parent
      const primaryDep = crossDeps[0];
      if (!ghostParentChildren.has(primaryDep)) {
        ghostParentChildren.set(primaryDep, []);
      }
      ghostParentChildren.get(primaryDep)!.push(task.id);
    }
  }

  // If no cross-column deps, just return tasks with their in-column depths
  if (ghostParentChildren.size === 0) {
    return columnTasks.map((task) => ({
      type: "task" as const,
      task,
      depth: inColumnDepths.get(task.id) ?? 0,
    }));
  }

  // Sort ghost parents by status order (earlier status first), then by ID
  const sortedGhostParentIds = [...ghostParentChildren.keys()].sort((a, b) => {
    const taskA = taskMap.get(a);
    const taskB = taskMap.get(b);
    const statusA = taskA ? STATUS_ORDER[taskA.status] ?? 99 : 99;
    const statusB = taskB ? STATUS_ORDER[taskB.status] ?? 99 : 99;
    if (statusA !== statusB) return statusA - statusB;
    return a.localeCompare(b);
  });

  // Build the render list
  const items: ColumnItem[] = [];
  const renderedTaskIds = new Set<string>();

  // First: render tasks that have cross-column parents, grouped under ghost headers
  for (const ghostId of sortedGhostParentIds) {
    const parentTask = taskMap.get(ghostId);
    if (!parentTask) continue;

    items.push({ type: "ghost", parentTask, depth: 0 });

    const childIds = new Set(ghostParentChildren.get(ghostId) ?? []);
    // Render children in their original topological order
    for (const task of columnTasks) {
      if (childIds.has(task.id) && !renderedTaskIds.has(task.id)) {
        renderedTaskIds.add(task.id);
        items.push({
          type: "task",
          task,
          depth: 1 + (inColumnDepths.get(task.id) ?? 0),
        });
      }
    }
  }

  // Then: render remaining tasks (no cross-column deps) at their normal depth
  for (const task of columnTasks) {
    if (!renderedTaskIds.has(task.id)) {
      items.push({
        type: "task",
        task,
        depth: inColumnDepths.get(task.id) ?? 0,
      });
    }
  }

  return items;
}
