import { useCallback, useRef } from "react";
import { useAppStore } from "../../store/appStore";

const MIN_WIDTH = 210;
const MAX_WIDTH = 500;

export default function SidebarResizeHandle() {
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (sidebarCollapsed) return;
      e.preventDefault();
      dragging.current = true;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX));
        setSidebarWidth(clamped);
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
    [setSidebarWidth, sidebarCollapsed],
  );

  if (sidebarCollapsed) return null;

  return (
    <div
      onMouseDown={onMouseDown}
      className="group absolute top-0 -right-[3px] w-1.5 h-full cursor-col-resize z-10"
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
