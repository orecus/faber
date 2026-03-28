import { memo } from "react";
import { ExternalLink } from "lucide-react";
import type { Task } from "../../types";
import { TASK_STATUS_DOT_COLORS, TASK_STATUS_LABELS } from "../../lib/taskStatusColors";

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
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-dashed border-border/40 bg-card/30 cursor-pointer hover:bg-card/50 transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(parentTask.id);
      }}
      title={`Depends on ${parentTask.id} (${TASK_STATUS_LABELS[parentTask.status]})`}
    >
      <div className="size-4 rounded-full flex items-center justify-center opacity-50 bg-accent shrink-0">
        <ExternalLink className="size-2.5 text-muted-foreground" />
      </div>
      <span className="text-[9px] font-mono text-muted-foreground/60 shrink-0">
        {parentTask.id}
      </span>
      <span className="text-2xs text-muted-foreground/60 truncate flex-1">
        {parentTask.title}
      </span>
      <span
        className={`text-[8px] font-semibold px-1.5 py-px rounded-[3px] shrink-0 ${TASK_STATUS_DOT_COLORS[parentTask.status]}/15 text-muted-foreground`}
      >
        {TASK_STATUS_LABELS[parentTask.status]}
      </span>
    </div>
  );
});

export default GhostParentCard;
