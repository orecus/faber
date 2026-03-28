import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Lock, Github, Layers, ArrowUpRight, MoreVertical } from "lucide-react";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import type { Task, Session } from "../../types";
import { DEFAULT_PRIORITIES, getPriorityBadgeClass } from "../../lib/priorities";
import { TASK_STATUS_DOT_COLORS, TASK_STATUS_LABELS } from "../../lib/taskStatusColors";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { borderAccentColors } from "../ui/orecus.io/lib/color-utils";
import { Skeleton } from "../ui/skeleton";

export type TaskCardVariant = "default" | "compact" | "detailed" | "tree-node";

interface TaskCardProps {
  task: Task;
  linkedSession: Session | null;
  onClick: (taskId: string) => void;
  onStartSession?: (taskId: string) => void;
  onResearchSession?: (taskId: string) => void;
  onViewSession?: (sessionId: string) => void;
  onEpicClick?: (epicId: string) => void;
  onBreakdownEpic?: (taskId: string) => void;
  isDragOverlay?: boolean;
  variant?: TaskCardVariant;
  taskMap?: Map<string, Task>;
  allTasks?: Task[];
  dependents?: string[];
  isBlocked?: boolean;
  treeDepth?: number;
  onContextMenu?: (e: React.MouseEvent) => void;
  isEditingTitle?: boolean;
  onTitleSave?: (newTitle: string) => void;
  onTitleEditCancel?: () => void;
}

// ── Progress Ring SVG ──
function ProgressRing({ percent, isResearch }: { percent: number; isResearch: boolean }) {
  const r = 18;
  const stroke = 3;
  const size = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(100, percent) / 100) * circumference;
  const fillColor = isResearch ? "var(--warning)" : "var(--primary)";

  return (
    <div className="relative shrink-0 size-[42px]">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-accent" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          style={{ stroke: fillColor, strokeDasharray: circumference, strokeDashoffset: offset, transition: "stroke-dashoffset 0.5s" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-dim-foreground">
        {Math.round(percent)}%
      </span>
    </div>
  );
}

// ── Activity color helper ──
function getActivityColor(activity: string | undefined, isResearch: boolean): "primary" | "warning" {
  if (activity === "researching" || activity === "exploring" || (!activity && isResearch)) return "warning";
  return "primary";
}

function getActivityLabel(activity: string | undefined, isResearch: boolean): string {
  if (activity) return activity.charAt(0).toUpperCase() + activity.slice(1);
  return isResearch ? "Researching" : "Working";
}

