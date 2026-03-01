import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  Cpu,
  ExternalLink,
  FileText,
  FolderCode,
  GitBranch,
  Github,
  Image,
  Loader2,
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
import { Card, CardContent } from "../ui/orecus.io/cards/card";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { gradientHexColors } from "../ui/orecus.io/lib/color-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import { sectionHeadingClass } from "./shared";

import type { AgentInfo, GitHubLabelFull, GitHubLabelMapping, Project, TaskStatus } from "../../types";
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

// ── Project Settings Card ──

function ProjectSettingsCard({
  project,
  agents,
  isOpen,
  onUpdate,
  onDelete,
  onOpen,
}: {
  project: Project;
  agents: AgentInfo[];
  isOpen: boolean;
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [agent, setAgent] = useState(project.default_agent ?? "");
  const [model, setModel] = useState(project.default_model ?? "");
  const [branchPattern, setBranchPattern] = useState(
    project.branch_naming_pattern ?? "feat/{{task_id}}-{{task_slug}}",
  );
  const [instructionFile, setInstructionFile] = useState(
    // Normalize backslashes to forward slashes for display
    (project.instruction_file_path ?? "").replace(/\\/g, "/"),
  );
  const [worktreeAutoCleanup, setWorktreeAutoCleanup] = useState(false);
  const [taskFilesToDisk, setTaskFilesToDisk] = useState(true);

  // Load per-project settings
  useEffect(() => {
    invoke<string | null>("get_project_setting", {
      projectId: project.id,
      key: "worktree_auto_cleanup",
    })
      .then((val) => setWorktreeAutoCleanup(val === "true"))
      .catch(() => {});
    invoke<string | null>("get_project_setting", {
      projectId: project.id,
      key: "task_files_to_disk",
    })
      .then((val) => setTaskFilesToDisk(val !== "false"))
      .catch(() => {});
  }, [project.id]);

  const handleWorktreeAutoCleanupChange = useCallback(
    (value: boolean) => {
      setWorktreeAutoCleanup(value);
      invoke("set_project_setting", {
        projectId: project.id,
        key: "worktree_auto_cleanup",
        value: value ? "true" : "false",
      }).catch(() => {});
    },
    [project.id],
  );

  const handleTaskFilesToDiskChange = useCallback(
    (value: boolean) => {
      setTaskFilesToDisk(value);
      invoke("set_project_setting", {
        projectId: project.id,
        key: "task_files_to_disk",
        value: value ? "true" : "false",
      }).catch(() => {});
    },
    [project.id],
  );

  const selectedAgent = agents.find((a) => a.name === agent);
  const availableModels = selectedAgent?.supported_models ?? [];

  const handleAgentChange = useCallback(
    (value: string) => {
      setAgent(value);
      setModel("");
      onUpdate(project.id, {
        defaultAgent: value ? value : null,
        defaultModel: null,
      });
    },
    [project.id, onUpdate],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      setModel(value);
      onUpdate(project.id, { defaultModel: value ? value : null });
    },
    [project.id, onUpdate],
  );

  const handleBranchPatternBlur = useCallback(() => {
    onUpdate(project.id, {
      branchNamingPattern: branchPattern ? branchPattern : null,
    });
  }, [project.id, branchPattern, onUpdate]);

  const handleInstructionFileBlur = useCallback(() => {
    const normalized = instructionFile.replace(/\\/g, "/");
    onUpdate(project.id, {
      instructionFilePath: normalized ? normalized : null,
    });
  }, [project.id, instructionFile, onUpdate]);

  const handlePickIcon = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (selected) {
        const filePath = selected;
        clearIconCache(project.id);
        onUpdate(project.id, { iconPath: filePath });
      }
    } catch {
      // User cancelled
    }
  }, [project.id, onUpdate]);

  const handleClearIcon = useCallback(() => {
    clearIconCache(project.id);
    onUpdate(project.id, { iconPath: null });
  }, [project.id, onUpdate]);

  const themeColor = (project.color as ThemeColor) || "primary";
  const accentHex =
    gradientHexColors[themeColor]?.start ?? gradientHexColors.primary.start;

  return (
    <Card
      type="normal"
      radius="lg"
      border
      accentBar="top"
      accentBarVariant="solid"
      accentColor={themeColor}
    >
      {/* Card header */}
      <CardContent
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center justify-between cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center size-8 rounded-md shrink-0 transition-colors duration-150"
            style={{ backgroundColor: `${accentHex}18` }}
          >
            <ProjectIconPreview project={project} accentHex={accentHex} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-medium text-foreground truncate">
              {project.name}
            </span>
            <span className="text-[11px] text-muted-foreground truncate">
              {project.path}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!isOpen && (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ExternalLink className="size-3" />}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(project.id);
              }}
              className="text-[11px] h-6 px-2"
            >
              Open
            </Button>
          )}
          <ChevronDown
            size={14}
            className="text-muted-foreground transition-transform duration-150"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </div>
      </CardContent>

      {/* Card body */}
      {expanded && (
        <div className="border-t border-border px-6 py-4 flex flex-col gap-5">
          {/* Icon settings */}
          <section>
            <div className={`${sectionHeadingClass} mb-2.5`}>Project Icon</div>
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-[var(--radius-element)] bg-background border border-border flex items-center justify-center shrink-0 overflow-hidden">
                <ProjectIconPreview project={project} accentHex={accentHex} />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePickIcon}
                leftIcon={<Image className="size-3.5" />}
              >
                Choose SVG
              </Button>
              {project.icon_path && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearIcon}
                  leftIcon={<X className="size-3.5" />}
                >
                  Reset
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground">
                {project.icon_path
                  ? project.icon_path.split(/[\\/]/).pop()
                  : "Auto-detected"}
              </span>
            </div>
          </section>

          {/* Tab Color */}
          <section>
            <div className={`${sectionHeadingClass} mb-2.5`}>Tab Color</div>
            <div className="flex flex-nowrap gap-1.5">
              {TAB_COLORS.map((c) => {
                const hex = gradientHexColors[c.value];
                const isActive = project.color === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => onUpdate(project.id, { color: c.value })}
                    title={c.label}
                    className={`size-[22px] rounded-full cursor-pointer p-0 transition-[box-shadow,border-color] duration-150 ${isActive ? "border-2 border-foreground" : "border border-transparent"}`}
                    style={{
                      background: `linear-gradient(135deg, ${hex.start}, ${hex.end})`,
                      outline: isActive ? "2px solid transparent" : "none",
                      outlineOffset: 1,
                      boxShadow: isActive
                        ? `0 0 0 2px var(--card), 0 0 0 4px ${hex.start}`
                        : "none",
                    }}
                  />
                );
              })}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1.5">
              Sets the accent color for this project&apos;s tab indicator.
            </div>
          </section>

          {/* Default Agent */}
          <section>
            <div className={`${sectionHeadingClass} mb-2.5`}>Default Agent</div>
            <div className="max-w-80">
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
                  <Bot className="size-4 text-muted-foreground" />
                  <SelectValue placeholder="Use global default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__global__">Use global default</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.name} value={a.name}>
                      {a.display_name}
                      {a.installed ? "" : " (not installed)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* Default Model */}
          {agent && availableModels.length > 0 && (
            <section>
              <div className={`${sectionHeadingClass} mb-2.5`}>
                Default Model
              </div>
              <div className="max-w-80">
                <Select
                  value={model || "__default__"}
                  onValueChange={(val) =>
                    handleModelChange(!val || val === "__default__" ? "" : val)
                  }
                  items={[
                    { value: "__default__", label: "Default" },
                    ...availableModels.map((m) => ({ value: m, label: m })),
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <Cpu className="size-4 text-muted-foreground" />
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
            </section>
          )}

          {/* Branch Naming Pattern */}
          <section>
            <div className={`${sectionHeadingClass} mb-2.5`}>
              Branch Naming Pattern
            </div>
            <InputGroup className="max-w-[420px]">
              <InputGroupAddon align="inline-start">
                <GitBranch className="size-4" />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                value={branchPattern}
                onChange={(e) => setBranchPattern(e.target.value)}
                onBlur={handleBranchPatternBlur}
                placeholder="feat/{{task_id}}-{{task_slug}}"
              />
            </InputGroup>
            <div className="text-[11px] text-muted-foreground mt-1.5">
              Available variables: {"{{task_id}}"}, {"{{task_slug}}"}
            </div>
          </section>

          {/* Instruction File */}
          <section>
            <div className={`${sectionHeadingClass} mb-2.5`}>
              Instruction File
            </div>
            <InputGroup className="max-w-[420px]">
              <InputGroupAddon align="inline-start">
                <FileText className="size-4" />
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
            <div className="text-[11px] text-muted-foreground mt-1.5">
              Relative path from project root. Leave empty for auto-detection.
            </div>
          </section>

          {/* Task Storage */}
          <section>
            <div className={`${sectionHeadingClass} mb-2.5`}>Task Storage</div>
            <ToggleRow
              label="Save task files to disk"
              description="Write task markdown files to .agents/tasks/ and generate TODOS.md. When disabled, tasks are stored in the database only and won't appear in git."
              checked={taskFilesToDisk}
              onChange={handleTaskFilesToDiskChange}
            />
          </section>

          {/* Worktree Settings */}
          <section>
            <div className={`${sectionHeadingClass} mb-2.5`}>Worktrees</div>
            <ToggleRow
              label="Auto-cleanup worktrees when sessions stop"
              description="Automatically remove worktrees when sessions are stopped. Worktrees with uncommitted changes are always preserved."
              checked={worktreeAutoCleanup}
              onChange={handleWorktreeAutoCleanupChange}
            />
          </section>

          {/* GitHub Sync */}
          <Separator className="mt-1" />
          <GitHubSyncSection projectId={project.id} />

          {/* Delete Project */}
          <Separator className="mt-1" />
          <section className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-foreground">
                  Delete Project
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Remove this project from Faber. This does not delete any
                  files on disk.
                </div>
              </div>
              <div className="flex items-center gap-2">
                {confirmDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  leftIcon={<Trash2 className="size-3.5" />}
                  onClick={() => {
                    if (confirmDelete) {
                      onDelete(project.id);
                    } else {
                      setConfirmDelete(true);
                    }
                  }}
                >
                  {confirmDelete ? "Confirm Delete" : "Delete Project"}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </Card>
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

// ── GitHub Sync Section ──

const TASK_STATUSES: TaskStatus[] = [
  "backlog",
  "ready",
  "in-progress",
  "in-review",
  "done",
];

function GitHubSyncSection({ projectId }: { projectId: string }) {
  const ghAuthStatus = useAppStore((s) => s.ghAuthStatus);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [autoClose, setAutoClose] = useState(true);
  const [autoReopen, setAutoReopen] = useState(true);
  const [prClosesRef, setPrClosesRef] = useState(true);
  const [labelSync, setLabelSync] = useState(false);
  const [mergeDetection, setMergeDetection] = useState(true);
  const [labelMapping, setLabelMapping] = useState<GitHubLabelMapping>({});
  const [repoLabels, setRepoLabels] = useState<GitHubLabelFull[]>([]);
  const [fetchingLabels, setFetchingLabels] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const get = (key: string) =>
          invoke<string | null>("get_project_setting", { projectId, key });

        const [se, ac, ar, pcr, ls, md, lm] = await Promise.all([
          get("github_sync_enabled"),
          get("github_auto_close"),
          get("github_auto_reopen"),
          get("github_pr_closes_ref"),
          get("github_label_sync"),
          get("github_merge_detection"),
          get("github_label_mapping"),
        ]);

        if (cancelled) return;
        setSyncEnabled(se === "true");
        setAutoClose(ac !== "false");
        setAutoReopen(ar !== "false");
        setPrClosesRef(pcr !== "false");
        setLabelSync(ls === "true");
        setMergeDetection(md !== "false");
        if (lm) {
          try {
            setLabelMapping(JSON.parse(lm));
          } catch {
            // ignore
          }
        }
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  const saveSetting = useCallback(
    (key: string, value: string) => {
      invoke("set_project_setting", { projectId, key, value }).catch(() => {});
    },
    [projectId],
  );

  const handleToggle = useCallback(
    (key: string, setter: (v: boolean) => void, value: boolean) => {
      setter(value);
      saveSetting(key, value ? "true" : "false");
    },
    [saveSetting],
  );

  const handleFetchLabels = useCallback(async () => {
    setFetchingLabels(true);
    try {
      const labels = await invoke<GitHubLabelFull[]>("fetch_repo_labels", {
        projectId,
      });
      setRepoLabels(labels);
    } catch {
      // ignore
    } finally {
      setFetchingLabels(false);
    }
  }, [projectId]);

  const handleLabelMappingChange = useCallback(
    (status: TaskStatus, label: string) => {
      setLabelMapping((prev) => {
        const next = { ...prev };
        if (label) {
          next[status] = label;
        } else {
          delete next[status];
        }
        saveSetting("github_label_mapping", JSON.stringify(next));
        return next;
      });
    },
    [saveSetting],
  );

  if (!loaded) return null;

  return (
    <section className="pt-3">
      <div className={`${sectionHeadingClass} mb-2.5 flex items-center gap-2`}>
        <Github className="size-4" />
        GitHub Sync
      </div>

      {/* Auth warning */}
      {ghAuthStatus && (!ghAuthStatus.installed || !ghAuthStatus.authenticated || ghAuthStatus.has_scope_warnings) && (
        <div className="flex items-start gap-2 rounded-md px-3 py-2 mb-2 text-xs bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] text-warning">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          <span>
            {!ghAuthStatus.installed
              ? "GitHub CLI (gh) is not installed. GitHub sync features will not work."
              : !ghAuthStatus.authenticated
                ? "GitHub CLI is not authenticated. Run `gh auth login` to enable sync."
                : `Token is missing required scopes: ${ghAuthStatus.missing_scopes.join(", ")}. Some sync features may fail.`}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <ToggleRow
          label="Enable GitHub Sync"
          description="Sync task status changes to linked GitHub issues"
          checked={syncEnabled}
          onChange={(v) => handleToggle("github_sync_enabled", setSyncEnabled, v)}
        />

        {syncEnabled && (
          <div className="ml-3 border-l-2 border-border pl-4 flex flex-col gap-1 mt-1">
            <ToggleRow
              label="Auto-close issues"
              description="Close GitHub issue when task moves to Done (without a PR)"
              checked={autoClose}
              onChange={(v) =>
                handleToggle("github_auto_close", setAutoClose, v)
              }
            />
            <ToggleRow
              label="Auto-reopen issues"
              description="Reopen GitHub issue when task moves back from Done"
              checked={autoReopen}
              onChange={(v) =>
                handleToggle("github_auto_reopen", setAutoReopen, v)
              }
            />
            <ToggleRow
              label='Add "Closes #N" to PR body'
              description="Pre-populate PR description with close reference"
              checked={prClosesRef}
              onChange={(v) =>
                handleToggle("github_pr_closes_ref", setPrClosesRef, v)
              }
            />
            <ToggleRow
              label="Auto-detect merged PRs"
              description="Check PR status on Review refresh"
              checked={mergeDetection}
              onChange={(v) =>
                handleToggle("github_merge_detection", setMergeDetection, v)
              }
            />
            <ToggleRow
              label="Sync status labels"
              description="Add/remove labels on GitHub issues when task status changes"
              checked={labelSync}
              onChange={(v) =>
                handleToggle("github_label_sync", setLabelSync, v)
              }
            />

            {labelSync && (
              <div className="mt-2 ml-1">
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFetchLabels}
                    loading={fetchingLabels}
                    leftIcon={
                      fetchingLabels ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : undefined
                    }
                  >
                    {repoLabels.length > 0
                      ? "Refresh Labels"
                      : "Fetch Labels"}
                  </Button>
                  {repoLabels.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {repoLabels.length} labels available
                    </span>
                  )}
                </div>

                {repoLabels.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {TASK_STATUSES.map((status) => (
                      <div
                        key={status}
                        className="flex items-center gap-3"
                      >
                        <span className="text-[12px] text-dim-foreground w-24 shrink-0">
                          {status}
                        </span>
                        <select
                          value={labelMapping[status] ?? ""}
                          onChange={(e) =>
                            handleLabelMappingChange(
                              status,
                              e.target.value,
                            )
                          }
                          className="flex-1 max-w-60 h-7 rounded-[var(--radius-element)] border border-border bg-popover px-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">None</option>
                          {repoLabels.map((l) => (
                            <option key={l.name} value={l.name}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Projects Tab ──

export function ProjectsTab({ agents, onClose }: { agents: AgentInfo[]; onClose?: () => void }) {
  const projects = useAppStore((s) => s.projects);
  const openProjectIds = useAppStore((s) => s.openProjectIds);
  const openProject = useAppStore((s) => s.openProject);
  const updateProjectInStore = useAppStore((s) => s.updateProject);
  const removeProjectFromStore = useAppStore((s) => s.removeProject);

  const handleUpdateProject = useCallback(
    async (id: string, updates: Record<string, unknown>) => {
      try {
        const result = await invoke<Project>("update_project", {
          id,
          ...updates,
        });
        updateProjectInStore(result);
      } catch (e) {
        console.error("Failed to update project:", e);
        useAppStore.getState().flashError(`Failed to update project: ${e}`);
      }
    },
    [updateProjectInStore],
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      try {
        await invoke("remove_project", { id });
        removeProjectFromStore(id);
      } catch (e) {
        console.error("Failed to remove project:", e);
        useAppStore.getState().flashError(`Failed to remove project: ${e}`);
      }
    },
    [removeProjectFromStore],
  );

  const handleOpenProject = useCallback(
    (id: string) => {
      openProject(id);
      onClose?.();
    },
    [openProject, onClose],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Per-project settings */}
      <section>
        <div className={sectionHeadingClass}>Project Configuration</div>
        {projects.length === 0 ? (
          <div className="text-[13px] text-muted-foreground py-3">
            No projects added yet. Add a project from the tab bar to configure
            it here.
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-1">
            {projects.map((project) => (
              <ProjectSettingsCard
                key={project.id}
                project={project}
                agents={agents}
                isOpen={openProjectIds.includes(project.id)}
                onUpdate={handleUpdateProject}
                onDelete={handleDeleteProject}
                onOpen={handleOpenProject}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
