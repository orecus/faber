import React from "react";
import {
  type GraphNode,
  columnToX,
  rowToY,
  RAIL_COLORS,
} from "../../lib/graphLayout";

interface GraphCanvasProps {
  nodes: GraphNode[];
  totalHeight: number;
  graphWidth: number;
  visibleStart: number;
  visibleEnd: number;
}

const BUFFER_ROWS = 20;

function GraphCanvasInner({
  nodes,
  totalHeight,
  graphWidth,
  visibleStart,
  visibleEnd,
}: GraphCanvasProps) {
  const bufferedStart = Math.max(0, visibleStart - BUFFER_ROWS);
  const bufferedEnd = Math.min(nodes.length, visibleEnd + BUFFER_ROWS);

  const paths: React.ReactNode[] = [];

  for (let i = bufferedStart; i < bufferedEnd; i++) {
    const node = nodes[i];
    if (!node) continue;

    for (const conn of node.parentConnections) {
      const x1 = columnToX(node.column);
      const y1 = rowToY(node.row);
      const x2 = columnToX(conn.parentColumn);
      const y2 = rowToY(conn.parentRow);

      const color =
        conn.connectionType === "straight"
          ? node.railColor
          : RAIL_COLORS[conn.parentColumn % RAIL_COLORS.length];

      if (conn.connectionType === "straight") {
        paths.push(
          <line
            key={`${node.commit.hash}-${conn.parentHash}-s`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth={2}
            strokeOpacity={conn.isOffScreen ? 0.5 : 1}
            strokeDasharray={conn.isOffScreen ? "4 2" : undefined}
          />,
        );
      } else {
        // Adaptive Bezier curves: scale control point factor based on
        // column distance to avoid overlapping lines on wide merges
        const colDist = Math.abs(node.column - conn.parentColumn);
        const cpFactor = colDist <= 2 ? 0.3 : colDist <= 4 ? 0.2 : 0.15;
        const cy = y1 + (y2 - y1) * cpFactor;
        const d = `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
        paths.push(
          <path
            key={`${node.commit.hash}-${conn.parentHash}-m`}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeOpacity={conn.isOffScreen ? 0.5 : 1}
            strokeDasharray={conn.isOffScreen ? "4 2" : undefined}
          />,
        );
      }
    }
  }

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width={graphWidth}
      height={totalHeight}
      style={{ minHeight: totalHeight }}
    >
      {paths}
    </svg>
  );
}

const GraphCanvas = React.memo(GraphCanvasInner);
export default GraphCanvas;
