import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Play, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
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
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";

import type { GitHubIssueCreated, Priority, Task } from "../../types";

interface CreateTaskDialogProps {
  onDismiss: () => void;
  /** Called after "Create & Start" — receives the new task ID so the parent can open LaunchTaskDialog */
  onStartTask?: (taskId: string) => void;
}

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "P0", label: "P0 — Critical" },
  { value: "P1", label: "P1 — High" },
  { value: "P2", label: "P2 — Normal" },
];

const DEFAULT_BODY_TEMPLATE = `## Objective\n\n\n\n## Acceptance Criteria\n\n- [ ] \n\n## Implementation Plan\n\n1. `;

export default function CreateTaskDialog({
  onDismiss,
  onStartTask,
}: CreateTaskDialogProps) {
  const accentColor = useProjectAccentColor();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setTasks = useAppStore((s) => s.setTasks);
  const setActiveTask = useAppStore((s) => s.setActiveTask);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

  const tasks = useAppStore((s) => s.tasks);
  const installedAgents = useAppStore((s) => s.agents).filter((a) => a.installed);

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("P2");
  const [body, setBody] = useState(DEFAULT_BODY_TEMPLATE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ghAuthStatus = useAppStore((s) => s.ghAuthStatus);
  const [ghSyncAvailable, setGhSyncAvailable] = useState(false);
  const [createAsIssue, setCreateAsIssue] = useState(false);

  // Advanced fields
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [labelsInput, setLabelsInput] = useState("");
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("");

  // Check if GitHub sync is available for this project.
  // If the project has an explicit github_sync setting, use it.
  // Otherwise, fall back to the store's ghAuthStatus (no redundant IPC call).
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;

    (async () => {
      try {
        // Check explicit project setting first
        const val = await invoke<string | null>("get_project_setting", {
          projectId: activeProjectId,
          key: "github_sync",
        });

        if (val === "false" || val === "0") {
          if (!cancelled) {
            setGhSyncAvailable(false);
            setCreateAsIssue(false);
          }
          return;
        }

        if (val === "true" || val === "1") {
          // Explicitly enabled — but still check auth is actually working
          const authOk = ghAuthStatus?.authenticated && !ghAuthStatus.has_scope_warnings;
          if (!cancelled) {
            setGhSyncAvailable(!!authOk);
            setCreateAsIssue(!!authOk);
          }
          return;
        }

        // No explicit setting — use store auth status
        const authOk = ghAuthStatus?.authenticated && !ghAuthStatus.has_scope_warnings;
        if (!cancelled) {
          setGhSyncAvailable(!!authOk);
          setCreateAsIssue(!!authOk);
        }
      } catch {
        const authOk = ghAuthStatus?.authenticated && !ghAuthStatus.has_scope_warnings;
        if (!cancelled) {
          setGhSyncAvailable(!!authOk);
          setCreateAsIssue(!!authOk);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeProjectId, ghAuthStatus]);

  const canCreate = title.trim().length > 0 && !creating;

  /** Returns trimmed body or null if unchanged from template / empty */
  const getBodyParam = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed || trimmed === DEFAULT_BODY_TEMPLATE.trim()) return null;
    return trimmed;
  }, [body]);

  const parsedLabels = labelsInput
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const hasAdvancedFields = parsedLabels.length > 0 || selectedDeps.length > 0 || selectedAgent !== "";

  /** Core create logic — returns the created task or null on error */
  const createTask = useCallback(async (): Promise<Task | null> => {
    if (!canCreate || !activeProjectId) return null;
    setError(null);
    setCreating(true);
    addBackgroundTask("Creating task");
    try {
      let task = await invoke<Task>("create_task", {
        projectId: activeProjectId,
        title: title.trim(),
        priority,
        body: getBodyParam(),
      });

      // If advanced fields were set, update the task file
      if (hasAdvancedFields) {
        task = await invoke<Task>("save_task_content", {
          projectId: activeProjectId,
          taskId: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          agent: selectedAgent || null,
          model: null,
          branch: null,
          githubIssue: null,
          dependsOn: selectedDeps,
          labels: parsedLabels,
          body: getBodyParam() || "",
        });
      }

      // Re-fetch tasks
      const freshTasks = await invoke<Task[]>("list_tasks", {
        projectId: activeProjectId,
      });
      setTasks(freshTasks);
      return task;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setCreating(false);
      removeBackgroundTask("Creating task");
    }
  }, [
    canCreate,
    activeProjectId,
    title,
    priority,
    getBodyParam,
    hasAdvancedFields,
    parsedLabels,
    selectedDeps,
    selectedAgent,
    setTasks,
    addBackgroundTask,
    removeBackgroundTask,
  ]);

  /** Optionally create a GitHub issue and link it to the task */
  const syncToGitHub = useCallback(
    async (task: Task) => {
      if (!createAsIssue || !activeProjectId) return;
      try {
        const result = await invoke<GitHubIssueCreated>(
          "create_github_issue",
          {
            projectId: activeProjectId,
            title: task.title,
            body: body.trim() || undefined,
            labels: undefined,
          },
        );
        // Detect repo slug for the issue ref
        const repoSlug = result.url
          .replace("https://github.com/", "")
          .split("/issues/")[0];
        const issueRef = `${repoSlug}#${result.number}`;
        // Update the task file with the github_issue field
        await invoke("save_task_content", {
          projectId: activeProjectId,
          taskId: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          agent: task.agent || null,
          model: task.model || null,
          branch: task.branch || null,
          githubIssue: issueRef,
          dependsOn: task.depends_on,
          labels: task.labels,
          body: body.trim() || "",
        });
        // Re-fetch tasks to update store
        const freshTasks = await invoke<Task[]>("list_tasks", {
          projectId: activeProjectId,
        });
        setTasks(freshTasks);
      } catch (err) {
        // Non-fatal: task was created, just log the sync failure
        console.warn("GitHub issue sync failed:", err);
      }
    },
    [createAsIssue, activeProjectId, body, setTasks],
  );

  /** "Create" — saves task and navigates to task detail */
  const handleCreate = useCallback(async () => {
    const task = await createTask();
    if (!task) return;
    await syncToGitHub(task);
    setActiveTask(task.id);
    setActiveView("task-detail");
    onDismiss();
  }, [createTask, syncToGitHub, setActiveTask, setActiveView, onDismiss]);

  /** "Create & Start" — saves task (as ready) and triggers LaunchTaskDialog */
  const handleCreateAndStart = useCallback(async () => {
    const task = await createTask();
    if (!task) return;
    await syncToGitHub(task);

    // Move to ready status so it can be launched
    try {
      if (task.status !== "ready") {
        await invoke<Task>("update_task_status", {
          projectId: activeProjectId,
          taskId: task.id,
          status: "ready",
        });
        // Re-fetch to get updated status
        const freshTasks = await invoke<Task[]>("list_tasks", {
          projectId: activeProjectId,
        });
        setTasks(freshTasks);
      }
    } catch {
      // Task was created — still proceed to launch
    }

    onDismiss();
    onStartTask?.(task.id);
  }, [createTask, activeProjectId, setTasks, onDismiss, onStartTask]);

  // Enter on title submits; Ctrl+Enter anywhere submits
  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && canCreate) {
        e.preventDefault();
        handleCreate();
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canCreate) {
        e.preventDefault();
        handleCreate();
      }
    },
    [canCreate, handleCreate],
  );

  // Ctrl+Enter in textarea submits
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canCreate) {
        e.preventDefault();
        handleCreate();
      }
    },
    [canCreate, handleCreate],
  );

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
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>

        {/* Title */}
        <div>
          <label className="mb-1 block text-xs text-dim-foreground">
            Title
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            placeholder="Task title"
            autoFocus
          />
        </div>

        {/* Priority */}
        <div>
          <label className="mb-1 block text-xs text-dim-foreground">
            Priority
          </label>
          <Select
            value={priority}
            onValueChange={(v) => {
              if (v) setPriority(v as Priority);
            }}
            items={PRIORITY_OPTIONS}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Body template */}
        <div>
          <label className="mb-1 block text-xs text-dim-foreground">
            Description
          </label>
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Describe the task..."
            className="min-h-[160px] max-h-[320px] resize-y overflow-y-auto font-mono text-xs leading-relaxed"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Ctrl+Enter to create
          </p>
        </div>

        {/* Advanced fields toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
        >
          <ChevronDown
            className={`size-3 transition-transform duration-150 ${showAdvanced ? "rotate-0" : "-rotate-90"}`}
          />
          Advanced
          {hasAdvancedFields && (
            <span className="size-1.5 rounded-full bg-primary" />
          )}
        </button>

        {showAdvanced && (
          <div className="space-y-3 rounded-[var(--radius-element)] border border-border p-3">
            {/* Labels */}
            <div>
              <label className="mb-1 block text-xs text-dim-foreground">
                Labels
              </label>
              <Input
                value={labelsInput}
                onChange={(e) => setLabelsInput(e.target.value)}
                placeholder="frontend, api, ux"
                className="text-xs"
              />
              {parsedLabels.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {parsedLabels.map((label) => (
                    <Badge
                      key={label}
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Dependencies */}
            <div>
              <label className="mb-1 block text-xs text-dim-foreground">
                Depends on
              </label>
              <Select
                value="__placeholder__"
                onValueChange={(v) => {
                  if (v && v !== "__placeholder__" && !selectedDeps.includes(v)) {
                    setSelectedDeps((prev) => [...prev, v]);
                  }
                }}
                items={[
                  { value: "__placeholder__", label: "Add dependency…" },
                  ...tasks
                    .filter((t) => !selectedDeps.includes(t.id))
                    .map((t) => ({ value: t.id, label: `${t.id} — ${t.title}` })),
                ]}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue placeholder="Add dependency…" />
                </SelectTrigger>
                <SelectContent>
                  {tasks
                    .filter((t) => !selectedDeps.includes(t.id))
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="font-mono text-muted-foreground mr-1">{t.id}</span>
                        {t.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {selectedDeps.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {selectedDeps.map((depId) => {
                    const depTask = tasks.find((t) => t.id === depId);
                    return (
                      <Badge
                        key={depId}
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 gap-1 cursor-pointer"
                        onClick={() =>
                          setSelectedDeps((prev) =>
                            prev.filter((d) => d !== depId),
                          )
                        }
                      >
                        {depTask ? `${depId} ${depTask.title}` : depId}
                        <X className="size-2.5" />
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Agent */}
            {installedAgents.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-dim-foreground">
                  Agent
                </label>
                <Select
                  value={selectedAgent || "__none__"}
                  onValueChange={(v) =>
                    setSelectedAgent(!v || v === "__none__" ? "" : v)
                  }
                  items={[
                    { value: "__none__", label: "None" },
                    ...installedAgents.map((a) => ({
                      value: a.name,
                      label: a.display_name,
                    })),
                  ]}
                >
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {installedAgents.map((a) => (
                      <SelectItem key={a.name} value={a.name}>
                        {a.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* GitHub sync checkbox */}
        {ghSyncAvailable && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={createAsIssue}
              onChange={(e) => setCreateAsIssue(e.target.checked)}
              className="size-3.5 rounded border-border accent-primary"
            />
            <span className="text-xs text-dim-foreground">
              Create as GitHub Issue
            </span>
          </label>
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canCreate}
              loading={creating}
              onClick={handleCreate}
              leftIcon={<Plus className="size-3.5" />}
              hoverEffect="scale"
              clickEffect="scale"
            >
              Create
            </Button>
            {onStartTask && (
              <Button
                variant="color"
                color={accentColor}
                size="sm"
                disabled={!canCreate}
                loading={creating}
                onClick={handleCreateAndStart}
                leftIcon={<Play className="size-3.5" />}
                hoverEffect="scale-glow"
                clickEffect="scale"
              >
                Create & Start
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
