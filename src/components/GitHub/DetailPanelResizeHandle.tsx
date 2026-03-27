import { useCallback, useRef } from "react";

const MIN_WIDTH = 280;
const MAX_WIDTH = 600;

interface DetailPanelResizeHandleProps {
  onResize: (width: number) => void;
}

/**
 * Left-edge resize handle for GitHub detail panels.
 * Follows the same pattern as SidebarResizeHandle / RightSidebarResizeHandle.
 */
export default function DetailPanelResizeHandle({
  onResize,
}: DetailPanelResizeHandleProps) {
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      // Capture the right edge of the panel at drag start
      const panel = containerRef.current?.parentElement;
      if (!panel) return;
      const panelRect = panel.getBoundingClientRect();
      const rightEdge = panelRect.right;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const newWidth = rightEdge - ev.clientX;
        const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth));
        onResize(clamped);
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
    [onResize],
  );

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      className="group absolute top-0 -left-[3px] w-1.5 h-full cursor-col-resize z-10"
    >
      {/* Grip dots — appear on hover */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
        <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
        <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
      </div>
    </div>
  );
}
