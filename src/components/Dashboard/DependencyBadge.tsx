import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, Lock, Check, ChevronRight } from "lucide-react";
import type { Task, TaskStatus } from "../../types";

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: "bg-muted-foreground/60",
  ready: "bg-blue-500",
  "in-progress": "bg-amber-500",
  "in-review": "bg-purple-500",
  done: "bg-emerald-500",
  archived: "bg-muted-foreground/30",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  "in-progress": "In Progress",
  "in-review": "In Review",
  done: "Done",
  archived: "Archived",
};

interface DependencyBadgeProps {
  task: Task;
  taskMap: Map<string, Task>;
  dependents: string[];
  isBlocked: boolean;
  onTaskNavigate?: (taskId: string) => void;
}

export default React.memo(function DependencyBadge({
  task,
  taskMap,
  dependents,
  isBlocked,
  onTaskNavigate,
}: DependencyBadgeProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const totalDeps = task.depends_on.length;
  const totalDependents = dependents.length;
  const totalLinks = totalDeps + totalDependents;

  // Compute popover position when opening
  useEffect(() => {
    if (!open || !triggerRef.current) return;

    const updatePosition = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = 208; // w-52 = 13rem = 208px

      // Position below the trigger, right-aligned
      let left = rect.right - popoverWidth;
      // Clamp to viewport
      if (left < 8) left = 8;
      if (left + popoverWidth > window.innerWidth - 8) {
        left = window.innerWidth - 8 - popoverWidth;
      }

      let top = rect.bottom + 4;
      // If it would overflow below, show above instead
      const estimatedHeight = (totalDeps + totalDependents) * 28 + (totalDeps > 0 ? 24 : 0) + (totalDependents > 0 ? 24 : 0);
      if (top + estimatedHeight > window.innerHeight - 8) {
        top = rect.top - estimatedHeight - 4;
        if (top < 8) top = 8;
      }

      setPopoverPos({ top, left });
    };

    updatePosition();

    // Reposition on scroll/resize
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, totalDeps, totalDependents]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setOpen((v) => !v);
    },
    [],
  );

  const handleTaskClick = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      e.stopPropagation();
      setOpen(false);
      onTaskNavigate?.(taskId);
    },
    [onTaskNavigate],
  );

  if (totalLinks === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleClick}
        onPointerDown={(e) => e.stopPropagation()}
        className={`flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-medium transition-colors cursor-pointer ${
          isBlocked
            ? "text-warning bg-warning/10 hover:bg-warning/20"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
        title={
          isBlocked
            ? `Blocked — ${totalDeps} dependencies unmet`
            : `${totalDeps} deps, ${totalDependents} dependents`
        }
      >
        {isBlocked ? (
          <Lock className="size-2.5" />
        ) : (
          <Link className="size-2.5" />
        )}
        <span>{totalLinks}</span>
      </button>

      {open &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[100] w-52 bg-card border border-border rounded-[var(--radius-element)] shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ top: popoverPos.top, left: popoverPos.left }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Dependencies section */}
            {totalDeps > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-accent/50">
                  Depends on
                </div>
                {task.depends_on.map((depId) => {
                  const dep = taskMap.get(depId);
                  const isDone = dep?.status === "done" || dep?.status === "archived";
                  return (
                    <button
                      key={depId}
                      onClick={(e) => handleTaskClick(e, depId)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-accent/60 transition-colors cursor-pointer"
                    >
                      {isDone ? (
                        <Check className="size-3 shrink-0 text-success" />
                      ) : (
                        <div className={`size-2 shrink-0 rounded-full ${dep ? STATUS_COLORS[dep.status] : "bg-muted-foreground/30"}`} />
                      )}
                      <span className="text-[11px] text-foreground truncate flex-1">
                        {dep?.title ?? depId}
                      </span>
                      {dep && (
                        <span className="text-[9px] text-muted-foreground shrink-0">
                          {STATUS_LABELS[dep.status]}
                        </span>
                      )}
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            )}

            {/* Dependents section */}
            {totalDependents > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-accent/50 border-t border-border/60">
                  Depended by
                </div>
                {dependents.map((depId) => {
                  const dep = taskMap.get(depId);
                  return (
                    <button
                      key={depId}
                      onClick={(e) => handleTaskClick(e, depId)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-accent/60 transition-colors cursor-pointer"
                    >
                      <div className={`size-2 shrink-0 rounded-full ${dep ? STATUS_COLORS[dep.status] : "bg-muted-foreground/30"}`} />
                      <span className="text-[11px] text-foreground truncate flex-1">
                        {dep?.title ?? depId}
                      </span>
                      {dep && (
                        <span className="text-[9px] text-muted-foreground shrink-0">
                          {STATUS_LABELS[dep.status]}
                        </span>
                      )}
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
});
