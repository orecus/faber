import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Database,
  FileDown,
  FileUp,
  HardDrive,
  Loader2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { formatError } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

import type {
  ConflictType,
  ResolutionChoice,
  TaskConflict,
  TaskResolution,
} from "../../types";

// ── Constants ──

const CONFLICT_META: Record<
  ConflictType,
  {
    label: string;
    description: string;
    icon: typeof Database;
    colorClass: string;
    badgeClass: string;
  }
> = {
  db_only: {
    label: "Database Only",
    description: "Tasks in the database with no file on disk",
    icon: Database,
    colorClass: "text-warning",
    badgeClass: "bg-warning/10 text-warning ring-warning/20",
  },
  disk_only: {
    label: "File Only",
    description: "Files on disk not tracked in the database",
    icon: HardDrive,
    colorClass: "text-primary",
    badgeClass: "bg-primary/10 text-primary ring-primary/20",
  },
  content_differs: {
    label: "Content Differs",
    description: "Database and file versions don't match",
    icon: AlertTriangle,
    colorClass: "text-destructive",
    badgeClass: "bg-destructive/10 text-destructive ring-destructive/20",
  },
};

const DEFAULT_CHOICES: Record<ConflictType, ResolutionChoice> = {
  db_only: "export_to_disk",
  disk_only: "import_to_db",
  content_differs: "use_db",
};

const CHOICE_OPTIONS: Record<
  ConflictType,
  { value: ResolutionChoice; label: string }[]
> = {
  db_only: [
    { value: "export_to_disk", label: "Export to disk" },
    { value: "skip", label: "Skip" },
  ],
  disk_only: [
    { value: "import_to_db", label: "Import to database" },
    { value: "delete_from_disk", label: "Delete from disk" },
    { value: "skip", label: "Skip" },
  ],
  content_differs: [
    { value: "use_db", label: "Use database version" },
    { value: "use_disk", label: "Use file version" },
    { value: "skip", label: "Skip" },
  ],
};

// ── Props ──

interface TaskFileConflictDialogProps {
  open: boolean;
  onClose: () => void;
  onResolved: () => void;
  projectId: string;
  conflicts: TaskConflict[];
}

// ── Component ──

