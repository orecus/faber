import { useCallback, useRef } from "react";
import { useAppStore } from "../../store/appStore";

const MIN_WIDTH = 180;
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
      style={{
        position: "absolute",
        top: 0,
        right: -3,
        width: 6,
        height: "100%",
        cursor: "col-resize",
        zIndex: 10,
      }}
    />
  );
}
