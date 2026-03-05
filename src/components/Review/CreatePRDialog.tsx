import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, ExternalLink, GitPullRequestArrow, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { formatErrorWithHint } from "../../lib/errorMessages";
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

import type { PullRequestResult } from "../../types";

interface CreatePRDialogProps {
  worktreePath: string;
  defaultTitle: string;
  githubIssue: string | null;
  taskId: string | null;
  projectId: string | null;
  onDismiss: () => void;
}

type Stage = "form" | "pushing" | "creating" | "done";

/** Extract issue number from "owner/repo#42" → "42" */
function extractIssueNumber(issueRef: string): string | null {
  const idx = issueRef.lastIndexOf("#");
  return idx >= 0 ? issueRef.slice(idx + 1) : null;
}

export default function CreatePRDialog({
  worktreePath,
  defaultTitle,
  githubIssue,
  taskId,
  projectId,
  onDismiss,
}: CreatePRDialogProps) {
  const accentColor = useProjectAccentColor();
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PullRequestResult | null>(null);

  // Pre-populate body with "Closes #N" if GitHub issue is linked and setting is enabled
  useEffect(() => {
    if (!githubIssue || !projectId) return;
    const issueNum = extractIssueNumber(githubIssue);
    if (!issueNum) return;

    (async () => {
      try {
        const setting = await invoke<string | null>("get_project_setting", {
          projectId,
          key: "github_pr_closes_ref",
        });
        // Default to true if not set
        if (setting !== "false") {
          setBody((prev) => {
            const closesLine = `\nCloses #${issueNum}`;
            if (prev.includes(`Closes #${issueNum}`)) return prev;
            return prev ? `${prev}${closesLine}` : closesLine.trim();
          });
        }
      } catch {
        // Fallback: inject anyway
        if (issueNum) {
          setBody((prev) => {
            if (prev.includes(`Closes #${issueNum}`)) return prev;
            return prev ? `${prev}\nCloses #${issueNum}` : `Closes #${issueNum}`;
          });
        }
      }
    })();
  }, [githubIssue, projectId]);

  const canSubmit = title.trim().length > 0 && stage === "form";

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);

    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Creating pull request");
    try {
      // Step 1: Push branch
      setStage("pushing");
      await invoke<string>("push_branch", { projectId, worktreePath });

      // Step 2: Create PR
      setStage("creating");
      const pr = await invoke<PullRequestResult>("create_pull_request", {
        projectId,
        worktreePath,
        title: title.trim(),
        body: body.trim(),
        base: baseBranch.trim() || null,
      });

      // Step 3: Record PR URL on the task (always, regardless of sync settings)
      if (taskId && projectId && pr.url) {
        try {
          await invoke("set_task_github_pr", {
            projectId,
            taskId,
            prUrl: pr.url,
          });
        } catch {
          // Non-fatal — PR was created successfully
        }
      }

      setResult(pr);
      setStage("done");
    } catch (err) {
      setError(formatErrorWithHint(err, "github-pr"));
      setStage("form");
    } finally {
      removeBackgroundTask("Creating pull request");
    }
  }, [canSubmit, worktreePath, title, body, baseBranch, taskId, projectId]);

  // Enter to submit when in form state
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && canSubmit) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [canSubmit, handleSubmit],
  );

  const isWorking = stage === "pushing" || stage === "creating";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="min-w-[400px] max-w-[500px]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequestArrow className="size-4" />
            Create Pull Request
          </DialogTitle>
        </DialogHeader>

        {stage === "done" && result ? (
          /* Success state */
          <div className="space-y-4">
            <div className="rounded-md border border-success bg-[color-mix(in_oklch,var(--success)_10%,transparent)] px-4 py-3">
              <p className="text-sm font-medium text-success">
                PR #{result.number} created
              </p>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {result.url}
                <ExternalLink className="size-3" />
              </a>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onDismiss}
                hoverEffect="scale"
                clickEffect="scale"
              >
                Close
              </Button>
            </div>
          </div>
        ) : (
          /* Form state */
          <>
            {/* Title */}
            <div>
              <label className="mb-1 block text-xs text-dim-foreground">
                Title
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="PR title"
                disabled={isWorking}
                autoFocus
              />
            </div>

            {/* Body */}
            <div>
              <label className="mb-1 block text-xs text-dim-foreground">
                Description
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe your changes..."
                disabled={isWorking}
                rows={4}
                className="w-full resize-y rounded-[var(--radius-element)] border border-border bg-popover px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>

            {/* Base branch */}
            <div>
              <label className="mb-1 block text-xs text-dim-foreground">
                Base branch
              </label>
              <Input
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder="main"
                disabled={isWorking}
              />
            </div>

            {/* Progress indicator */}
            {isWorking && (
              <div className="flex items-center gap-2 text-xs text-dim-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {stage === "pushing" ? "Pushing branch..." : "Creating PR..."}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 ring-1 ring-destructive/20 px-3 py-2.5">
                <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive whitespace-pre-line">{error}</p>
              </div>
            )}

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
                    disabled={isWorking}
                  />
                }
              >
                Cancel
              </DialogClose>
              <Button
                variant="color"
                color={accentColor}
                size="sm"
                disabled={!canSubmit}
                loading={isWorking}
                onClick={handleSubmit}
                leftIcon={<GitPullRequestArrow className="size-3.5" />}
                hoverEffect="scale-glow"
                clickEffect="scale"
              >
                Create PR
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
