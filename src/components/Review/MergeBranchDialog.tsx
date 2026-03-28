import { invoke } from "@tauri-apps/api/core";
import { GitBranch, GitMerge, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface MergeBranchDialogProps {
  projectId: string;
  sourceBranch: string;
  onConfirm: (targetBranch: string) => void;
  onCancel: () => void;
}

export default function MergeBranchDialog({
  projectId,
  sourceBranch,
  onConfirm,
  onCancel,
}: MergeBranchDialogProps) {
  const accentColor = useProjectAccentColor();
  const [branches, setBranches] = useState<string[]>([]);
  const [targetBranch, setTargetBranch] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Fetch available branches and detect the current project branch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [branchList, currentBranch] = await Promise.all([
          invoke<string[]>("list_branches", { projectId }),
          invoke<string>("get_project_branch", { projectId }),
        ]);

        if (cancelled) return;

        // Filter out the source branch — you can't merge a branch into itself
        const filtered = branchList.filter((b) => b !== sourceBranch);
        setBranches(filtered);

        // Default to the current branch of the main repo
        if (filtered.includes(currentBranch)) {
          setTargetBranch(currentBranch);
        } else if (filtered.length > 0) {
          setTargetBranch(filtered[0]);
        }
      } catch {
        // Fallback: at least let the user try "main"
        setBranches(["main"]);
        setTargetBranch("main");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, sourceBranch]);

  const handleConfirm = useCallback(() => {
    if (targetBranch) {
      onConfirm(targetBranch);
    }
  }, [targetBranch, onConfirm]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="min-w-[380px] max-w-[460px]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="size-4" />
            Merge Branch
          </DialogTitle>
        </DialogHeader>

        {/* Merge flow visualization */}
        <div className="space-y-3">
          {/* Source branch */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Source
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-2">
              <GitBranch className="size-3.5 text-dim-foreground shrink-0" />
              <span className="text-xs font-mono text-foreground truncate">
                {sourceBranch}
              </span>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
              <div className="h-2 w-px bg-border" />
              <span className="text-2xs uppercase tracking-wider">
                into
              </span>
              <div className="h-2 w-px bg-border" />
            </div>
          </div>

          {/* Target branch selector */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Target
            </label>
            {loading ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-2">
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  Loading branches...
                </span>
              </div>
            ) : (
              <Select
                value={targetBranch}
                onValueChange={(v) => {
                  if (v) setTargetBranch(v);
                }}
              >
                <SelectTrigger className="w-full font-mono text-xs">
                  <SelectValue placeholder="Select target branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      <GitBranch className="size-3 text-dim-foreground" />
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Info note */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            This is a local merge operation. The worktree branch will be merged
            into the selected target branch in your main repository.
          </p>
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
            disabled={!targetBranch || loading}
            onClick={handleConfirm}
            leftIcon={<GitMerge className="size-3.5" />}
            hoverEffect="scale-glow"
            clickEffect="scale"
          >
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
