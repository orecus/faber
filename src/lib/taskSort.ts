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

/** Compare tasks by priority (P0 > P1 > P2), then by creation date (oldest first). */
function compareTasks(a: Task, b: Task): number {
  const pa = PRIORITY_ORDER[a.priority] ?? 2;
  const pb = PRIORITY_ORDER[b.priority] ?? 2;
  if (pa !== pb) return pa - pb;
  return a.created_at.localeCompare(b.created_at);
}

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
 * Uses DFS tree ordering so children always appear directly after their
 * parent, regardless of priority-based topological sort order.
 */
export function buildColumnItems(
  columnTasks: Task[],
  taskMap: Map<string, Task>,
): ColumnItem[] {
  if (columnTasks.length === 0) return [];

  const columnIds = new Set(columnTasks.map((t) => t.id));

  // Build in-column parent→children adjacency (reverse of depends_on)
  // If task B depends_on task A, then A is parent, B is child
  const childrenOf = new Map<string, Task[]>();
  for (const t of columnTasks) {
    childrenOf.set(t.id, []);
  }
  for (const t of columnTasks) {
    for (const depId of t.depends_on) {
      if (columnIds.has(depId)) {
        childrenOf.get(depId)!.push(t);
      }
    }
  }
  // Sort children by priority then creation date
  for (const [, children] of childrenOf) {
    children.sort(compareTasks);
  }

  // Identify cross-column parents (ghost parents)
  const ghostParentChildren = new Map<string, Task[]>();
  const hasCrossColumnParent = new Set<string>();

  for (const task of columnTasks) {
    const crossDeps = task.depends_on.filter((depId) => {
      const dep = taskMap.get(depId);
      return dep != null && !columnIds.has(depId) && dep.status !== "done" && dep.status !== "archived";
    });
    if (crossDeps.length > 0) {
      hasCrossColumnParent.add(task.id);
      // Group under the first (primary) cross-column parent
      const primaryDep = crossDeps[0];
      if (!ghostParentChildren.has(primaryDep)) {
        ghostParentChildren.set(primaryDep, []);
      }
      ghostParentChildren.get(primaryDep)!.push(task);
    }
  }
  // Sort ghost children by priority
  for (const [, children] of ghostParentChildren) {
    children.sort(compareTasks);
  }

  // Identify root tasks: tasks with no in-column parent AND no cross-column parent
  const hasInColumnParent = new Set<string>();
  for (const t of columnTasks) {
    for (const depId of t.depends_on) {
      if (columnIds.has(depId)) {
        hasInColumnParent.add(t.id);
      }
    }
  }
  const roots = columnTasks
    .filter((t) => !hasInColumnParent.has(t.id) && !hasCrossColumnParent.has(t.id))
    .sort(compareTasks);

  // DFS render: emit parent then recurse into children
  const items: ColumnItem[] = [];
  const visited = new Set<string>();

  function dfs(task: Task, depth: number) {
    if (visited.has(task.id)) return; // cycle guard
    visited.add(task.id);
    items.push({ type: "task", task, depth });
    for (const child of childrenOf.get(task.id) ?? []) {
      dfs(child, depth + 1);
    }
  }

  // 1. Render ghost parent groups first
  const sortedGhostParentIds = [...ghostParentChildren.keys()].sort((a, b) => {
    const tA = taskMap.get(a);
    const tB = taskMap.get(b);
    const sA = tA ? STATUS_ORDER[tA.status] ?? 99 : 99;
    const sB = tB ? STATUS_ORDER[tB.status] ?? 99 : 99;
    if (sA !== sB) return sA - sB;
    return a.localeCompare(b);
  });

  for (const ghostId of sortedGhostParentIds) {
    const parentTask = taskMap.get(ghostId);
    if (!parentTask) continue;

    items.push({ type: "ghost", parentTask, depth: 0 });

    for (const child of ghostParentChildren.get(ghostId) ?? []) {
      dfs(child, 1);
    }
  }

  // 2. Render root tasks (no parent) with their in-column subtrees
  for (const root of roots) {
    dfs(root, 0);
  }

  // 3. Append any remaining tasks (orphans from cycles, etc.)
  for (const t of columnTasks) {
    if (!visited.has(t.id)) {
      dfs(t, 0);
    }
  }

  return items;
}
