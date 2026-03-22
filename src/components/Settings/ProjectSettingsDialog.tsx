import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { formatError } from "../../lib/errorMessages";
import {
  Bot,
  Cpu,
  FileText,
  FolderCode,
  GitBranch,
  Image,
  MessageSquare,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { clearIconCache, useProjectIcon } from "../../hooks/useProjectIcon";
import { useAppStore } from "../../store/appStore";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../ui/input-group";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import {
  colorStyles,
  gradientHexColors,
  solidColorGradients,
} from "../ui/orecus.io/lib/color-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

import { TaskFileConflictDialog } from "./TaskFileConflictDialog";

import type { AgentInfo, Project, SessionTransport, TaskConflict } from "../../types";
import type { ThemeColor } from "../ui/orecus.io/lib/color-utils";

const TAB_COLORS: { value: ThemeColor; label: string }[] = [
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
  { value: "violet", label: "Violet" },
  { value: "indigo", label: "Indigo" },
  { value: "cyan", label: "Cyan" },
  { value: "teal", label: "Teal" },
  { value: "green", label: "Green" },
  { value: "emerald", label: "Emerald" },
  { value: "lime", label: "Lime" },
  { value: "yellow", label: "Yellow" },
  { value: "amber", label: "Amber" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
  { value: "rose", label: "Rose" },
  { value: "pink", label: "Pink" },
  { value: "fuchsia", label: "Fuchsia" },
];

// ── Project Icon Preview ──

function ProjectIconPreview({
  project,
  accentHex,
}: {
  project: Project;
  accentHex: string;
}) {
  const svgMarkup = useProjectIcon(project.id, project.path, project.icon_path);

  if (svgMarkup) {
    return (
      <span
        className="size-5 inline-flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    );
  }
  return (
    <FolderCode
      size={16}
      strokeWidth={1.5}
      className="transition-colors duration-150"
      style={{ color: accentHex }}
    />
  );
}

// ── Toggle Row ──

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 py-1.5 ${disabled ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] text-foreground">{label}</span>
        {description && (
          <span className="text-[11px] text-muted-foreground mt-0.5">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`pointer-events-none inline-block size-4 rounded-full bg-background shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

const sectionHeadingClass =
  "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

// ── Project Settings Dialog ──

interface ProjectSettingsDialogProps {
  projectId: string;
  agents: AgentInfo[];
  onDismiss: () => void;
}

export function ProjectSettingsDialog({
  projectId,
  agents,
  onDismiss,
}: ProjectSettingsDialogProps) {
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
  const updateProjectInStore = useAppStore((s) => s.updateProject);
  const removeProjectFromStore = useAppStore((s) => s.removeProject);

  const [agent, setAgent] = useState(project?.default_agent ?? "");
  const [model, setModel] = useState(project?.default_model ?? "");
  const [branchPattern, setBranchPattern] = useState(
    project?.branch_naming_pattern ?? "feat/{{task_id}}-{{task_slug}}",
  );
  const [instructionFile, setInstructionFile] = useState(
    (project?.instruction_file_path ?? "").replace(/\\/g, "/"),
  );
  const [defaultTransport, setDefaultTransport] =
    useState<SessionTransport>("pty");
  const [worktreeAutoCleanup, setWorktreeAutoCleanup] = useState(false);
  const [taskFilesToDisk, setTaskFilesToDisk] = useState(true);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [taskConflicts, setTaskConflicts] = useState<TaskConflict[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load per-project settings
  useEffect(() => {
    invoke<string | null>("get_project_setting", {
      projectId,
      key: "default_transport",
    })
      .then((val) => setDefaultTransport((val as SessionTransport) || "pty"))
      .catch(() => {});
    invoke<string | null>("get_project_setting", {
      projectId,
      key: "worktree_auto_cleanup",
    })
      .then((val) => setWorktreeAutoCleanup(val === "true"))
      .catch(() => {});
    invoke<string | null>("get_project_setting", {
      projectId,
      key: "task_files_to_disk",
    })
      .then((val) => setTaskFilesToDisk(val !== "false"))
      .catch(() => {});
  }, [projectId]);

  const handleUpdate = useCallback(
    async (updates: Record<string, unknown>) => {
      try {
        const result = await invoke<Project>("update_project", {
          id: projectId,
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
    [projectId, updateProjectInStore],
  );

  const handleDelete = useCallback(async () => {
    try {
      await invoke("remove_project", { id: projectId });
      removeProjectFromStore(projectId);
      onDismiss();
    } catch (e) {
      console.error("Failed to remove project:", e);
      useAppStore
        .getState()
        .flashError(`Failed to remove project: ${formatError(e)}`);
    }
  }, [projectId, removeProjectFromStore, onDismiss]);

  const handleTransportChange = useCallback(
    (value: SessionTransport) => {
      setDefaultTransport(value);
      invoke("set_project_setting", {
        projectId,
        key: "default_transport",
        value,
      }).catch(() => {});
    },
    [projectId],
  );

  const handleWorktreeAutoCleanupChange = useCallback(
    (value: boolean) => {
      setWorktreeAutoCleanup(value);
      invoke("set_project_setting", {
        projectId,
        key: "worktree_auto_cleanup",
        value: value ? "true" : "false",
      }).catch(() => {});
    },
    [projectId],
  );

  const handleTaskFilesToDiskChange = useCallback(
    async (value: boolean) => {
      if (value) {
        // Re-enabling: check for conflicts first
        try {
          const detected = await invoke<TaskConflict[]>(
            "detect_task_conflicts",
            { projectId },
          );
          if (detected.length > 0) {
            setTaskConflicts(detected);
            setConflictDialogOpen(true);
            return; // Don't toggle yet — wait for resolution
          }
        } catch (e) {
          console.error("Failed to detect conflicts:", e);
        }
      }
      // Disabling or no conflicts: proceed normally
      setTaskFilesToDisk(value);
      invoke("set_project_setting", {
        projectId,
        key: "task_files_to_disk",
        value: value ? "true" : "false",
      }).catch(() => {});
    },
    [projectId],
  );

  const selectedAgent = agents.find((a) => a.name === agent);
  const availableModels = selectedAgent?.supported_models ?? [];

  const handleAgentChange = useCallback(
    (value: string) => {
      setAgent(value);
      setModel("");
      handleUpdate({
        defaultAgent: value ? value : null,
        defaultModel: null,
      });
    },
    [handleUpdate],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      setModel(value);
      handleUpdate({ defaultModel: value ? value : null });
    },
    [handleUpdate],
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

  const handlePickIcon = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (selected) {
        clearIconCache(projectId);
        handleUpdate({ iconPath: selected });
      }
    } catch {
      // User cancelled
    }
  }, [projectId, handleUpdate]);

  const handleClearIcon = useCallback(() => {
    clearIconCache(projectId);
    handleUpdate({ iconPath: null });
  }, [projectId, handleUpdate]);

  if (!project) return null;

  const themeColor = (project.color as ThemeColor) || "primary";
  const accentHex =
    gradientHexColors[themeColor]?.start ?? gradientHexColors.primary.start;

  const panelClass =
    "rounded-lg bg-muted/20 ring-1 ring-border/30 p-4 flex flex-col gap-4";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <div
              className="flex items-center justify-center size-7 rounded-md shrink-0"
              style={{ backgroundColor: `${accentHex}18` }}
            >
              <ProjectIconPreview project={project} accentHex={accentHex} />
            </div>
            {project.name}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto -mx-6 px-6 flex flex-col gap-4 pb-2">
          {/* ── Appearance ── */}
          <div className={panelClass}>
            <div className={sectionHeadingClass}>Appearance</div>
            <div className="grid grid-cols-[1fr_1fr] gap-4">
              {/* Icon */}
              <div className="flex flex-col gap-2">
                <span className="text-[12px] text-dim-foreground font-medium">
                  Icon
                </span>
                <div className="flex items-center gap-2">
                  <div className="size-9 rounded-[var(--radius-element)] bg-background border border-border flex items-center justify-center shrink-0 overflow-hidden">
                    <ProjectIconPreview
                      project={project}
                      accentHex={accentHex}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePickIcon}
                        leftIcon={<Image className="size-3" />}
                        className="h-6 px-2 text-[11px]"
                      >
                        Choose SVG
                      </Button>
                      {project.icon_path && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleClearIcon}
                          leftIcon={<X className="size-3" />}
                          className="h-6 px-1.5 text-[11px]"
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-48">
                      {project.icon_path
                        ? project.icon_path.split(/[\\/]/).pop()
                        : "Auto-detected from project"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Color */}
              <div className="flex flex-col gap-2">
                <span className="text-[12px] text-dim-foreground font-medium">
                  Color
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {TAB_COLORS.map((c) => {
                    const hex = gradientHexColors[c.value];
                    const isActive = project.color === c.value;
                    return (
                      <button
                        key={c.value}
                        onClick={() => handleUpdate({ color: c.value })}
                        title={c.label}
                        className={`size-[20px] rounded-full cursor-pointer p-0 transition-[box-shadow,border-color] duration-150 ${isActive ? "border-2 border-foreground" : "border border-transparent"}`}
                        style={{
                          background: `linear-gradient(135deg, ${hex.start}, ${hex.end})`,
                          outline: isActive ? "2px solid transparent" : "none",
                          outlineOffset: 1,
                          boxShadow: isActive
                            ? `0 0 0 2px var(--card), 0 0 0 3px ${hex.start}`
                            : "none",
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── Agent Defaults ── */}
          <div className={panelClass}>
            <div className={sectionHeadingClass}>Agent Defaults</div>

            {/* Agent + Model row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-dim-foreground font-medium">
                  Agent
                </span>
                <Select
                  value={agent || "__global__"}
                  onValueChange={(val) =>
                    handleAgentChange(!val || val === "__global__" ? "" : val)
                  }
                  items={[
                    { value: "__global__", label: "Use global default" },
                    ...agents.map((a) => ({
                      value: a.name,
                      label: `${a.display_name}${a.installed ? "" : " (not installed)"}`,
                    })),
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <Bot className="size-3.5 text-muted-foreground" />
                    <SelectValue placeholder="Use global default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__global__">
                      Use global default
                    </SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.name} value={a.name}>
                        {a.display_name}
                        {a.installed ? "" : " (not installed)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-dim-foreground font-medium">
                  Model
                </span>
                <Select
                  value={model || "__default__"}
                  onValueChange={(val) =>
                    handleModelChange(!val || val === "__default__" ? "" : val)
                  }
                  disabled={!agent || availableModels.length === 0}
                  items={[
                    { value: "__default__", label: "Default" },
                    ...availableModels.map((m) => ({ value: m, label: m })),
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <Cpu className="size-3.5 text-muted-foreground" />
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default</SelectItem>
                    {availableModels.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Transport */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] text-dim-foreground font-medium">
                Transport
              </span>
              <div className="flex rounded-[var(--radius-element)] bg-background/50 p-0.5 ring-1 ring-border/40">
                <button
                  type="button"
                  onClick={() => handleTransportChange("pty")}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-element)-2px)] px-3 py-1.5 text-xs transition-all duration-150 ${
                    defaultTransport === "pty"
                      ? `bg-linear-to-r ${solidColorGradients[themeColor]} ${colorStyles[themeColor].text} shadow-sm font-medium`
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Terminal size={13} />
                  Terminal
                </button>
                <button
                  type="button"
                  onClick={() => handleTransportChange("acp")}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-element)-2px)] px-3 py-1.5 text-xs transition-all duration-150 ${
                    defaultTransport === "acp"
                      ? `bg-linear-to-r ${solidColorGradients[themeColor]} ${colorStyles[themeColor].text} shadow-sm font-medium`
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <MessageSquare size={13} />
                  Chat
                </button>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Pre-selects the transport mode when launching new sessions
              </span>
            </div>
          </div>

          {/* ── Git & Workflow ── */}
          <div className={panelClass}>
            <div className={sectionHeadingClass}>Git &amp; Workflow</div>

            {/* Branch + Instruction in 2-col */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-dim-foreground font-medium">
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
                <span className="text-[10px] text-muted-foreground">
                  Variables: {"{{task_id}}"}, {"{{task_slug}}"}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-dim-foreground font-medium">
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
                <span className="text-[10px] text-muted-foreground">
                  Relative path from project root
                </span>
              </div>
            </div>

            {/* Toggles */}
            <Separator />
            <ToggleRow
              label="Save task files to disk"
              description="Write .agents/tasks/ markdown files and TODOS.md so tasks appear in git"
              checked={taskFilesToDisk}
              onChange={handleTaskFilesToDiskChange}
            />
            <ToggleRow
              label="Auto-cleanup worktrees"
              description="Remove worktrees when sessions stop. Worktrees with uncommitted changes are preserved."
              checked={worktreeAutoCleanup}
              onChange={handleWorktreeAutoCleanupChange}
            />
          </div>

          {/* ── Danger Zone ── */}
          <div className="rounded-lg ring-1 ring-destructive/20 p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-destructive">
                Delete Project
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Remove from Faber. Files on disk are not affected.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {confirmDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  className="h-7"
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                leftIcon={<Trash2 className="size-3.5" />}
                className="h-7"
                onClick={() => {
                  if (confirmDelete) {
                    handleDelete();
                  } else {
                    setConfirmDelete(true);
                  }
                }}
              >
                {confirmDelete ? "Confirm" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      <TaskFileConflictDialog
        open={conflictDialogOpen}
        onClose={() => setConflictDialogOpen(false)}
        onResolved={() => {
          setTaskFilesToDisk(true);
          invoke("set_project_setting", {
            projectId,
            key: "task_files_to_disk",
            value: "true",
          }).catch(() => {});
          setConflictDialogOpen(false);
        }}
        projectId={projectId}
        conflicts={taskConflicts}
      />
    </Dialog>
  );
}
