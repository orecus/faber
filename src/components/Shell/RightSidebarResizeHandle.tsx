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
      style={{
        position: "absolute",
        top: 0,
        left: -3,
        width: 6,
        height: "100%",
        cursor: "col-resize",
        zIndex: 10,
      }}
    />
  );
}
