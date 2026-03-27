import { Check, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "../ui/input";

interface TaskTitleProps {
  title: string;
  onChange: (title: string) => void;
  compact?: boolean;
}

export default function TaskTitle({ title, onChange, compact }: TaskTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when title changes externally
  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitEdit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) {
      onChange(trimmed);
    } else {
      setDraft(title);
    }
    setEditing(false);
  }, [draft, title, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      }
      if (e.key === "Escape") {
        setDraft(title);
        setEditing(false);
      }
    },
    [commitEdit, title],
  );

  if (editing) {
    return (
      <div className="group/title flex items-center gap-2">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className={`h-auto border-none bg-transparent px-0 py-0 font-semibold text-foreground shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${compact ? "text-sm leading-none" : "text-lg"}`}
        />
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            commitEdit();
          }}
          className="cursor-pointer flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Check className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`group/title flex cursor-pointer items-center gap-1.5 rounded-md text-left transition-colors hover:bg-accent/50 ${compact ? "min-w-0 max-w-[400px] py-0.5 px-1.5" : "w-full -mx-1 px-1 py-0.5"}`}
    >
      <span className={`flex-1 font-semibold text-foreground ${compact ? "truncate text-sm leading-none" : "text-lg leading-snug"}`}>
        {title}
      </span>
      <Pencil className={`shrink-0 text-muted-foreground opacity-30 transition-opacity group-hover/title:opacity-100 group-focus-within/title:opacity-100 ${compact ? "size-3" : "mt-1 size-3.5"}`} />
    </button>
  );
}
