import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Play, Search, CirclePause, CheckCircle2, Loader2, Github, AlertTriangle, Lightbulb, FlaskConical, Bug, Code, ClipboardList, Eye, MoreVertical } from "lucide-react";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import type { Task, Session } from "../../types";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { Separator } from "../ui/separator";
import { borderAccentColors, ringColors } from "../ui/orecus.io/lib/color-utils";
import PriorityBadge from "./PriorityBadge";
import DependencyBadge from "./DependencyBadge";

export type TaskCardVariant = "default" | "compact" | "detailed" | "tree-node";

interface TaskCardProps {
  task: Task;
  linkedSession: Session | null;
  onClick: (taskId: string) => void;
  onStartSession?: (taskId: string) => void;
  onResearchSession?: (taskId: string) => void;
  onViewSession?: (sessionId: string) => void;
  isDragOverlay?: boolean;
  variant?: TaskCardVariant;
  taskMap?: Map<string, Task>;
  dependents?: string[];
  isBlocked?: boolean;
  treeDepth?: number;
  onContextMenu?: (e: React.MouseEvent) => void;
  isEditingTitle?: boolean;
  onTitleSave?: (newTitle: string) => void;
  onTitleEditCancel?: () => void;
}

export default React.memo(function TaskCard({ task, linkedSession, onClick, onStartSession, onResearchSession, onViewSession, isDragOverlay, variant = "default", taskMap, dependents = [], isBlocked = false, treeDepth = 0, onContextMenu, isEditingTitle = false, onTitleSave, onTitleEditCancel }: TaskCardProps) {
  const accentColor = useProjectAccentColor();
  const mcpData = useAppStore((s) => linkedSession ? s.mcpStatus[linkedSession.id] : undefined);

  const isSessionActive = linkedSession != null &&
    (linkedSession.status === "running" || linkedSession.status === "starting") &&
    task.status !== "done" &&
    !mcpData?.completed;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: isDragOverlay || isSessionActive,
  });

  const isCompact = variant === "compact";

  const isResearch = linkedSession?.mode === "research";
  const activity = mcpData?.activity;
  // Activity-aware: treat mcpData.activity as primary, fall back to session.mode
  const isResearchActivity = activity === "researching" || activity === "exploring" || (!activity && isResearch);

  // Ring style: research/explore activity gets amber, regular tasks get accent color
  const activeRingClass = isSessionActive && !isDragOverlay
    ? `ring-1 animate-pulse ${isResearchActivity ? "ring-amber-500/70" : ringColors[accentColor]}`
    : "";

  // Compute indentation style for nested/dependent tasks (all variants)
  const treeIndentStyle = treeDepth > 0
    ? { marginLeft: `${treeDepth * 12}px` }
    : undefined;

  // ── Inline title editing ──
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [editValue, setEditValue] = useState(task.title);

  useEffect(() => {
    if (isEditingTitle) {
      setEditValue(task.title);
      // Focus after render
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
  }, [isEditingTitle, task.title]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onTitleSave?.(editValue);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onTitleEditCancel?.();
    }
  }, [editValue, onTitleSave, onTitleEditCancel]);

  // ── Compact variant (for Done column) ──
  if (isCompact) {
    return (
      <div
        ref={setNodeRef}
        className={`relative group px-2 py-1.5 shrink-0 bg-card border rounded-[var(--radius-element)] select-none overflow-hidden transition-shadow duration-150 ${
          isDragOverlay
            ? `${borderAccentColors[accentColor]} shadow-[0_8px_24px_rgba(0,0,0,0.3)] cursor-grabbing`
            : "border-border cursor-grab"
        } ${isDragging ? "opacity-30" : ""}`}
        style={{
          ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined),
          ...treeIndentStyle,
        }}
        {...listeners}
        {...attributes}
        onClick={(e) => {
          e.stopPropagation();
          onClick(task.id);
        }}
        onContextMenu={onContextMenu}
      >
        <div className="flex items-center gap-1.5">
          <div className={`size-1.5 shrink-0 rounded-full ${
            task.priority === "P0" ? "bg-destructive" : task.priority === "P1" ? "bg-warning" : "bg-muted-foreground/50"
          }`} />
          <span className="text-[11px] text-muted-foreground truncate flex-1">
            {task.title}
          </span>
          {taskMap && (task.depends_on.length > 0 || dependents.length > 0) && (
            <DependencyBadge
              task={task}
              taskMap={taskMap}
              dependents={dependents}
              isBlocked={false}
              onTaskNavigate={onClick}
            />
          )}
        </div>
      </div>
    );
  }

  // ── Default / Detailed / Tree-node variant ──
  const isDetailed = variant === "detailed";

  // Show MCP footer only when there's an active session (in-progress work)
  const showMcpFooter = isSessionActive;

  return (
    <div
      ref={setNodeRef}
      className={`relative group px-2.5 py-2 shrink-0 bg-card border rounded-[var(--radius-element)] select-none overflow-hidden transition-shadow duration-150 ${
        isDragOverlay
          ? `${borderAccentColors[accentColor]} shadow-[0_8px_24px_rgba(0,0,0,0.3)] cursor-grabbing`
          : isSessionActive ? "border-border cursor-default" : "border-border cursor-grab"
      } ${isDragging ? "opacity-30" : ""} ${activeRingClass} ${isBlocked && !isDragOverlay ? "opacity-75" : ""}`}
      style={{
        ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined),
        ...treeIndentStyle,
      }}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        if (isEditingTitle) return;
        e.stopPropagation();
        onClick(task.id);
      }}
      onContextMenu={onContextMenu}
    >
      {/* Top row: id + priority + deps + actions */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">{task.id}</span>
        <PriorityBadge priority={task.priority} />
        {task.github_issue && (
          <Github className="size-3 shrink-0 text-muted-foreground" />
        )}
        {taskMap && (task.depends_on.length > 0 || dependents.length > 0) && (
          <DependencyBadge
            task={task}
            taskMap={taskMap}
            dependents={dependents}
            isBlocked={isBlocked}
            onTaskNavigate={onClick}
          />
        )}
        {/* Spacer */}
        <div className="flex-1" />
        {/* Action buttons — inline, visible on hover */}
        {!isDragOverlay && !isSessionActive && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {task.status === "in-review" && linkedSession && onViewSession && (
              <Button
                variant="ghost"
                size="icon-xs"
                hoverEffect="scale"
                clickEffect="scale"
                title="View session"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewSession(linkedSession.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Search className="size-3" />
              </Button>
            )}
            {(task.status === "backlog" || task.status === "ready") && onResearchSession && (
              <Button
                variant="ghost"
                size="icon-xs"
                hoverEffect="scale"
                clickEffect="scale"
                title="Research task"
                onClick={(e) => {
                  e.stopPropagation();
                  onResearchSession(task.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Lightbulb className="size-3 text-warning" />
              </Button>
            )}
            {task.status !== "in-review" && task.status !== "done" && onStartSession && (
              <Button
                variant="ghost"
                size="icon-xs"
                hoverEffect="scale"
                clickEffect="scale"
                title="Start task"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartSession(task.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Play className="size-3" />
              </Button>
            )}
            {onContextMenu && (
              <Button
                variant="ghost"
                size="icon-xs"
                hoverEffect="scale"
                clickEffect="scale"
                title="More actions"
                onClick={(e) => {
                  e.stopPropagation();
                  onContextMenu(e);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <MoreVertical className="size-3" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Title — inline editable */}
      {isEditingTitle ? (
        <input
          ref={titleInputRef}
          className="w-full text-xs font-medium text-foreground leading-snug bg-accent/60 border border-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary/50"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleTitleKeyDown}
          onBlur={() => onTitleSave?.(editValue)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className={`text-xs font-medium text-foreground leading-snug overflow-hidden text-ellipsis ${isDetailed ? "line-clamp-3" : "line-clamp-2"}`}>
          {task.title}
        </div>
      )}

      {/* Labels */}
      {task.labels.length > 0 && (
        <div className="flex items-center gap-1 mt-1 overflow-hidden">
          {task.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className="inline-block px-1.5 py-px text-[9px] font-medium rounded-full bg-accent text-muted-foreground truncate max-w-[80px]"
            >
              {label}
            </span>
          ))}
          {task.labels.length > 3 && (
            <span className="text-[9px] text-muted-foreground shrink-0">
              +{task.labels.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Agent row */}
      {task.agent && !showMcpFooter && (
        <div className="mt-1 text-[10px] text-muted-foreground truncate">
          {task.agent}
        </div>
      )}

      {/* Detailed variant: progress bar */}
      {isDetailed && isSessionActive && mcpData?.current_step != null && mcpData?.total_steps != null && mcpData.total_steps > 0 && (
        <div className="mt-1.5">
          <div className="h-1 w-full rounded-full bg-accent overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.min(100, (mcpData.current_step / mcpData.total_steps) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* MCP status footer — only shown when session is active */}
      {showMcpFooter && (
        <>
          <Separator className="mt-1.5" />
          <div className="flex items-center gap-1.5 pt-[5px] pb-px min-w-0">
            {mcpData ? (
              <>
                {mcpData.completed ? (
                  <CheckCircle2 className="size-3 shrink-0 text-success" />
                ) : (mcpData.error || mcpData.status === "error") ? (
                  <AlertTriangle className="size-3 shrink-0 text-destructive" />
                ) : (mcpData.waiting || mcpData.status === "waiting") ? (
                  <CirclePause className="size-3 shrink-0 text-warning" />
                ) : activity === "researching" || activity === "exploring" ? (
                  <Lightbulb className="size-3 shrink-0 text-warning animate-pulse" />
                ) : activity === "planning" ? (
                  <ClipboardList className="size-3 shrink-0 text-primary animate-pulse" />
                ) : activity === "testing" ? (
                  <FlaskConical className="size-3 shrink-0 text-primary animate-spin" />
                ) : activity === "debugging" ? (
                  <Bug className="size-3 shrink-0 text-warning animate-spin" />
                ) : activity === "reviewing" ? (
                  <Eye className="size-3 shrink-0 text-primary animate-spin" />
                ) : activity === "coding" ? (
                  <Code className="size-3 shrink-0 text-primary animate-spin" />
                ) : isResearch ? (
                  <Lightbulb className="size-3 shrink-0 text-warning animate-pulse" />
                ) : (
                  <Loader2 className="size-3 shrink-0 text-primary animate-spin" />
                )}
                <span className={`text-[10px] truncate ${(mcpData.error || mcpData.status === "error") ? "text-destructive" : "text-muted-foreground"}`}>
                  {(mcpData.error || mcpData.status === "error")
                    ? mcpData.error_message || mcpData.message || "Error"
                    : (mcpData.waiting || mcpData.status === "waiting")
                      ? "Waiting for input"
                      : mcpData.completed
                        ? "Done"
                        : mcpData.current_step != null && mcpData.total_steps != null
                          ? `Step ${mcpData.current_step}/${mcpData.total_steps}`
                          : mcpData.message || (activity ? activity.charAt(0).toUpperCase() + activity.slice(1) : isResearch ? "Researching" : "Working")}
                </span>
              </>
            ) : isResearchActivity ? (
              <>
                <Lightbulb className="size-3 shrink-0 text-warning animate-pulse" />
                <span className="text-[10px] truncate text-muted-foreground">Researching</span>
              </>
            ) : (
              <>
                <Loader2 className="size-3 shrink-0 text-primary animate-spin" />
                <span className="text-[10px] truncate text-muted-foreground">Starting</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
});
