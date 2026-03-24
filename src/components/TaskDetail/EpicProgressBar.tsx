import { Layers } from "lucide-react";
import { useMemo } from "react";

import type { Task, TaskStatus } from "../../types";

interface EpicProgressBarProps {
  childTasks: Task[];
}

const DONE_STATUSES: TaskStatus[] = ["done", "archived"];

export default function EpicProgressBar({ childTasks }: EpicProgressBarProps) {
  const { done, total, percent } = useMemo(() => {
    const t = childTasks.length;
    const d = childTasks.filter((c) => DONE_STATUSES.includes(c.status)).length;
    return { done: d, total: t, percent: t > 0 ? Math.round((d / t) * 100) : 0 };
  }, [childTasks]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Layers size={14} className="shrink-0" />
        <span className="text-xs font-medium">Epic</span>
      </div>

      {total > 0 ? (
        <>
          {/* Progress bar */}
          <div className="flex-1 h-1.5 rounded-full bg-border/60 overflow-hidden max-w-[200px]">
            <div
              className="h-full rounded-full bg-success transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {done}/{total}
            <span className="ml-1 text-dim-foreground">({percent}%)</span>
          </span>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">No child tasks</span>
      )}
    </div>
  );
}
