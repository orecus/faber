import { memo, useMemo } from "react";
import { Archive, Kanban, ListChecks, ListTree, Plus } from "lucide-react";

import { Button } from "../ui/orecus.io/components/enhanced-button";

import type { Task } from "../../types";
import type { ThemeColor } from "../ui/orecus.io/lib/color-utils";

export type DashboardMode = "board" | "graph";

interface SummaryHeaderProps {
  tasks: Task[];
  archivedCount?: number;
  showArchived?: boolean;
  onToggleArchived?: () => void;
  onNewTask?: () => void;
  onContinuousMode?: () => void;
  continuousModeEnabled?: boolean;
  accentColor?: ThemeColor;
  dashboardMode?: DashboardMode;
  onDashboardModeChange?: (mode: DashboardMode) => void;
  hasDependencies?: boolean;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">
        {value}
      </span>
      {label}
    </span>
  );
}

const SummaryHeader = memo(function SummaryHeader({
  tasks,
  archivedCount = 0,
  showArchived = false,
  onToggleArchived,
  onNewTask,
  onContinuousMode,
  continuousModeEnabled = false,
  accentColor = "blue",
  dashboardMode = "board",
  onDashboardModeChange,
  hasDependencies = false,
}: SummaryHeaderProps) {
  const stats = useMemo(() => {
    const inProgressTasks = tasks.filter((t) => t.status === "in-progress");
    const doneTasks = tasks.filter((t) => t.status === "done");
    const readyTasks = tasks.filter((t) => t.status === "ready");
    const linkedIssues = tasks.filter((t) => t.github_issue).length;

    // A task is blocked if it has dependencies and at least one dependency is not done
    const taskStatusMap = new Map(tasks.map((t) => [t.id, t.status]));
    const blockedCount = tasks.filter(
      (t) =>
        t.status !== "done" &&
        t.status !== "archived" &&
        t.depends_on.length > 0 &&
        t.depends_on.some((depId) => {
          const depStatus = taskStatusMap.get(depId);
          return depStatus !== "done";
        }),
    ).length;

    const epicCount = tasks.filter((t) => t.task_type === "epic").length;

    return {
      total: tasks.length,
      active: inProgressTasks.length,
      done: doneTasks.length,
      ready: readyTasks.length,
      blocked: blockedCount,
      linkedIssues,
      epics: epicCount,
    };
  }, [tasks]);

  return (
    <>
      {/* Stats */}
      <span className="text-sm font-medium mr-1 text-foreground">
        Dashboard
      </span>

      <div className="flex items-center gap-3">
        <Stat label="tasks" value={stats.total} />
        <span className="text-border">·</span>
        <Stat label="active" value={stats.active} />
        <span className="text-border">·</span>
        <Stat label="ready" value={stats.ready} />
        <span className="text-border">·</span>
        <Stat label="done" value={stats.done} />
        {stats.epics > 0 && (
          <>
            <span className="text-border">·</span>
            <Stat label="epics" value={stats.epics} />
          </>
        )}
        {stats.blocked > 0 && (
          <>
            <span className="text-border">·</span>
            <Stat label="blocked" value={stats.blocked} />
          </>
        )}
        {stats.linkedIssues > 0 && (
          <>
            <span className="text-border">·</span>
            <Stat label="github issues" value={stats.linkedIssues} />
          </>
        )}
        {showArchived && archivedCount > 0 && (
          <>
            <span className="text-border">·</span>
            <Stat label="archived" value={archivedCount} />
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Archive toggle */}
      {archivedCount > 0 && onToggleArchived && (
        <button
          onClick={onToggleArchived}
          className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-[var(--radius-element)] border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            showArchived
              ? "bg-accent text-foreground border-border"
              : "text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/50"
          }`}
          title={showArchived ? "Hide archived tasks" : "Show archived tasks"}
        >
          <Archive className="size-3" />
          Archive
          <span className="text-2xs tabular-nums opacity-70">{archivedCount}</span>
        </button>
      )}

      {/* View toggle — Board / Graph */}
      {hasDependencies && onDashboardModeChange && (
        <div className="flex items-center rounded-[var(--radius-element)] border border-border overflow-hidden">
          <button
            onClick={() => onDashboardModeChange("board")}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              dashboardMode === "board"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
            title="Kanban board view"
          >
            <Kanban className="size-3" />
            Board
          </button>
          <div className="w-px h-4 bg-border" />
          <button
            onClick={() => onDashboardModeChange("graph")}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              dashboardMode === "graph"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
            title="Dependency tree view"
          >
            <ListTree className="size-3" />
            Tree
          </button>
        </div>
      )}

      {/* Actions */}
      {onContinuousMode && (
        <span
          title={
            !continuousModeEnabled
              ? "Requires 2+ tasks in 'ready' status"
              : undefined
          }
        >
          <Button
            variant="outline"
            size="xs"
            disabled={!continuousModeEnabled}
            onClick={onContinuousMode}
            leftIcon={<ListChecks className="size-3" />}
            hoverEffect="scale"
            clickEffect="scale"
          >
            Continuous
          </Button>
        </span>
      )}
      {onNewTask && (
        <Button
          variant="color"
          color={accentColor}
          size="xs"
          onClick={onNewTask}
          leftIcon={<Plus className="size-3" />}
          hoverEffect="scale-glow"
          clickEffect="scale"
          title="Create new task"
        >
          New Task
        </Button>
      )}
    </>
  );
});

export default SummaryHeader;
