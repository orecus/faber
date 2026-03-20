import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Plus, X } from "lucide-react";
import { useCallback, useState } from "react";

import { useAppStore } from "../../store/appStore";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface CreateProjectDialogProps {
  onDismiss: () => void;
}

export default function CreateProjectDialog({
  onDismiss,
}: CreateProjectDialogProps) {
  const createProject = useAppStore((s) => s.createProject);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

  const [name, setName] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = name.trim().length > 0 && parentPath.length > 0 && !creating;

  const handlePickLocation = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose project location",
    });
    if (selected) setParentPath(selected);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;
    setError(null);
    setCreating(true);
    addBackgroundTask("Creating project");
    try {
      await createProject(parentPath, name.trim());
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
      removeBackgroundTask("Creating project");
    }
  }, [canCreate, parentPath, name, createProject, addBackgroundTask, removeBackgroundTask, onDismiss]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && canCreate) {
        e.preventDefault();
        handleCreate();
      }
    },
    [canCreate, handleCreate],
  );

  // Build path preview
  const pathPreview =
    parentPath && name.trim()
      ? `${parentPath}/${name.trim()}`
      : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="min-w-[420px] max-w-[540px]"
      >
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        {/* Project name */}
        <div>
          <label className="mb-1 block text-xs text-dim-foreground">
            Project Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            placeholder="my-project"
            autoFocus
          />
        </div>

        {/* Location picker */}
        <div>
          <label className="mb-1 block text-xs text-dim-foreground">
            Location
          </label>
          <div className="flex items-center gap-2">
            <Input
              value={parentPath}
              readOnly
              placeholder="Choose a folder…"
              className="flex-1 cursor-pointer"
              onClick={handlePickLocation}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handlePickLocation}
              leftIcon={<FolderOpen className="size-3.5" />}
              hoverEffect="scale"
              clickEffect="scale"
            >
              Browse
            </Button>
          </div>
        </div>

        {/* Path preview */}
        {pathPreview && (
          <div className="rounded-md bg-muted/50 px-3 py-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">
              Will be created at
            </p>
            <p className="text-xs text-dim-foreground font-mono truncate">
              {pathPreview}
            </p>
          </div>
        )}

        {/* Error */}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Actions */}
        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="outline"
                size="sm"
                leftIcon={<X className="size-3.5" />}
                hoverEffect="scale"
                clickEffect="scale"
              />
            }
          >
            Cancel
          </DialogClose>
          <Button
            variant="color"
            color="blue"
            size="sm"
            disabled={!canCreate}
            loading={creating}
            onClick={handleCreate}
            leftIcon={<Plus className="size-3.5" />}
            hoverEffect="scale"
            clickEffect="scale"
          >
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
