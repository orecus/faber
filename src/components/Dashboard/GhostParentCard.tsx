import { memo } from "react";
import { GitBranch } from "lucide-react";
import type { Task, TaskStatus } from "../../types";

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  "in-progress": "In Progress",
  "in-review": "In Review",
  done: "Done",
  archived: "Archived",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: "bg-muted-foreground/30",
  ready: "bg-blue-500/60",
  "in-progress": "bg-amber-500/60",
  "in-review": "bg-purple-500/60",
  done: "bg-success/60",
  archived: "bg-muted-foreground/20",
};

interface GhostParentCardProps {
  parentTask: Task;
  onClick?: (taskId: string) => void;
}

/**
 * A minimal, non-draggable card that represents a parent task living
 * in another Kanban column. Dependent tasks render below it, indented,
 * to make the cross-column dependency visually clear.
 */
const GhostParentCard = memo(function GhostParentCard({
  parentTask,
  onClick,
}: GhostParentCardProps) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-element)] border border-dashed border-border/60 bg-card/30 cursor-pointer hover:bg-card/50 transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(parentTask.id);
      }}
      title={`Depends on ${parentTask.id} (${STATUS_LABELS[parentTask.status]})`}
    >
      <GitBranch className="size-3 shrink-0 text-muted-foreground/60" />
      <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
        {parentTask.id}
      </span>
      <span className="text-[10px] text-muted-foreground/60 truncate flex-1">
        {parentTask.title}
      </span>
      <span
        className={`text-[9px] px-1 rounded-sm text-white/80 shrink-0 ${STATUS_COLORS[parentTask.status]}`}
      >
        {STATUS_LABELS[parentTask.status]}
      </span>
    </div>
  );
});

export default GhostParentCard;
