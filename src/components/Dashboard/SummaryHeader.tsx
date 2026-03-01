import { memo, useMemo } from "react";
import { Kanban, ListChecks, ListTree, Plus } from "lucide-react";

import { Button } from "../ui/orecus.io/components/enhanced-button";

import type { Session, Task } from "../../types";
import type { ThemeColor } from "../ui/orecus.io/lib/color-utils";

export type DashboardMode = "board" | "graph";

interface SummaryHeaderProps {
  tasks: Task[];
  sessions: Session[];
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
  sessions,
  onNewTask,
  onContinuousMode,
  continuousModeEnabled = false,
  accentColor = "blue",
  dashboardMode = "board",
  onDashboardModeChange,
  hasDependencies = false,
}: SummaryHeaderProps) {
  const stats = useMemo(() => {
    const activeSessions = sessions.filter(
      (s) => s.status === "running" || s.status === "starting",
    );
    const inProgressTasks = tasks.filter((t) => t.status === "in-progress");
    const doneTasks = tasks.filter((t) => t.status === "done");
    const linkedIssues = tasks.filter((t) => t.github_issue).length;
    return {
      total: tasks.length,
      active: inProgressTasks.length,
      done: doneTasks.length,
      agents: activeSessions.length,
      linkedIssues,
    };
  }, [tasks, sessions]);

  return (
    <>
      {/* Stats */}
      <span className="text-[13px] font-medium mr-1 text-foreground">
        Dashboard
      </span>

      <div className="flex items-center gap-3">
        <Stat label="tasks" value={stats.total} />
        <span className="text-border">·</span>
        <Stat label="active" value={stats.active} />
        <span className="text-border">·</span>
        <Stat label="done" value={stats.done} />
        <span className="text-border">·</span>
        <Stat label="agents" value={stats.agents} />
        {stats.linkedIssues > 0 && (
          <>
            <span className="text-border">·</span>
            <Stat label="github issues" value={stats.linkedIssues} />
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* View toggle — Board / Graph */}
      {hasDependencies && onDashboardModeChange && (
        <div className="flex items-center rounded-[var(--radius-element)] border border-border overflow-hidden">
          <button
            onClick={() => onDashboardModeChange("board")}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
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
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
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
            size="sm"
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
          size="sm"
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
