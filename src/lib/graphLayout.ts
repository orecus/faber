import type { CommitInfo } from "../types";

// ── Constants ──

export const ROW_HEIGHT = 28;
export const RAIL_WIDTH = 16;
export const GRAPH_PADDING = 12;

// GitKraken-inspired 8-color palette
export const RAIL_COLORS = [
  "#00b4d8", // cyan
  "#ef476f", // red
  "#06d6a0", // green
  "#ff9f1c", // orange
  "#7b2cbf", // purple
  "#f72585", // pink
  "#aacc00", // olive
  "#b5a3f5", // lavender
];

// ── Types ──

export type ConnectionType = "straight" | "mergeLeft" | "mergeRight";

export interface ParentConnection {
  parentHash: string;
  parentColumn: number;
  parentRow: number;
  connectionType: ConnectionType;
  isOffScreen: boolean;
}

export interface GraphNode {
  commit: CommitInfo;
  column: number;
  row: number;
  railColor: string;
  parentConnections: ParentConnection[];
}

// ── Coordinate helpers ──

export function columnToX(col: number): number {
  return GRAPH_PADDING + col * RAIL_WIDTH + RAIL_WIDTH / 2;
}

export function rowToY(row: number, rowHeight = ROW_HEIGHT): number {
  return row * rowHeight + rowHeight / 2;
}

// ── Layout algorithm ──

/**
 * Two-pass graph layout algorithm with column compaction.
 *
 * Pass 1: Assign columns to commits in topological order (newest first).
 * Pass 2: Compact columns to eliminate gaps (e.g. 0,2,5 → 0,1,2).
 * Pass 3: Build graph nodes with parent connections and colors.
 */
export function layoutGraph(commits: CommitInfo[]): GraphNode[] {
  if (commits.length === 0) return [];

  const commitIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    commitIndex.set(commits[i].hash, i);
  }

  // Pass 1: Column assignment
  // activeColumns[col] = hash of the commit expected to appear in that column next
  const activeColumns: (string | null)[] = [];
  const columnAssignment = new Array<number>(commits.length);

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];

    // Find if any active column is expecting this commit
    let assignedCol = -1;
    for (let c = 0; c < activeColumns.length; c++) {
      if (activeColumns[c] === commit.hash) {
        assignedCol = c;
        break;
      }
    }

    if (assignedCol === -1) {
      // No column expects this commit — find first available column
      let freeCol = activeColumns.indexOf(null);
      if (freeCol === -1) {
        freeCol = activeColumns.length;
        activeColumns.push(null);
      }
      assignedCol = freeCol;
    }

    columnAssignment[i] = assignedCol;

    // First parent continues in this column (straight line)
    if (commit.parent_hashes.length > 0) {
      activeColumns[assignedCol] = commit.parent_hashes[0];
    } else {
      // Root commit — free the column for reuse
      activeColumns[assignedCol] = null;
    }

    // Additional parents (merge commits) — prefer adjacent columns
    for (let p = 1; p < commit.parent_hashes.length; p++) {
      const parentHash = commit.parent_hashes[p];

      // Check if this parent is already expected in some column
      const existingCol = activeColumns.indexOf(parentHash);
      if (existingCol !== -1) {
        // Parent already tracked — will produce a merge connection
        continue;
      }

      // Prefer column adjacent to assignedCol to minimize line crossings
      let freeCol = -1;

      // Try adjacent columns first (left, then right)
      const candidates = [
        assignedCol + 1,
        assignedCol > 0 ? assignedCol - 1 : -1,
      ];
      for (const c of candidates) {
        if (c >= 0 && c < activeColumns.length && activeColumns[c] === null) {
          freeCol = c;
          break;
        }
      }

      // Fall back to first available
      if (freeCol === -1) {
        freeCol = activeColumns.indexOf(null);
      }
      if (freeCol === -1) {
        freeCol = activeColumns.length;
        activeColumns.push(null);
      }
      activeColumns[freeCol] = parentHash;
    }
  }

  // Pass 2: Column compaction — remap to eliminate gaps
  const usedCols = new Set<number>();
  for (let i = 0; i < commits.length; i++) {
    usedCols.add(columnAssignment[i]);
  }
  const sortedCols = Array.from(usedCols).sort((a, b) => a - b);
  const colRemap = new Map<number, number>();
  sortedCols.forEach((col, idx) => colRemap.set(col, idx));

  // Apply remapping
  for (let i = 0; i < commits.length; i++) {
    columnAssignment[i] = colRemap.get(columnAssignment[i]) ?? columnAssignment[i];
  }

  // Pass 3: Build graph nodes with connections
  const nodes: GraphNode[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const col = columnAssignment[i];
    const connections: ParentConnection[] = [];

    for (const parentHash of commit.parent_hashes) {
      const parentIdx = commitIndex.get(parentHash);

      if (parentIdx !== undefined) {
        const parentCol = columnAssignment[parentIdx];
        let connectionType: ConnectionType;

        if (parentCol === col) {
          connectionType = "straight";
        } else if (parentCol < col) {
          connectionType = "mergeLeft";
        } else {
          connectionType = "mergeRight";
        }

        connections.push({
          parentHash,
          parentColumn: parentCol,
          parentRow: parentIdx,
          connectionType,
          isOffScreen: false,
        });
      } else {
        // Parent is off-screen (not in loaded commits)
        connections.push({
          parentHash,
          parentColumn: col,
          parentRow: commits.length,
          connectionType: "straight",
          isOffScreen: true,
        });
      }
    }

    nodes.push({
      commit,
      column: col,
      row: i,
      railColor: RAIL_COLORS[col % RAIL_COLORS.length],
      parentConnections: connections,
    });
  }

  return nodes;
}

/**
 * Compute the maximum column used across all nodes.
 * Used to determine the width of the graph area.
 */
export function maxColumn(nodes: GraphNode[]): number {
  let max = 0;
  for (const node of nodes) {
    if (node.column > max) max = node.column;
    for (const conn of node.parentConnections) {
      if (conn.parentColumn > max) max = conn.parentColumn;
    }
  }
  return max;
}
