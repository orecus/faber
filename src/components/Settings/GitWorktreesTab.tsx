import { invoke } from "@tauri-apps/api/core";
import { FileText, FolderCode, GitBranch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { formatError } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";
import { sectionHeadingClass, ToggleRow } from "./shared";

import type { Project } from "../../types";

// ── Git & Worktrees Tab ──

export function GitWorktreesTab() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const project = useAppStore(
    (s) => s.projects.find((p) => p.id === activeProjectId),
  );
  const updateProjectInStore = useAppStore((s) => s.updateProject);

  const [branchPattern, setBranchPattern] = useState(
    project?.branch_naming_pattern ?? "feat/{{task_id}}-{{task_slug}}",
  );
  const [instructionFile, setInstructionFile] = useState(
    (project?.instruction_file_path ?? "").replace(/\\/g, "/"),
  );
  const [worktreeAutoCleanup, setWorktreeAutoCleanup] = useState(false);

  // Sync local state when project changes
  useEffect(() => {
    setBranchPattern(
      project?.branch_naming_pattern ?? "feat/{{task_id}}-{{task_slug}}",
    );
    setInstructionFile(
      (project?.instruction_file_path ?? "").replace(/\\/g, "/"),
    );
  }, [
    project?.id,
    project?.branch_naming_pattern,
    project?.instruction_file_path,
  ]);

  // Load per-project settings
  useEffect(() => {
    if (!activeProjectId) return;
    invoke<string | null>("get_project_setting", {
      projectId: activeProjectId,
      key: "worktree_auto_cleanup",
    })
      .then((val) => setWorktreeAutoCleanup(val === "true"))
      .catch(() => {});
  }, [activeProjectId]);

  const handleUpdate = useCallback(
    async (updates: Record<string, unknown>) => {
      if (!activeProjectId) return;
      try {
        const result = await invoke<Project>("update_project", {
          id: activeProjectId,
          ...updates,
        });
        updateProjectInStore(result);
      } catch (e) {
        console.error("Failed to update project:", e);
        useAppStore
          .getState()
          .flashError(`Failed to update project: ${formatError(e)}`);
      }
    },
    [activeProjectId, updateProjectInStore],
  );

  const handleBranchPatternBlur = useCallback(() => {
    handleUpdate({
      branchNamingPattern: branchPattern ? branchPattern : null,
    });
  }, [branchPattern, handleUpdate]);

  const handleInstructionFileBlur = useCallback(() => {
    const normalized = instructionFile.replace(/\\/g, "/");
    handleUpdate({
      instructionFilePath: normalized ? normalized : null,
    });
  }, [instructionFile, handleUpdate]);

  const handleWorktreeAutoCleanupChange = useCallback(
    (value: boolean) => {
      setWorktreeAutoCleanup(value);
      invoke("set_project_setting", {
        projectId: activeProjectId,
        key: "worktree_auto_cleanup",
        value: value ? "true" : "false",
      }).catch(() => {});
    },
    [activeProjectId],
  );

  if (!activeProjectId || !project) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <FolderCode className="mb-3 size-10 opacity-30" />
        <p className="text-sm font-medium text-foreground">
          No project selected
        </p>
        <p className="mt-1 text-xs text-center max-w-xs">
          Open a project to configure git and worktree settings.
        </p>
      </div>
    );
  }

  const panelClass =
    "rounded-lg bg-muted/20 ring-1 ring-border/30 p-4 flex flex-col gap-4";

  return (
    <div className="flex flex-col gap-4">
      {/* ── Branch Naming ── */}
      <div className={panelClass}>
        <div className={sectionHeadingClass}>Branch Naming</div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-dim-foreground font-medium">
            Branch pattern
          </span>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <GitBranch className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              type="text"
              value={branchPattern}
              onChange={(e) => setBranchPattern(e.target.value)}
              onBlur={handleBranchPatternBlur}
              placeholder="feat/{{task_id}}-{{task_slug}}"
            />
          </InputGroup>
          <span className="text-2xs text-muted-foreground">
            Template for branch names when creating worktrees. Variables:{" "}
            {"{{task_id}}"}, {"{{task_slug}}"}
          </span>
        </div>
      </div>

      {/* ── Session Configuration ── */}
      <div className={panelClass}>
        <div className={sectionHeadingClass}>Session Configuration</div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-dim-foreground font-medium">
            Instruction file
          </span>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <FileText className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              type="text"
              value={instructionFile}
              onChange={(e) =>
                setInstructionFile(e.target.value.replace(/\\/g, "/"))
              }
              onBlur={handleInstructionFileBlur}
              placeholder="CLAUDE.md (auto-detected)"
            />
          </InputGroup>
          <span className="text-2xs text-muted-foreground">
            Relative path from project root. Injected into agent session prompts.
          </span>
        </div>
      </div>

      {/* ── Worktree Management ── */}
      <div className={panelClass}>
        <div className={sectionHeadingClass}>Worktree Management</div>
        <ToggleRow
          label="Auto-cleanup worktrees"
          description="Remove worktrees when sessions stop. Worktrees with uncommitted changes are preserved."
          checked={worktreeAutoCleanup}
          onChange={handleWorktreeAutoCleanupChange}
        />
      </div>
    </div>
  );
}
