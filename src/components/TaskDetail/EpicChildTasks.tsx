import { Layers, Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { useAppStore } from "../../store/appStore";
import type { Task, TaskStatus } from "../../types";
import { DEFAULT_PRIORITIES, getPriorityCssVar } from "../../lib/priorities";
import { Badge } from "../ui/badge";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";
import CreateTaskDialog from "./CreateTaskDialog";

interface EpicChildTasksProps {
  epicId: string;
  childTasks: Task[];
  onNavigateToTask: (taskId: string) => void;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: "var(--muted-foreground)",
  ready: "var(--primary)",
  "in-progress": "var(--warning)",
  "in-review": "var(--primary)",
  done: "var(--success)",
  archived: "var(--muted-foreground)",
};


export default function EpicChildTasks({
  epicId,
  childTasks,
  onNavigateToTask,
}: EpicChildTasksProps) {
  const { isGlass } = useTheme();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const priorities = useAppStore((s) =>
    activeProjectId ? (s.projectPriorities[activeProjectId] ?? DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES
  );
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleCreated = useCallback(() => {
    setShowCreateDialog(false);
  }, []);

  return (
    <div
      className={`flex flex-col rounded-lg ring-1 ring-border/40 p-3 ${glassStyles[isGlass ? "normal" : "solid"]}`}
    >
      {/* Section header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Layers size={12} className="text-muted-foreground" />
          Tasks in this Epic
          {childTasks.length > 0 && (
            <span className="text-muted-foreground font-normal">
              ({childTasks.length})
            </span>
          )}
        </h3>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setShowCreateDialog(true)}
          title="Add task to epic"
          hoverEffect="scale"
          clickEffect="scale"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      {/* Task list or empty state */}
      {childTasks.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {childTasks.map((task) => (
            <button
              key={task.id}
              onClick={() => onNavigateToTask(task.id)}
              className="cursor-pointer flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent group/child"
            >
              {/* Status dot */}
              <span
                className="inline-block size-2 rounded-full shrink-0"
                style={{ background: STATUS_COLORS[task.status] }}
              />
              {/* Task ID */}
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {task.id}
              </span>
              {/* Title */}
              <span className="flex-1 truncate text-foreground/80 group-hover/child:text-foreground">
                {task.title}
              </span>
              {/* Priority badge */}
              <Badge
                variant="outline"
                className="text-[9px] px-1 py-0 leading-tight shrink-0"
                style={{
                  color: getPriorityCssVar(task.priority, priorities),
                  borderColor: `color-mix(in oklch, ${getPriorityCssVar(task.priority, priorities)} 30%, transparent)`,
                }}
              >
                {task.priority}
              </Badge>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
          <Layers size={24} className="text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">
            No tasks yet — use Breakdown to decompose this epic
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateDialog(true)}
            leftIcon={<Plus className="size-3" />}
            hoverEffect="scale"
            clickEffect="scale"
          >
            Add task
          </Button>
        </div>
      )}

      {/* Create task dialog with epic pre-selected */}
      {showCreateDialog && (
        <CreateTaskDialog
          onDismiss={handleCreated}
          defaultEpicId={epicId}
        />
      )}
    </div>
  );
}
