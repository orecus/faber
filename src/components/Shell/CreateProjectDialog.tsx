import { open } from "@tauri-apps/plugin-dialog";
import { exists, readDir } from "@tauri-apps/plugin-fs";
import { FolderOpen, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const INVALID_CHARS = /[/\\:*?"<>|]/;
const INVALID_CHARS_DISPLAY = '/ \\ : * ? " < > |';

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

  // Inline validation state
  const [nameError, setNameError] = useState<string | null>(null);
  const [pathWarning, setPathWarning] = useState<string | null>(null);

  // Validate name on change
  const trimmedName = name.trim();
  const hasInvalidChars = useMemo(
    () => INVALID_CHARS.test(trimmedName),
    [trimmedName],
  );

  useEffect(() => {
    if (!trimmedName) {
      setNameError(null);
    } else if (hasInvalidChars) {
      setNameError(`Invalid characters: ${INVALID_CHARS_DISPLAY}`);
    } else {
      setNameError(null);
    }
  }, [trimmedName, hasInvalidChars]);

  // Debounced directory existence check
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    setPathWarning(null);

    if (!parentPath || !trimmedName || hasInvalidChars) return;

    const targetPath = `${parentPath}/${trimmedName}`;
    checkTimerRef.current = setTimeout(async () => {
      try {
        const pathExists = await exists(targetPath);
        if (!pathExists) {
          setPathWarning(null);
          return;
        }
        // Check if it's a non-empty directory
        try {
          const entries = await readDir(targetPath);
          if (entries.length > 0) {
            setPathWarning("Directory already exists and is not empty");
          } else {
            setPathWarning(null); // Empty dir is OK
          }
        } catch {
          // If readDir fails it might be a file, not a directory
          setPathWarning("A file already exists at this path");
        }
      } catch {
        // exists() failed — ignore, backend will catch it
      }
    }, 300);

    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  }, [parentPath, trimmedName, hasInvalidChars]);

  const canCreate =
    trimmedName.length > 0 &&
    parentPath.length > 0 &&
    !creating &&
    !hasInvalidChars &&
    !pathWarning;

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
      await createProject(parentPath, trimmedName);
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
      removeBackgroundTask("Creating project");
    }
  }, [canCreate, parentPath, trimmedName, createProject, addBackgroundTask, removeBackgroundTask, onDismiss]);

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
    parentPath && trimmedName
      ? `${parentPath}/${trimmedName}`
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
            className={nameError ? "border-destructive" : ""}
          />
          {nameError && (
            <p className="mt-1 text-xs text-destructive">{nameError}</p>
          )}
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
          <div className={`rounded-md px-3 py-2 ${pathWarning ? "bg-destructive/10" : "bg-muted/50"}`}>
            <p className="text-2xs text-muted-foreground mb-0.5">
              Will be created at
            </p>
            <p className="text-xs text-dim-foreground font-mono truncate">
              {pathPreview}
            </p>
            {pathWarning && (
              <p className="mt-1 text-xs text-destructive">{pathWarning}</p>
            )}
          </div>
        )}

        {/* Error from backend */}
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