export function TaskFileConflictDialog({
  open,
  onClose,
  onResolved,
  projectId,
  conflicts,
}: TaskFileConflictDialogProps) {
  const [applying, setApplying] = useState(false);

  // Initialize resolutions with default choices per conflict type
  const [resolutions, setResolutions] = useState<
    Record<string, ResolutionChoice>
  >(() => {
    const init: Record<string, ResolutionChoice> = {};
    for (const c of conflicts) {
      init[c.task_id] = DEFAULT_CHOICES[c.conflict_type];
    }
    return init;
  });

  // Group conflicts by type
  const grouped = useMemo(() => {
    const groups: Record<ConflictType, TaskConflict[]> = {
      db_only: [],
      disk_only: [],
      content_differs: [],
    };
    for (const c of conflicts) {
      groups[c.conflict_type].push(c);
    }
    return groups;
  }, [conflicts]);

  const setChoice = useCallback(
    (taskId: string, choice: ResolutionChoice) => {
      setResolutions((prev) => ({ ...prev, [taskId]: choice }));
    },
    [],
  );

  const setAllForType = useCallback(
    (type: ConflictType, choice: ResolutionChoice) => {
      setResolutions((prev) => {
        const next = { ...prev };
        for (const c of grouped[type]) {
          next[c.task_id] = choice;
        }
        return next;
      });
    },
    [grouped],
  );

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      const payload: TaskResolution[] = conflicts.map((c) => ({
        task_id: c.task_id,
        choice: resolutions[c.task_id] ?? DEFAULT_CHOICES[c.conflict_type],
      }));
      await invoke("resolve_task_conflicts", {
        projectId,
        resolutions: payload,
      });
      onResolved();
    } catch (e) {
      console.error("Failed to resolve conflicts:", e);
      useAppStore
        .getState()
        .flashError(`Failed to resolve conflicts: ${formatError(e)}`);
    } finally {
      setApplying(false);
    }
  }, [conflicts, resolutions, projectId, onResolved]);

  const sectionOrder: ConflictType[] = [
    "content_differs",
    "db_only",
    "disk_only",
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !applying) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div className="flex items-center justify-center size-7 rounded-md shrink-0 bg-warning/10">
              <AlertTriangle className="size-4 text-warning" />
            </div>
            Resolve Task File Conflicts
            <span className="text-[11px] font-medium bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full">
              {conflicts.length}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6 flex flex-col gap-3 pb-1">
          {sectionOrder.map((type) => {
            const items = grouped[type];
            if (items.length === 0) return null;

            const meta = CONFLICT_META[type];
            const Icon = meta.icon;
            const defaultChoice = DEFAULT_CHOICES[type];

            return (
              <div
                key={type}
                className="rounded-lg bg-muted/20 ring-1 ring-border/30 p-3 flex flex-col gap-2"
              >
                {/* Section header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`size-3.5 ${meta.colorClass}`} />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {meta.label}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 ${meta.badgeClass}`}
                    >
                      {items.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAllForType(type, defaultChoice)}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Reset all
                  </button>
                </div>

                <span className="text-[10px] text-muted-foreground -mt-1">
                  {meta.description}
                </span>

                {/* Task rows */}
                <div className="flex flex-col gap-1.5">
                  {items.map((conflict) => (
                    <ConflictRow
                      key={conflict.task_id}
                      conflict={conflict}
                      choice={
                        resolutions[conflict.task_id] ??
                        DEFAULT_CHOICES[conflict.conflict_type]
                      }
                      onChoiceChange={(choice) =>
                        setChoice(conflict.task_id, choice)
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={applying}
            className="h-8"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleApply}
            disabled={applying}
            leftIcon={
              applying ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileDown className="size-3.5" />
              )
            }
            className="h-8"
          >
            {applying ? "Applying..." : "Apply Resolutions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Conflict Row ──

function ConflictRow({
  conflict,
  choice,
  onChoiceChange,
}: {
  conflict: TaskConflict;
  choice: ResolutionChoice;
  onChoiceChange: (choice: ResolutionChoice) => void;
}) {
  const options = CHOICE_OPTIONS[conflict.conflict_type];

  return (
    <div className="rounded-md bg-background/50 ring-1 ring-border/20 px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-mono bg-muted/50 px-1.5 py-0.5 rounded shrink-0">
            {conflict.task_id}
          </span>
          <span className="text-[12px] text-foreground truncate">
            {conflict.title}
          </span>
        </div>

        <Select
          value={choice}
          onValueChange={(val) => onChoiceChange(val as ResolutionChoice)}
          items={options.map((o) => ({ value: o.value, label: o.label }))}
        >
          <SelectTrigger size="sm" className="w-auto min-w-[160px] h-7 text-[11px] shrink-0">
            <ChoiceIcon choice={choice} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Show diffs for content_differs */}
      {conflict.conflict_type === "content_differs" &&
        conflict.diffs.length > 0 && (
          <span className="text-[10px] text-muted-foreground pl-0.5">
            {conflict.diffs.join(", ")}
          </span>
        )}
    </div>
  );
}

// ── Choice Icon ──

function ChoiceIcon({ choice }: { choice: ResolutionChoice }) {
  switch (choice) {
    case "use_db":
    case "export_to_disk":
      return <Database className="size-3 text-muted-foreground" />;
    case "use_disk":
    case "import_to_db":
      return <FileUp className="size-3 text-muted-foreground" />;
    case "delete_from_disk":
      return <HardDrive className="size-3 text-muted-foreground" />;
    case "skip":
      return null;
  }
}
