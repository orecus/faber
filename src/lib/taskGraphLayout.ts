import type { Task, TaskStatus } from "../types";

// ── Constants ──

export const NODE_WIDTH = 140;
export const NODE_HEIGHT = 36;
export const LAYER_GAP_X = 180;
export const NODE_GAP_Y = 52;
export const PADDING = 40;

// ── Types ──

export interface TaskGraphNode {
  task: Task;
  x: number;
  y: number;
  layer: number;
}

export interface TaskGraphEdge {
  from: string; // task ID
  to: string;   // task ID
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface TaskGraphLayout {
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  width: number;
  height: number;
}

// ── Status colors for graph nodes ──

export const STATUS_NODE_COLORS: Record<TaskStatus, string> = {
  backlog: "#6b7280",    // gray
  ready: "#3b82f6",      // blue
  "in-progress": "#f59e0b", // amber
  "in-review": "#a855f7",   // purple
  done: "#22c55e",       // green
  archived: "#9ca3af",   // light gray
};

// ── Layout algorithm ──

/**
 * Layered graph layout (simplified Sugiyama) for task dependency DAG.
 *
 * 1. Assign layers via longest-path from roots
 * 2. Order nodes within layers to minimize crossings (simple barycenter heuristic)
 * 3. Compute (x, y) positions
 */
export function layoutTaskGraph(tasks: Task[]): TaskGraphLayout {
  if (tasks.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const taskIds = new Set(tasks.map((t) => t.id));

  // Build adjacency (only edges within our task set)
  const children = new Map<string, string[]>(); // parent → children (tasks that depend on parent)
  const parents = new Map<string, string[]>();   // child → parents (dependencies)

  for (const t of tasks) {
    if (!children.has(t.id)) children.set(t.id, []);
    const myParents: string[] = [];
    for (const depId of t.depends_on) {
      if (taskIds.has(depId)) {
        myParents.push(depId);
        if (!children.has(depId)) children.set(depId, []);
        children.get(depId)!.push(t.id);
      }
    }
    parents.set(t.id, myParents);
  }

  // Step 1: Assign layers via longest path from roots
  const layers = new Map<string, number>();

  function assignLayer(id: string, visited: Set<string>): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visited.has(id)) return 0; // cycle
    visited.add(id);

    const myParents = parents.get(id) ?? [];
    let maxParent = -1;
    for (const pid of myParents) {
      maxParent = Math.max(maxParent, assignLayer(pid, visited));
    }

    const layer = maxParent + 1;
    layers.set(id, layer);
    return layer;
  }

  for (const t of tasks) {
    assignLayer(t.id, new Set());
  }

  // Group by layer
  const layerGroups = new Map<number, string[]>();
  let maxLayer = 0;
  for (const [id, layer] of layers) {
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(id);
    maxLayer = Math.max(maxLayer, layer);
  }

  // Step 2: Simple ordering within layers (barycenter heuristic)
  // For each layer > 0, order by average position of parents in previous layer
  const positions = new Map<string, number>(); // id → position within layer

  // Initialize layer 0 positions
  const layer0 = layerGroups.get(0) ?? [];
  layer0.forEach((id, i) => positions.set(id, i));

  for (let l = 1; l <= maxLayer; l++) {
    const group = layerGroups.get(l) ?? [];
    const barycenters: [string, number][] = group.map((id) => {
      const myParents = parents.get(id) ?? [];
      if (myParents.length === 0) return [id, 0] as [string, number];
      const avg = myParents.reduce((sum, pid) => sum + (positions.get(pid) ?? 0), 0) / myParents.length;
      return [id, avg] as [string, number];
    });
    barycenters.sort((a, b) => a[1] - b[1]);
    barycenters.forEach(([id], i) => positions.set(id, i));

    // Update layer group order
    layerGroups.set(l, barycenters.map(([id]) => id));
  }

  // Step 3: Compute coordinates
  const nodes: TaskGraphNode[] = [];
  const nodePositions = new Map<string, { x: number; y: number }>();

  for (let l = 0; l <= maxLayer; l++) {
    const group = layerGroups.get(l) ?? [];
    const x = PADDING + l * LAYER_GAP_X;
    for (let i = 0; i < group.length; i++) {
      const id = group[i];
      const task = taskMap.get(id)!;
      const y = PADDING + i * NODE_GAP_Y;
      nodes.push({ task, x, y, layer: l });
      nodePositions.set(id, { x, y });
    }
  }

  // Step 4: Compute edges
  const edges: TaskGraphEdge[] = [];
  for (const t of tasks) {
    const toPos = nodePositions.get(t.id);
    if (!toPos) continue;
    for (const depId of t.depends_on) {
      const fromPos = nodePositions.get(depId);
      if (!fromPos) continue;
      edges.push({
        from: depId,
        to: t.id,
        fromX: fromPos.x + NODE_WIDTH,
        fromY: fromPos.y + NODE_HEIGHT / 2,
        toX: toPos.x,
        toY: toPos.y + NODE_HEIGHT / 2,
      });
    }
  }

  // Compute canvas size
  const maxX = nodes.reduce((max, n) => Math.max(max, n.x), 0) + NODE_WIDTH + PADDING;
  const maxY = nodes.reduce((max, n) => Math.max(max, n.y), 0) + NODE_HEIGHT + PADDING;

  return { nodes, edges, width: maxX, height: maxY };
}
