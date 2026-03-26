import { Pencil } from "lucide-react";
import { useCallback, useState } from "react";

import TaskMarkdownEditor from "./TaskMarkdownEditor";
import TaskMarkdownPreview from "./TaskMarkdownPreview";

interface TaskBodyProps {
  body: string;
  onChange: (body: string) => void;
  onSave?: () => void;
}

export default function TaskBody({ body, onChange, onSave }: TaskBodyProps) {
  const [editing, setEditing] = useState(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl+Enter to save and exit edit mode
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        onSave?.();
        setEditing(false);
      }
      // Escape to exit edit mode (without saving)
      if (e.key === "Escape") {
        setEditing(false);
      }
    },
    [onSave],
  );

  if (editing) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={handleKeyDown}
      >
        {/* Edit mode toolbar */}
        <div className="flex items-center justify-between pb-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Editing
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              Ctrl+Enter to save
            </span>
            <button
              onClick={() => setEditing(false)}
              className="cursor-pointer rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Done
            </button>
          </div>
        </div>
        <TaskMarkdownEditor body={body} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className="group/body relative flex min-h-0 flex-1 flex-col">
      {/* Edit button overlay */}
      <button
        onClick={() => setEditing(true)}
        className="cursor-pointer absolute right-2 top-1 z-10 flex items-center gap-1.5 rounded-md bg-accent/80 px-2 py-1 text-[11px] text-muted-foreground opacity-30 backdrop-blur-sm transition-all hover:bg-accent hover:text-foreground group-hover/body:opacity-100 group-focus-within/body:opacity-100"
      >
        <Pencil className="size-3" />
        Edit
      </button>
      <TaskMarkdownPreview body={body} />
    </div>
  );
}
