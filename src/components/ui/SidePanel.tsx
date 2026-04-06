import { useCallback, useRef } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { cn } from "../../lib/utils";
import { glassStyles } from "./orecus.io/lib/color-utils";

// ============================================================================
// Width tokens — semantic tiers for side panels
// ============================================================================

/** Narrow (224px) — navigation/tree panels */
const WIDTH_NARROW = 224;
/** Medium (260px) — metadata panels */
const WIDTH_MEDIUM = 260;
/** Wide (350px) — detail panels, resizable range 280–600 */
const WIDTH_WIDE = 350;

export const sidePanelWidths = {
  narrow: WIDTH_NARROW,
  medium: WIDTH_MEDIUM,
  wide: WIDTH_WIDE,
} as const;

export type SidePanelWidth = keyof typeof sidePanelWidths;

// ============================================================================
// Resize handle (generalized from DetailPanelResizeHandle)
// ============================================================================

const RESIZE_MIN = 280;
const RESIZE_MAX = 600;

interface ResizeHandleProps {
  side: "left" | "right";
  onResize: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
}

function ResizeHandle({
  side,
  onResize,
  minWidth = RESIZE_MIN,
  maxWidth = RESIZE_MAX,
}: ResizeHandleProps) {
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const panel = containerRef.current?.parentElement;
      if (!panel) return;
      const panelRect = panel.getBoundingClientRect();

      // For a right-side panel, we resize from the left edge (drag left = wider)
      // For a left-side panel, we resize from the right edge (drag right = wider)
      const fixedEdge =
        side === "right" ? panelRect.right : panelRect.left;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const newWidth =
          side === "right"
            ? fixedEdge - ev.clientX
            : ev.clientX - fixedEdge;
        const clamped = Math.min(maxWidth, Math.max(minWidth, newWidth));
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
    [onResize, side, minWidth, maxWidth],
  );

  const positionClasses =
    side === "right"
      ? "left-0 -translate-x-1/2"
      : "right-0 translate-x-1/2";

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 50 : 10;
      const panel = containerRef.current?.parentElement;
      if (!panel) return;
      const currentWidth = panel.getBoundingClientRect().width;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const delta = side === "right"
          ? (e.key === "ArrowLeft" ? step : -step)
          : (e.key === "ArrowRight" ? step : -step);
        const newWidth = Math.min(maxWidth, Math.max(minWidth, currentWidth + delta));
        onResize(newWidth);
      }
    },
    [onResize, side, minWidth, maxWidth],
  );

  return (
    <div
      ref={containerRef}
      role="separator"
      aria-label="Resize panel"
      aria-orientation="vertical"
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={handleKeyDown}
      className={cn(
        "group absolute top-0 w-1.5 h-full cursor-col-resize z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        positionClasses,
      )}
    >
      {/* Grip dots — appear on hover */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150">
        <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
        <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
        <div className="w-0.5 h-0.5 rounded-full bg-muted-foreground/60" />
      </div>
    </div>
  );
}

// ============================================================================
// SidePanel
// ============================================================================

interface SidePanelProps {
  /** Which side the panel sits on — controls border direction */
  side: "left" | "right";
  /** Width as a token name or pixel number. Default: "medium" */
  width?: SidePanelWidth | number;
  /** Enable drag-to-resize. Requires controlled width via onResize. */
  resizable?: boolean;
  /** Current width in pixels (for resizable panels) */
  resizeWidth?: number;
  /** Resize callback — receives new width in px */
  onResize?: (width: number) => void;
  /** Min width when resizable (default 280) */
  minWidth?: number;
  /** Max width when resizable (default 600) */
  maxWidth?: number;
  /** Max width as CSS class (e.g. "max-w-[40%]") */
  maxWidthClass?: string;
  /** Extra classes on the root element */
  className?: string;
  children: React.ReactNode;
}

export default function SidePanel({
  side,
  width = "medium",
  resizable = false,
  resizeWidth,
  onResize,
  minWidth,
  maxWidth,
  maxWidthClass,
  className,
  children,
}: SidePanelProps) {
  const { isGlass } = useTheme();

  const resolvedWidth =
    typeof width === "number" ? width : sidePanelWidths[width];

  const borderClass = side === "right" ? "border-l" : "border-r";

  return (
    <div
      role="complementary"
      aria-label={`${side === "right" ? "Right" : "Left"} panel`}
      className={cn(
        "relative shrink-0 flex flex-col overflow-hidden",
        borderClass,
        "border-border/40",
        glassStyles[isGlass ? "normal" : "solid"],
        maxWidthClass,
        className,
      )}
      style={{ width: resizable && resizeWidth != null ? resizeWidth : resolvedWidth }}
    >
      {resizable && onResize && (
        <ResizeHandle
          side={side}
          onResize={onResize}
          minWidth={minWidth}
          maxWidth={maxWidth}
        />
      )}
      {children}
    </div>
  );
}

// ============================================================================
// SidePanel.Header
// ============================================================================

interface SidePanelHeaderProps {
  className?: string;
  children: React.ReactNode;
}

function SidePanelHeader({ className, children }: SidePanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 border-b border-border/40 shrink-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ============================================================================
// SidePanel.Content
// ============================================================================

interface SidePanelContentProps {
  className?: string;
  children: React.ReactNode;
}

function SidePanelContent({ className, children }: SidePanelContentProps) {
  return (
    <div className={cn("flex-1 overflow-y-auto", className)}>
      {children}
    </div>
  );
}

// ============================================================================
// SidePanel.Footer
// ============================================================================

interface SidePanelFooterProps {
  className?: string;
  children: React.ReactNode;
}

function SidePanelFooter({ className, children }: SidePanelFooterProps) {
  return (
    <div
      className={cn(
        "border-t border-border/40 px-3 py-2 shrink-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ============================================================================
// Compound component exports
// ============================================================================

SidePanel.Header = SidePanelHeader;
SidePanel.Content = SidePanelContent;
SidePanel.Footer = SidePanelFooter;
