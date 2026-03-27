import { ClipboardList, Plus } from "lucide-react";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface EmptyStateProps {
  onNewTask?: () => void;
}

export default function EmptyState({ onNewTask }: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center flex-1 min-h-0">
      <div className="text-center max-w-[360px]">
        <div className="mb-3 text-muted-foreground flex justify-center">
          <ClipboardList size={32} />
        </div>
        <h3 className="m-0 mb-2 text-base font-semibold text-foreground">
          No tasks yet
        </h3>
        <p className="m-0 mb-4 text-sm text-dim-foreground leading-[1.5]">
          Create a task file in your project's <code className="text-xs">.agents/tasks/</code>{" "}
          directory or create one from the UI.
        </p>
        {onNewTask && (
          <Button
            variant="outline"
            size="sm"
            onClick={onNewTask}
            leftIcon={<Plus className="size-3.5" />}
            hoverEffect="scale"
            clickEffect="scale"
          >
            Create Task
          </Button>
        )}
      </div>
    </div>
  );
}
