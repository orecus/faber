import { type ReactElement, type ReactNode, memo, useCallback, useMemo, useRef } from "react";
import type { GridLayoutState } from "../../store/appStore";

/** Extract the React key from a child node, or null if unavailable. */
function getChildKey(child: ReactNode): string | null {
  if (child !== null && typeof child === "object" && "key" in child) {
    return (child as ReactElement).key;
  }
  return null;
}

/**
 * Find which child key should be visible.
 * Returns targetKey if a matching child exists, otherwise falls back to the
 * first child's key.
 */
function resolveActiveKey(
  children: ReactNode[],
  targetKey: string | null,
): string | null {
  if (targetKey && children.some((c) => getChildKey(c) === targetKey)) {
    return targetKey;
  }
  return children.length > 0 ? getChildKey(children[0]) : null;
}

interface SessionGridProps {
  children: ReactNode[];
  layout: GridLayoutState;
  onLayoutChange: (update: Partial<GridLayoutState>) => void;
}

// Compute CSS grid template for auto-layout based on pane count
function computeAutoGrid(count: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  // 5+ panes: 2-column scrollable grid
  return { cols: 2, rows: Math.ceil(count / 2) };
}

/** For fixed modes, compute cols/rows that accommodate all panes.
 *  The mode defines the *orientation* — extra panes expand the grid
 *  rather than overflowing into implicit tracks. */
function getModeGrid(
  mode: GridLayoutState["mode"],
  count: number,
): { cols: number; rows: number } | null {
  switch (mode) {
    case "1-up":
      return { cols: 1, rows: 1 };
    case "2-up":
      // Horizontal split — all panes in one row
      return { cols: Math.max(2, count), rows: 1 };
    case "2-up-v":
      // Vertical split — all panes in one column
      return { cols: 1, rows: Math.max(2, count) };
    case "4-up":
      // 2-column grid, expand rows as needed
      return { cols: 2, rows: Math.max(2, Math.ceil(count / 2)) };
    default:
      return null;
  }
}

const MIN_RATIO = 20;

