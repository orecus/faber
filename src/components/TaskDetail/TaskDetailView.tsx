import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import {
  ArrowLeft,
  Check,
  Eye,
  ExternalLink,
  Github,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import { ViewLayout } from "../Shell/ViewLayout";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/orecus.io/cards/card";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import TaskMarkdownEditor from "./TaskMarkdownEditor";
import TaskMarkdownPreview from "./TaskMarkdownPreview";
import TaskMetadataForm, { type TaskFormData } from "./TaskMetadataForm";

import type { Task, TaskFileContent } from "../../types";

function taskToFormData(task: Task): TaskFormData {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    agent: task.agent ?? "",
    model: task.model ?? "",
    branch: task.branch ?? "",
    github_issue: task.github_issue ?? "",
    depends_on: task.depends_on.join(", "),
    labels: task.labels.join(", "),
  };
}

function parseCommaSeparated(str: string): string[] {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function TaskDetailView() {
  const { isGlass } = useTheme();
  const accentColor = useProjectAccentColor();
  const activeTaskId = useAppStore((s) => s.activeTaskId);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const agents = useAppStore((s) => s.agents);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setActiveTask = useAppStore((s) => s.setActiveTask);
  const updateTask = useAppStore((s) => s.updateTask);
  const setTasks = useAppStore((s) => s.setTasks);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

  const [mode, setMode] = useState<"view" | "edit">("edit");
  const [formData, setFormData] = useState<TaskFormData | null>(null);
  const [body, setBody] = useState("");
  const [originalFormData, setOriginalFormData] = useState<TaskFormData | null>(
    null,
  );
  const [originalBody, setOriginalBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  // Compute isDirty
  const isDirty =
    formData !== null &&
    originalFormData !== null &&
    (JSON.stringify(formData) !== JSON.stringify(originalFormData) ||
      body !== originalBody);

  // Load task file content
  useEffect(() => {
    if (!activeProjectId || !activeTaskId) return;
    setLoading(true);
    setError(null);

    invoke<TaskFileContent>("get_task_file_content", {
      projectId: activeProjectId,
      taskId: activeTaskId,
    })
      .then((result) => {
        const fd = taskToFormData(result.task);
        setFormData(fd);
        setOriginalFormData(fd);
        setBody(result.body);
        setOriginalBody(result.body);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [activeProjectId, activeTaskId]);

  const handleBack = useCallback(() => {
    setActiveView("dashboard");
    setActiveTask(null);
  }, [setActiveView, setActiveTask]);

  const handleSave = useCallback(async () => {
    if (!activeProjectId || !activeTaskId || !formData) return;
    setSaving(true);
    setError(null);
    addBackgroundTask("Saving task");
    try {
      const updated = await invoke<Task>("save_task_content", {
        projectId: activeProjectId,
        taskId: activeTaskId,
        title: formData.title,
        status: formData.status,
        priority: formData.priority,
        agent: formData.agent || null,
        model: formData.model || null,
        branch: formData.branch || null,
        githubIssue: formData.github_issue || null,
        dependsOn: parseCommaSeparated(formData.depends_on),
        labels: parseCommaSeparated(formData.labels),
        body,
      });
      updateTask(updated);
      const fd = taskToFormData(updated);
      setFormData(fd);
      setOriginalFormData(fd);
      setOriginalBody(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      removeBackgroundTask("Saving task");
    }
  }, [
    activeProjectId,
    activeTaskId,
    formData,
    body,
    updateTask,
    addBackgroundTask,
    removeBackgroundTask,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (mode === "edit" && isDirty && !saving) {
          handleSave();
        }
      }
      if (e.key === "Escape") {
        handleBack();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, isDirty, saving, handleSave, handleBack]);

  const handleDelete = useCallback(async () => {
    if (!activeProjectId || !activeTaskId) return;
    setDeleting(true);
    setError(null);
    addBackgroundTask("Deleting task");
    try {
      await invoke("delete_task", {
        projectId: activeProjectId,
        taskId: activeTaskId,
      });
      // Re-fetch tasks
      const freshTasks = await invoke<Task[]>("list_tasks", {
        projectId: activeProjectId,
      });
      setTasks(freshTasks);
      setActiveTask(null);
      setActiveView("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
      removeBackgroundTask("Deleting task");
    }
  }, [
    activeProjectId,
    activeTaskId,
    setTasks,
    setActiveTask,
    setActiveView,
    addBackgroundTask,
    removeBackgroundTask,
  ]);

  const handleDeleteClick = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      // Auto-reset after 3 seconds
      deleteTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    setConfirmDelete(false);
    handleDelete();
  }, [confirmDelete, handleDelete]);

  // Sync task to GitHub issue
  const handleSyncToGitHub = useCallback(async () => {
    if (!activeProjectId || !activeTaskId || !formData) return;
    const issueRef = formData.github_issue;
    if (!issueRef) return;

    // Extract issue number from ref like "owner/repo#42"
    const num = issueRef.split("#").pop();
    if (!num) return;
    const issueNumber = parseInt(num, 10);
    if (isNaN(issueNumber)) return;

    setSyncing(true);
    setSyncSuccess(false);
    setError(null);
    addBackgroundTask("Syncing to GitHub");
    try {
      await invoke("update_github_issue", {
        projectId: activeProjectId,
        issueNumber,
        title: formData.title,
        body,
      });
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
      removeBackgroundTask("Syncing to GitHub");
    }
  }, [
    activeProjectId,
    activeTaskId,
    formData,
    body,
    addBackgroundTask,
    removeBackgroundTask,
  ]);

  const handleOpenIssue = useCallback(() => {
    if (!formData?.github_issue) return;
    const issueRef = formData.github_issue;
    // Build URL from ref like "owner/repo#42"
    const [slug, num] = issueRef.split("#");
    if (slug && num) {
      open(`https://github.com/${slug}/issues/${num}`);
    }
  }, [formData]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  // No task selected
  if (!activeTaskId) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ gridArea: "content" }}
      >
        No task selected
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div
        className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
        style={{ gridArea: "content" }}
      >
        <Loader2 className="size-4 animate-spin" />
        Loading task...
      </div>
    );
  }

  // Error loading
  if (error && !formData) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3"
        style={{ gridArea: "content" }}
      >
        <p className="text-sm text-destructive">{error}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          leftIcon={<ArrowLeft className="size-3.5" />}
        >
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (!formData) return null;

  const labelBadges = formData.labels
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const depBadges = formData.depends_on
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <ViewLayout>
      {/* ── Toolbar — matches SummaryHeader / SessionsToolbar layout ── */}
      <ViewLayout.Toolbar>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          leftIcon={<ArrowLeft className="size-3.5" />}
          hoverEffect="scale"
          clickEffect="scale"
        >
          Back
        </Button>

        <Badge variant="outline" className="font-mono text-[11px]">
          {activeTaskId}
        </Badge>

        <span className="text-[13px] font-medium text-foreground truncate">
          {formData.title}
        </span>

        {/* GitHub issue badge */}
        {formData.github_issue && (
          <button
            onClick={handleOpenIssue}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-mono bg-[color-mix(in_oklch,var(--primary)_10%,transparent)] text-primary hover:bg-[color-mix(in_oklch,var(--primary)_18%,transparent)] transition-colors cursor-pointer"
            title="Open issue on GitHub"
          >
            <Github size={11} />
            {formData.github_issue}
            <ExternalLink size={9} className="opacity-60" />
          </button>
        )}

        {/* Labels & deps in toolbar (view mode only) */}
        {mode === "view" &&
          labelBadges.length > 0 &&
          labelBadges.map((label) => (
            <Badge key={label} variant="secondary" className="text-[11px]">
              {label}
            </Badge>
          ))}
        {mode === "view" &&
          depBadges.length > 0 &&
          depBadges.map((dep) => (
            <Badge
              key={dep}
              variant="outline"
              className="font-mono text-[11px]"
            >
              {dep}
            </Badge>
          ))}

        <div className="flex-1" />

        {/* Edit/Preview toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMode(mode === "edit" ? "view" : "edit")}
          leftIcon={
            mode === "edit" ? (
              <Eye className="size-3.5" />
            ) : (
              <Pencil className="size-3.5" />
            )
          }
          hoverEffect="scale"
          clickEffect="scale"
        >
          {mode === "edit" ? "Preview" : "Edit"}
        </Button>

        {/* Sync to GitHub */}
        {formData.github_issue && mode === "edit" && (
          <Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={handleSyncToGitHub}
            leftIcon={
              syncing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : syncSuccess ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <RefreshCw className="size-3.5" />
              )
            }
            hoverEffect="scale"
            clickEffect="scale"
          >
            {syncSuccess ? "Synced!" : "Sync to GitHub"}
          </Button>
        )}

        {/* Save */}
        {mode === "edit" && (
          <Button
            variant="color"
            color={accentColor}
            size="sm"
            disabled={!isDirty || saving}
            loading={saving}
            onClick={handleSave}
            leftIcon={<Save className="size-3.5" />}
            hoverEffect="scale-glow"
            clickEffect="scale"
          >
            Save
          </Button>
        )}

        {/* Delete */}
        <Button
          variant={confirmDelete ? "destructive" : "ghost"}
          size="sm"
          disabled={deleting}
          loading={deleting}
          onClick={handleDeleteClick}
          leftIcon={<Trash2 className="size-3.5" />}
          hoverEffect="scale"
          clickEffect="scale"
        >
          {confirmDelete ? "Confirm?" : "Delete"}
        </Button>
      </ViewLayout.Toolbar>

      {/* ── Error banner ── */}
      {error && (
        <div className="mt-1 rounded-[var(--radius-element)] bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-px">
        {/* Metadata */}
        <Card
          type={isGlass ? "normal" : "solid"}
          border
          radius="lg"
          className="shrink-0"
        >
          <CardContent>
            <TaskMetadataForm
              data={formData}
              onChange={setFormData}
              editing={mode === "edit"}
              agents={agents}
            />
          </CardContent>
        </Card>

        {/* Body */}
        <Card
          type={isGlass ? "normal" : "solid"}
          border
          radius="lg"
          className="flex min-h-0 flex-1 flex-col"
        >
          <CardContent className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Description
            </div>
            {mode === "edit" ? (
              <TaskMarkdownEditor body={body} onChange={setBody} />
            ) : (
              <TaskMarkdownPreview body={body} />
            )}
          </CardContent>
        </Card>
      </div>
    </ViewLayout>
  );
}
