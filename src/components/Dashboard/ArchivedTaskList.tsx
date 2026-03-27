import { useCallback, useState } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";

import type { Task } from "../../types";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import ConfirmDialog from "../Review/ConfirmDialog";
import PriorityBadge from "./PriorityBadge";

interface ArchivedTaskListProps {
  tasks: Task[];
  onTaskClick: (taskId: string) => void;
  onRestore: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export default function ArchivedTaskList({
  tasks,
  onTaskClick,
  onRestore,
  onDelete,
}: ArchivedTaskListProps) {
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const deleteTask = deleteTaskId
    ? tasks.find((t) => t.id === deleteTaskId)
    : null;

  const handleConfirmDelete = useCallback(() => {
    if (deleteTaskId) {
      onDelete(deleteTaskId);
      setDeleteTaskId(null);
    }
  }, [deleteTaskId, onDelete]);

  // Empty state
  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <Archive className="size-8 opacity-40" />
        <p className="text-sm">No archived tasks</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-0.5 py-1">
        <div className="flex flex-col gap-1">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="group flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-[var(--radius-element)] cursor-pointer hover:bg-accent/40 transition-colors"
              onClick={() => onTaskClick(task.id)}
            >
              {/* Task ID */}
              <span className="text-2xs font-mono text-muted-foreground shrink-0 w-12">
                {task.id}
              </span>

              {/* Priority */}
              <PriorityBadge priority={task.priority} />

              {/* Title */}
              <span className="text-xs font-medium text-foreground truncate flex-1 min-w-0">
                {task.title}
              </span>

              {/* Labels */}
              {task.labels.length > 0 && (
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  {task.labels.slice(0, 3).map((label) => (
                    <span
                      key={label}
                      className="inline-block px-1.5 py-px text-2xs font-medium rounded-full bg-accent text-muted-foreground truncate max-w-[80px]"
                    >
                      {label}
                    </span>
                  ))}
                  {task.labels.length > 3 && (
                    <span className="text-2xs text-muted-foreground">
                      +{task.labels.length - 3}
                    </span>
                  )}
                </div>
              )}

              {/* Archived date */}
              <span className="text-2xs text-muted-foreground shrink-0">
                {formatDate(task.updated_at)}
              </span>

              {/* Actions — visible on hover */}
              <div className="flex items-center gap-0.5 opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  hoverEffect="scale"
                  clickEffect="scale"
                  title="Restore to backlog"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore(task.id);
                  }}
                >
                  <ArchiveRestore className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  hoverEffect="scale"
                  clickEffect="scale"
                  title="Delete permanently"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTaskId(task.id);
                  }}
                >
                  <Trash2 className="size-3 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {deleteTask && (
        <ConfirmDialog
          title="Delete task permanently"
          message={`This will permanently delete "${deleteTask.title}" (${deleteTask.id}). This action cannot be undone.`}
          variant="danger"
          confirmLabel="Delete permanently"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTaskId(null)}
        />
      )}
    </>
  );
}
