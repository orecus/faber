import { useCallback, useRef, useState } from "react";

/**
 * Reusable 2D grid keyboard navigation hook.
 *
 * Takes a grid of item IDs organized by columns (or rows) and provides:
 * - Arrow key navigation (Left/Right between columns, Up/Down within a column)
 * - Home/End to jump to first/last item
 * - Enter to activate the focused item
 * - An `activeId` state and a keydown handler to attach to the container
 *
 * The grid is column-major: `grid[colIndex][rowIndex] = itemId`.
 */

export interface GridNavOptions {
  /** Column-major grid: grid[col][row] = itemId */
  grid: string[][];
  /** Called when the user presses Enter on the active item */
  onActivate?: (id: string) => void;
  /** Called when a key shortcut is pressed on the active item (key, id) */
  onAction?: (key: string, id: string) => void;
  /** Keys that trigger onAction (e.g. ["l", "e", "m"]) */
  actionKeys?: string[];
}

export interface GridNavResult {
  /** Currently focused item ID, or null */
  activeId: string | null;
  /** Set the active ID programmatically */
  setActiveId: (id: string | null) => void;
  /** Attach this to onKeyDown on the grid container */
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export function useGridNavigation({
  grid,
  onActivate,
  onAction,
  actionKeys = [],
}: GridNavOptions): GridNavResult {
  const [activeId, setActiveId] = useState<string | null>(null);
  const gridRef = useRef(grid);
  gridRef.current = grid;

  /** Find the (col, row) position of an item in the grid */
  const findPosition = useCallback(
    (id: string): [number, number] | null => {
      const g = gridRef.current;
      for (let c = 0; c < g.length; c++) {
        const r = g[c].indexOf(id);
        if (r !== -1) return [c, r];
      }
      return null;
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Skip when focus is inside an input
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) return;

      const g = gridRef.current;
      if (g.length === 0) return;

      const flatItems = g.flat();
      if (flatItems.length === 0) return;

      // If no item is active, activate the first one on any arrow key
      if (!activeId) {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          setActiveId(flatItems[0]);
        }
        return;
      }

      const pos = findPosition(activeId);
      if (!pos) return;
      const [col, row] = pos;

      let nextId: string | null = null;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const column = g[col];
          if (row < column.length - 1) {
            nextId = column[row + 1];
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (row > 0) {
            nextId = g[col][row - 1];
          }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          // Move to next column, same row (or closest)
          if (col < g.length - 1) {
            const nextCol = g[col + 1];
            if (nextCol.length > 0) {
              nextId = nextCol[Math.min(row, nextCol.length - 1)];
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (col > 0) {
            const prevCol = g[col - 1];
            if (prevCol.length > 0) {
              nextId = prevCol[Math.min(row, prevCol.length - 1)];
            }
          }
          break;
        }
        case "Home": {
          e.preventDefault();
          nextId = flatItems[0];
          break;
        }
        case "End": {
          e.preventDefault();
          nextId = flatItems[flatItems.length - 1];
          break;
        }
        case "Enter": {
          e.preventDefault();
          onActivate?.(activeId);
          return;
        }
        case "Escape": {
          e.preventDefault();
          setActiveId(null);
          return;
        }
        default: {
          // Check for action keys (case-insensitive)
          const lower = e.key.toLowerCase();
          if (actionKeys.includes(lower) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            onAction?.(lower, activeId);
            return;
          }
          return;
        }
      }

      if (nextId) {
        setActiveId(nextId);
        // Scroll the element into view
        const el = document.querySelector(`[data-grid-item="${nextId}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    },
    [activeId, findPosition, onActivate, onAction, actionKeys],
  );

  return { activeId, setActiveId, handleKeyDown };
}
