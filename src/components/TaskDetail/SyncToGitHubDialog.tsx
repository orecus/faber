import { invoke } from "@tauri-apps/api/core";
import { Check, Github, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";

export interface SyncOptions {
  title: boolean;
  body: boolean;
  status: boolean;
  labels: boolean;
}

interface SyncToGitHubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSync: (options: SyncOptions) => void;
  syncing: boolean;
  taskTitle: string;
  taskBody: string;
  taskStatus: string;
  taskLabels: string[];
  issueRef: string;
  projectId: string;
}

// ── Checkbox Row ──

function SyncCheckboxRow({
  checked,
  onChange,
  label,
  preview,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  preview: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/50 cursor-pointer"
    >
      {/* Checkbox */}
      <div
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded transition-colors ${
          checked
            ? "bg-primary text-primary-foreground"
            : "bg-muted ring-1 ring-border"
        }`}
      >
        {checked && <Check className="size-2.5" strokeWidth={3} />}
      </div>

      {/* Label + preview */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {preview}
        </span>
      </div>
    </button>
  );
}

// ── Dialog ──

export default function SyncToGitHubDialog({
  open,
  onOpenChange,
  onSync,
  syncing,
  taskTitle,
  taskBody,
  taskStatus,
  taskLabels,
  issueRef,
  projectId,
}: SyncToGitHubDialogProps) {
  const accentColor = useProjectAccentColor();

  const [syncTitle, setSyncTitle] = useState(false);
  const [syncBody, setSyncBody] = useState(false);
  const [syncStatus, setSyncStatus] = useState(false);
  const [syncLabels, setSyncLabels] = useState(false);

  // Load default checkbox states from project settings
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;

    const load = async () => {
      const get = (key: string) =>
        invoke<string | null>("get_project_setting", {
          projectId,
          key,
        });

      try {
        const [dt, db, ds, dl] = await Promise.all([
          get("github_sync_default_title"),
          get("github_sync_default_body"),
          get("github_sync_default_status"),
          get("github_sync_default_labels"),
        ]);
        if (cancelled) return;
        setSyncTitle(dt === "true");
        setSyncBody(db === "true");
        setSyncStatus(ds === "true");
        setSyncLabels(dl === "true");
      } catch {
        // Use defaults (all false)
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const anySelected = syncTitle || syncBody || syncStatus || syncLabels;

  const handleSync = useCallback(() => {
    if (!anySelected) return;
    onSync({
      title: syncTitle,
      body: syncBody,
      status: syncStatus,
      labels: syncLabels,
    });
  }, [onSync, syncTitle, syncBody, syncStatus, syncLabels, anySelected]);

  // Preview values
  const titlePreview = useMemo(
    () =>
      taskTitle
        ? taskTitle.length > 60
          ? taskTitle.slice(0, 60) + "..."
          : taskTitle
        : "(untitled)",
    [taskTitle],
  );

  const bodyPreview = useMemo(() => {
    if (!taskBody) return "(empty)";
    const firstLine = taskBody.split("\n").find((l) => l.trim()) ?? "";
    return firstLine.length > 70
      ? firstLine.slice(0, 70) + "..."
      : firstLine || "(empty)";
  }, [taskBody]);

  const statusPreview = useMemo(
    () =>
      taskStatus === "done" || taskStatus === "archived"
        ? "Close issue"
        : "Reopen issue",
    [taskStatus],
  );

  const labelsPreview = useMemo(
    () => (taskLabels.length > 0 ? taskLabels.join(", ") : "(none)"),
    [taskLabels],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="min-w-[400px] max-w-[480px]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-4" />
            Sync to GitHub
          </DialogTitle>
          <p className="text-xs text-dim-foreground">
            Select which fields to push to{" "}
            <span className="font-mono text-muted-foreground">{issueRef}</span>
          </p>
        </DialogHeader>

        {/* Checkbox rows */}
        <div className="-mx-2 flex flex-col gap-0.5">
          <SyncCheckboxRow
            checked={syncTitle}
            onChange={setSyncTitle}
            label="Title"
            preview={titlePreview}
          />
          <SyncCheckboxRow
            checked={syncBody}
            onChange={setSyncBody}
            label="Body"
            preview={bodyPreview}
          />
          <SyncCheckboxRow
            checked={syncStatus}
            onChange={setSyncStatus}
            label="Status"
            preview={statusPreview}
          />
          <SyncCheckboxRow
            checked={syncLabels}
            onChange={setSyncLabels}
            label="Labels"
            preview={labelsPreview}
          />
        </div>

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
            color={accentColor}
            size="sm"
            disabled={!anySelected || syncing}
            onClick={handleSync}
            leftIcon={
              syncing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )
            }
            hoverEffect="scale-glow"
            clickEffect="scale"
          >
            {syncing ? "Syncing..." : "Sync to GitHub"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
