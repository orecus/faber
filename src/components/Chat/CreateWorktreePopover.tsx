import { invoke } from "@tauri-apps/api/core";
import { GitFork, Loader2, Plus } from "lucide-react";
import React, { useCallback, useState } from "react";

import { formatError } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import BranchSelect from "../ui/BranchSelect";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";

import type { WorktreeInfo } from "../../types";

// ── Component ──

interface CreateWorktreePopoverProps {
  projectId: string;
  onCreated: () => void;
}

export default React.memo(function CreateWorktreePopover({
  projectId,
  onCreated,
}: CreateWorktreePopoverProps) {
  const [open, setOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    const label = "Creating worktree";
    const store = useAppStore.getState();
    store.addBackgroundTask(label);
    setCreating(true);
    setError(null);
    try {
      await invoke("create_worktree", {
        projectId,
        branchName: branchName.trim() || undefined,
        baseRef: baseBranch || undefined,
      });
      // Refresh worktrees in store
      const wts = await invoke<WorktreeInfo[]>("list_worktrees", { projectId });
      store.updateProjectWorktrees(projectId, wts);
      store.refreshProjectBranches();
      // Reset and close
      setBranchName("");
      setBaseBranch("");
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(formatError(e));
    } finally {
      store.removeBackgroundTask(label);
      setCreating(false);
    }
  }, [projectId, branchName, baseBranch, creating, onCreated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !creating) {
        e.preventDefault();
        handleCreate();
      }
    },
    [creating, handleCreate],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setError(null);
          setBranchName("");
          setBaseBranch("");
        }
      }}
    >
      <PopoverTrigger
        className="flex items-center gap-1 h-5 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
        title="Create worktree"
      >
        <GitFork size={10} />
        <span>Worktree</span>
        <Plus size={8} />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-64 p-0 gap-0"
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-border/30">
          <span className="text-xs font-medium text-foreground">
            Create Worktree
          </span>
        </div>

        {/* Form */}
        <div className="px-3 py-2.5 space-y-2.5">
          {/* Branch name */}
          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground uppercase tracking-wider">
              Branch name
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="auto-generated if empty"
              disabled={creating}
              autoFocus
              className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground font-mono placeholder:text-muted-foreground/50 outline-none focus:border-primary disabled:opacity-50"
            />
          </div>

          {/* Base branch */}
          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground uppercase tracking-wider">
              Base branch
            </label>
            <BranchSelect
              projectId={projectId}
              currentBranch={null}
              mode="select"
              value={baseBranch}
              onChange={setBaseBranch}
              triggerVariant="select"
              dropUp
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-[11px] text-destructive leading-snug">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-1.5 px-3 py-2 border-t border-border/30">
          <button
            onClick={() => setOpen(false)}
            disabled={creating}
            className="h-6 px-2.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-1 h-6 px-2.5 rounded text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {creating ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Plus size={10} />
            )}
            Create
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
});