export default React.memo(function TaskCard({
  task, linkedSession, onClick,
  onEpicClick, isDragOverlay, variant = "default", taskMap,
  allTasks, dependents = [], isBlocked = false, treeDepth = 0, onContextMenu,
  isEditingTitle = false, onTitleSave, onTitleEditCancel,
}: TaskCardProps) {
  const handleCardKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (task.task_type === "epic" && onEpicClick) onEpicClick(task.id);
      else onClick(task.id);
    }
  }, [task.id, task.task_type, onClick, onEpicClick]);
  const accentColor = useProjectAccentColor();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const priorities = useAppStore((s) =>
    activeProjectId ? (s.projectPriorities[activeProjectId] ?? DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES
  );
  const mcpData = useAppStore((s) => linkedSession ? s.mcpStatus[linkedSession.id] : undefined);

  const isSessionActive = linkedSession != null &&
    (linkedSession.status === "running" || linkedSession.status === "starting") &&
    task.status !== "done" &&
    !mcpData?.completed;

  const isEpic = task.task_type === "epic";
  const isCompact = variant === "compact";
  const isDetailed = variant === "detailed";

  const isResearch = linkedSession?.mode === "research";
  const activity = mcpData?.activity;
  const isResearchActivity = activity === "researching" || activity === "exploring" || (!activity && isResearch);
  const activityColor = getActivityColor(activity, !!isResearch);

  // Compute progress percent
  const progressPercent = useMemo(() => {
    if (!mcpData?.current_step || !mcpData?.total_steps || mcpData.total_steps === 0) return 0;
    return Math.min(100, (mcpData.current_step / mcpData.total_steps) * 100);
  }, [mcpData?.current_step, mcpData?.total_steps]);

  // Epic child progress
  const epicProgress = useMemo(() => {
    if (!isEpic || !allTasks) return null;
    const children = allTasks.filter((t) => t.epic_id === task.id);
    if (children.length === 0) return null;
    const done = children.filter((t) => t.status === "done" || t.status === "archived").length;
    const inProgress = children.filter((t) => t.status === "in-progress").length;
    return { total: children.length, done, inProgress };
  }, [isEpic, allTasks, task.id]);

  // Dependency analysis
  const depAnalysis = useMemo(() => {
    if (!taskMap) return { deps: [], metCount: 0, unmetCount: 0 };
    const deps = task.depends_on.map((depId) => {
      const dep = taskMap.get(depId);
      const isMet = dep?.status === "done" || dep?.status === "archived";
      return { id: depId, task: dep, isMet };
    });
    return {
      deps,
      metCount: deps.filter((d) => d.isMet).length,
      unmetCount: deps.filter((d) => !d.isMet).length,
    };
  }, [task.depends_on, taskMap]);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: isDragOverlay || isSessionActive || isEpic,
  });

  // Tree indent
  const treeIndentStyle = treeDepth > 0 ? { marginLeft: `${treeDepth * 12}px` } : undefined;

  // ── Inline title editing ──
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [editValue, setEditValue] = useState(task.title);

  useEffect(() => {
    if (isEditingTitle) {
      setEditValue(task.title);
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
  }, [isEditingTitle, task.title]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); onTitleSave?.(editValue); }
    else if (e.key === "Escape") { e.preventDefault(); onTitleEditCancel?.(); }
  }, [editValue, onTitleSave, onTitleEditCancel]);

  // ── Active card border class (static glow, no animate-pulse) ──
  const activeBorderClass = isSessionActive && !isDragOverlay
    ? isResearchActivity
      ? "border-warning/35 shadow-[0_0_0_1px_var(--warning)/10,0_4px_16px_rgba(0,0,0,0.2)]"
      : "border-primary/35 shadow-[0_0_0_1px_var(--primary)/10,0_4px_16px_rgba(0,0,0,0.2)]"
    : "";

  // ═══════════════════════════════════════════
  //  COMPACT variant (Done column)
  // ═══════════════════════════════════════════
  if (isCompact) {
    return (
      <div
        ref={setNodeRef}
        className={`relative group py-2 px-2.5 shrink-0 bg-card border rounded-[10px] select-none overflow-hidden transition-all duration-150 opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isDragOverlay
            ? `${borderAccentColors[accentColor]} shadow-[0_8px_24px_rgba(0,0,0,0.3)] cursor-grabbing opacity-100`
            : "border-border cursor-grab hover:opacity-70"
        } ${isDragging ? "opacity-20" : ""}`}
        style={{
          ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined),
          ...treeIndentStyle,
        }}
        {...listeners}
        {...attributes}
        tabIndex={isDragOverlay ? undefined : 0}
        role="button"
        aria-label={`${task.title} — ${task.priority}`}
        data-grid-item={task.id}
        onClick={(e) => { e.stopPropagation(); onClick(task.id); }}
        onKeyDown={handleCardKeyDown}
        onContextMenu={onContextMenu}
      >
        <div className="flex items-center gap-1.5">
          {/* Priority badge + ID */}
          <span className={`inline-flex items-center px-1 py-px text-[8px] font-bold tracking-wide rounded-[3px] ${getPriorityBadgeClass(task.priority, priorities)}`}>
            {task.priority}
          </span>
          <span className="text-[11px] text-muted-foreground truncate flex-1 line-clamp-1">
            {task.title}
          </span>
          {/* Dep dots (compact) */}
          {taskMap && task.depends_on.length > 0 && (
            <div className="flex items-center gap-[3px]" role="img" aria-label={`Dependencies: ${depAnalysis.metCount} met, ${depAnalysis.unmetCount} unmet`} title={`${depAnalysis.metCount} met, ${depAnalysis.unmetCount} unmet`}>
              {depAnalysis.deps.map((d) => (
                <span
                  key={d.id}
                  className={`size-[5px] rounded-full shrink-0 ${d.isMet ? "bg-success" : "ring-[1.5px] ring-warning bg-transparent"}`}
                />
              ))}
            </div>
          )}
          {dependents.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold text-muted-foreground bg-accent px-1 py-px rounded-[3px]">
              <ArrowUpRight className="size-2" />
              {dependents.length}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  //  DEFAULT / DETAILED / TREE-NODE variant
  // ═══════════════════════════════════════════
  const showActivityStrip = isSessionActive;

  return (
    <div
      ref={setNodeRef}
      className={`relative group p-3 shrink-0 bg-card border rounded-[10px] select-none overflow-hidden transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isEpic ? "border-l-[3px] border-l-primary" : ""
      } ${
        isDragOverlay
          ? `${borderAccentColors[accentColor]} shadow-[0_8px_24px_rgba(0,0,0,0.3)] cursor-grabbing`
          : isSessionActive
            ? `cursor-default ${activeBorderClass}`
            : isEpic
              ? "border-border cursor-pointer hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)] hover:border-border/80"
              : "border-border cursor-grab hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)] hover:border-border/80"
      } ${isDragging ? "opacity-0" : ""} ${isBlocked && !isDragOverlay ? "opacity-70" : ""}`}
      style={{
        ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined),
        ...treeIndentStyle,
      }}
      {...listeners}
      {...attributes}
      tabIndex={isDragOverlay ? undefined : 0}
      role="button"
      aria-label={`${task.title} — ${task.priority}${isBlocked ? ", blocked" : ""}${isSessionActive ? ", session active" : ""}`}
      data-grid-item={task.id}
      onClick={(e) => {
        if (isEditingTitle) return;
        e.stopPropagation();
        if (isEpic && onEpicClick) onEpicClick(task.id);
        else onClick(task.id);
      }}
      onKeyDown={handleCardKeyDown}
      onContextMenu={onContextMenu}
    >
      {/* Card layout: content left, optional ring right */}
      <div className={`flex gap-3 ${isSessionActive && progressPercent > 0 ? "items-start" : ""}`}>
        {/* Left content */}
        <div className="flex-1 min-w-0">
          {/* ── Top row: priority + ID + deps + badges ── */}
          <div className="flex items-center gap-[5px] mb-1">
            {isEpic && <Layers className="size-3 shrink-0 text-primary" />}
            <span className={`inline-flex items-center px-[5px] py-px text-[9px] font-bold tracking-[0.3px] rounded-[3px] ${getPriorityBadgeClass(task.priority, priorities)}`}>
              {task.priority}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground shrink-0">{task.id}</span>
            {task.github_issue && <Github className="size-3 shrink-0 text-muted-foreground" />}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Dependency dots */}
            {taskMap && task.depends_on.length > 0 && (
              <div className="flex items-center gap-[3px]" role="img" aria-label={`Dependencies: ${depAnalysis.metCount} met, ${depAnalysis.unmetCount} unmet`} title={`${depAnalysis.metCount} met, ${depAnalysis.unmetCount} unmet`}>
                {depAnalysis.deps.map((d) => (
                  <span
                    key={d.id}
                    className={`size-[5px] rounded-full shrink-0 ${d.isMet ? "bg-success" : "ring-[1.5px] ring-warning bg-transparent"}`}
                  />
                ))}
              </div>
            )}

            {/* Blocked badge */}
            {isBlocked && !isDragOverlay && (
              <span className="inline-flex items-center gap-[3px] px-1.5 py-px text-[8px] font-semibold text-warning bg-warning/12 rounded-[3px]">
                <Lock className="size-2" />
                blocked
              </span>
            )}

            {/* Dependents badge */}
            {dependents.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold text-muted-foreground bg-accent px-1 py-px rounded-[3px]">
                <ArrowUpRight className="size-2" />
                {dependents.length}
              </span>
            )}

            {/* Context menu button (hover only, replaces old inline action buttons) */}
            {!isDragOverlay && !isSessionActive && onContextMenu && (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  hoverEffect="scale"
                  clickEffect="scale"
                  aria-label="More actions"
                  title="More actions"
                  onClick={(e) => { e.stopPropagation(); onContextMenu(e); }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="size-3" />
                </Button>
              </div>
            )}
          </div>

          {/* ── Title ── */}
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              className="w-full text-[13px] font-medium text-foreground leading-[1.4] bg-accent/60 border border-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary/50"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              onBlur={() => onTitleSave?.(editValue)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <div className={`text-[13px] font-medium text-foreground leading-[1.4] overflow-hidden text-ellipsis ${isDetailed ? "line-clamp-3" : "line-clamp-2"}`}>
              {task.title}
            </div>
          )}

          {/* ── Labels ── */}
          {task.labels.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 overflow-hidden">
              {task.labels.slice(0, 3).map((label) => (
                <span
                  key={label}
                  className="inline-block px-1.5 py-px text-[9px] font-medium rounded-full bg-accent text-muted-foreground truncate max-w-[80px]"
                >
                  {label}
                </span>
              ))}
              {task.labels.length > 3 && (
                <span className="text-2xs text-muted-foreground shrink-0">+{task.labels.length - 3}</span>
              )}
            </div>
          )}

          {/* ── Epic progress ── */}
          {isEpic && epicProgress && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-2xs text-muted-foreground">
                  {epicProgress.done}/{epicProgress.total} subtasks done
                </span>
                <span className="text-2xs font-medium text-dim-foreground">
                  {Math.round((epicProgress.done / epicProgress.total) * 100)}%
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-accent overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${(epicProgress.done / epicProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* ── Agent row (only when no active session) ── */}
          {task.agent && !showActivityStrip && !isEpic && (
            <div className="mt-1 text-[9px] text-muted-foreground truncate flex items-center gap-1">
              <span className="size-1 rounded-full bg-muted-foreground shrink-0" />
              {task.agent}
            </div>
          )}

          {/* ── Dependency detail row (for blocked cards) ── */}
          {isBlocked && !isDragOverlay && depAnalysis.unmetCount > 0 && (
            <div className="flex flex-col gap-[3px] mt-1.5 pt-1.5 border-t border-dashed border-border/60">
              {depAnalysis.deps.filter((d) => !d.isMet).map((d) => (
                <div key={d.id} className="flex items-center gap-[5px] text-[9px] py-px">
                  <span className="text-[8px] font-semibold uppercase tracking-[0.3px] text-warning shrink-0 w-12">waits on</span>
                  <span className={`size-[5px] rounded-full shrink-0 ${d.task ? TASK_STATUS_DOT_COLORS[d.task.status] : "bg-muted-foreground/30"}`} />
                  <span className="text-dim-foreground truncate flex-1 min-w-0">{d.task?.title ?? d.id}</span>
                  {d.task && (
                    <span className={`text-[8px] px-1 py-px rounded-[2px] shrink-0 ${TASK_STATUS_DOT_COLORS[d.task.status]}/15 text-muted-foreground`}>
                      {TASK_STATUS_LABELS[d.task.status]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Progress ring (active cards only) ── */}
        {isSessionActive && progressPercent > 0 && (
          <ProgressRing percent={progressPercent} isResearch={isResearchActivity} />
        )}
      </div>

      {/* ── Activity strip (replaces old MCP footer) ── */}
      {showActivityStrip && (
        <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-border" aria-live="polite" aria-atomic="true">
          {/* Pulse dot + activity label */}
          <div className="flex items-center gap-1 shrink-0">
            <span className={`size-[5px] rounded-full animate-pulse ${activityColor === "warning" ? "bg-warning" : "bg-primary"}`} />
            <span className={`text-2xs font-medium whitespace-nowrap ${activityColor === "warning" ? "text-warning" : "text-primary"}`}>
              {mcpData?.completed
                ? "Done"
                : (mcpData?.error || mcpData?.status === "error")
                  ? "Error"
                  : (mcpData?.waiting || mcpData?.status === "waiting")
                    ? "Waiting"
                    : getActivityLabel(activity, !!isResearch)}
            </span>
          </div>

          {/* Progress bar */}
          <div className="flex-1 h-[3px] rounded-full bg-accent overflow-hidden min-w-[30px]">
            <div
              className={`h-full rounded-full transition-all duration-300 ${activityColor === "warning" ? "bg-warning" : "bg-primary"}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Step label */}
          {mcpData?.current_step != null && mcpData?.total_steps != null && mcpData.total_steps > 0 && (
            <span className="text-[9px] font-semibold text-dim-foreground whitespace-nowrap shrink-0">
              {mcpData.current_step}/{mcpData.total_steps}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

// ── Skeleton variant for loading states ──

export function TaskCardSkeleton({ variant = "default" }: { variant?: TaskCardVariant }) {
  if (variant === "compact") {
    return (
      <div className="py-2 px-2.5 bg-card border border-border rounded-[10px]">
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-5 rounded-[3px]" />
          <Skeleton className="h-3 flex-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 bg-card border border-border rounded-[10px]">
      {/* Top row: priority + ID */}
      <div className="flex items-center gap-[5px] mb-1">
        <Skeleton className="h-3.5 w-6 rounded-[3px]" />
        <Skeleton className="h-3 w-10" />
        <div className="flex-1" />
      </div>
      {/* Title */}
      <Skeleton className="h-4 w-3/4 mb-0.5" />
      <Skeleton className="h-4 w-1/2" />
      {/* Labels */}
      <div className="flex items-center gap-1 mt-1.5">
        <Skeleton className="h-3.5 w-12 rounded-full" />
        <Skeleton className="h-3.5 w-10 rounded-full" />
      </div>
    </div>
  );
}
