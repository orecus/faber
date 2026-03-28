import { useCallback, useRef } from "react";
import { useAppStore } from "../../store/appStore";

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

export default function RightSidebarResizeHandle() {
  const setRightSidebarWidth = useAppStore((s) => s.setRightSidebarWidth);
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const windowWidth = window.innerWidth;
        const newWidth = windowWidth - ev.clientX;
        const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth));
        setRightSidebarWidth(clamped);
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
    [setRightSidebarWidth],
  );

  return (
    <div
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