const SessionGrid = memo(function SessionGrid({
  children,
  layout,
  onLayoutChange,
}: SessionGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const count = children.length;

  const modeGrid = getModeGrid(layout.mode, count);
  const { cols, rows } = modeGrid ?? computeAutoGrid(count);

  // Build ratios (always computed so hooks below have stable deps)
  const colRatios =
    layout.columnRatios.length >= cols
      ? layout.columnRatios.slice(0, cols)
      : Array.from({ length: cols }, () => 100 / cols);
  const rowRatios =
    layout.rowRatios.length >= rows
      ? layout.rowRatios.slice(0, rows)
      : Array.from({ length: rows }, () => 100 / rows);

  // Column resize handles — must be declared before any early returns
  const handleColumnResize = useCallback(
    (handleIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      if (!containerRef.current) return;
      dragging.current = true;

      const rect = containerRef.current.getBoundingClientRect();
      const totalWidth = rect.width;
      const handleTrackPx = 8;
      const numHandles = colRatios.length - 1;
      const contentWidth = totalWidth - numHandles * handleTrackPx;
      const ratioSum = colRatios.reduce((a, b) => a + b, 0);

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const relX = ev.clientX - rect.left;

        // Pixel offset where the pair (handleIndex, handleIndex+1) starts
        let pairStartPx = 0;
        for (let i = 0; i < handleIndex; i++) {
          pairStartPx += (colRatios[i] / ratioSum) * contentWidth + handleTrackPx;
        }
        const pairRatioSum = colRatios[handleIndex] + colRatios[handleIndex + 1];
        const pairWidthPx = (pairRatioSum / ratioSum) * contentWidth;

        // Mouse position within the pair
        const posInPair = relX - pairStartPx;
        const fraction = Math.min(
          1 - MIN_RATIO / 100,
          Math.max(MIN_RATIO / 100, posInPair / pairWidthPx),
        );

        const newRatios = [...colRatios];
        newRatios[handleIndex] = pairRatioSum * fraction;
        newRatios[handleIndex + 1] = pairRatioSum * (1 - fraction);
        onLayoutChange({ columnRatios: newRatios });
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [colRatios, onLayoutChange],
  );

  // Row resize handles
  const handleRowResize = useCallback(
    (handleIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      if (!containerRef.current) return;
      dragging.current = true;

      const rect = containerRef.current.getBoundingClientRect();
      const totalHeight = rect.height;
      const handleTrackPx = 8;
      const numHandles = rowRatios.length - 1;
      const contentHeight = totalHeight - numHandles * handleTrackPx;
      const ratioSum = rowRatios.reduce((a, b) => a + b, 0);

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const relY = ev.clientY - rect.top;

        // Pixel offset where the pair (handleIndex, handleIndex+1) starts
        let pairStartPx = 0;
        for (let i = 0; i < handleIndex; i++) {
          pairStartPx += (rowRatios[i] / ratioSum) * contentHeight + handleTrackPx;
        }
        const pairRatioSum = rowRatios[handleIndex] + rowRatios[handleIndex + 1];
        const pairHeightPx = (pairRatioSum / ratioSum) * contentHeight;

        // Mouse position within the pair
        const posInPair = relY - pairStartPx;
        const fraction = Math.min(
          1 - MIN_RATIO / 100,
          Math.max(MIN_RATIO / 100, posInPair / pairHeightPx),
        );

        const newRatios = [...rowRatios];
        newRatios[handleIndex] = pairRatioSum * fraction;
        newRatios[handleIndex + 1] = pairRatioSum * (1 - fraction);
        onLayoutChange({ rowRatios: newRatios });
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [rowRatios, onLayoutChange],
  );

  // ── Early returns (after all hooks) ──

  if (count === 0) return null;

  // Maximized and 1-up modes: render ALL panes but hide non-active ones via
  // CSS so that xterm.js instances stay alive and preserve their buffers.
  if (layout.maximizedPaneId || layout.mode === "1-up") {
    const targetKey = layout.maximizedPaneId ?? layout.focusedPaneId;
    const activeKey = resolveActiveKey(children, targetKey);
    return (
      <div
        ref={containerRef}
        className="flex-1 min-h-0 grid grid-cols-1 grid-rows-1 gap-0"
      >
        {children.map((child, i) => {
          const visible = getChildKey(child) === activeKey;
          return (
            <div
              key={`single-${i}`}
              className={`col-start-1 row-start-1 min-h-0 min-w-0 ${visible ? "grid" : "hidden"}`}
            >
              {child}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Multi-pane grid layout ──

  const scrollable = layout.mode === "auto" && count > 4;

  // Memoize grid template strings to avoid rebuild on every render
  const { colTemplate, rowTemplate } = useMemo(() => {
    const colParts: string[] = [];
    for (let i = 0; i < cols; i++) {
      if (i > 0) colParts.push("8px"); // handle
      colParts.push(`${colRatios[i]}fr`);
    }

    const rowParts: string[] = [];
    for (let i = 0; i < rows; i++) {
      if (i > 0) rowParts.push("8px"); // handle
      rowParts.push(scrollable ? "minmax(200px, 1fr)" : `${rowRatios[i]}fr`);
    }

    return { colTemplate: colParts.join(" "), rowTemplate: rowParts.join(" ") };
  }, [cols, rows, colRatios, rowRatios, scrollable]);

  // Place children into grid cells, skipping handle tracks
  const gridChildren: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // Grid lines: col track 0 → line 1, handle → line 2, col track 1 → line 3, etc.
    const gridColumn = col * 2 + 1;
    const gridRow = row * 2 + 1;

    // Special case: 3 panes → last pane spans full width
    const spanCols =
      count === 3 && i === 2 && layout.mode === "auto" ? cols * 2 - 1 : 1;

    gridChildren.push(
      <div
        key={`cell-${i}`}
        className="min-h-0 min-w-0 grid"
        style={{
          gridColumn: spanCols > 1 ? `1 / -1` : gridColumn,
          gridRow,
        }}
      >
        {children[i]}
      </div>,
    );
  }

  // Add column resize handles
  for (let c = 0; c < cols - 1; c++) {
    const gridColumn = (c + 1) * 2; // handle track position
    gridChildren.push(
      <div
        key={`col-handle-${c}`}
        onMouseDown={(e) => handleColumnResize(c, e)}
        className="group cursor-col-resize z-5 relative"
        style={{
          gridColumn,
          gridRow: `1 / -1`,
        }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
          <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
          <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
        </div>
      </div>,
    );
  }

  // Add row resize handles
  if (!scrollable) {
    for (let r = 0; r < rows - 1; r++) {
      const gridRow = (r + 1) * 2; // handle track position
      gridChildren.push(
        <div
          key={`row-handle-${r}`}
          onMouseDown={(e) => handleRowResize(r, e)}
          className="group cursor-row-resize z-5 relative"
          style={{
            gridColumn: `1 / -1`,
            gridRow,
          }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-row gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
            <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
            <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
          </div>
        </div>,
      );
    }
  }

  return (
    <div
      ref={containerRef}
      className={`flex-1 min-h-0 grid p-px ${scrollable ? "overflow-auto" : ""}`}
      style={{
        gridTemplateColumns: colTemplate,
        gridTemplateRows: rowTemplate,
      }}
    >
      {gridChildren}
    </div>
  );
});

export default SessionGrid;
