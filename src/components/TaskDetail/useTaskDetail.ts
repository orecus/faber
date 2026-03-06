import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAppStore } from "../../store/appStore";
import type { GitHubIssueCreated, Task, TaskFileContent } from "../../types";
import type { TaskFormData } from "./TaskMetadataForm";

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

export function useTaskDetail() {
  const activeTaskId = useAppStore((s) => s.activeTaskId);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const agents = useAppStore((s) => s.agents);
  const tasks = useAppStore((s) => s.tasks);
  const sessions = useAppStore((s) => s.sessions);
  const ghAuthStatus = useAppStore((s) => s.ghAuthStatus);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setActiveTask = useAppStore((s) => s.setActiveTask);
  const updateTask = useAppStore((s) => s.updateTask);
  const setTasks = useAppStore((s) => s.setTasks);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

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
  const [creatingIssue, setCreatingIssue] = useState(false);
  const [hasRemote, setHasRemote] = useState(true);

  // Check if the repo has a remote configured
  useEffect(() => {
    if (!activeProjectId) return;
    invoke<boolean>("has_remote", { projectId: activeProjectId })
      .then(setHasRemote)
      .catch(() => setHasRemote(false));
  }, [activeProjectId]);

  // Compute isDirty
  const isDirty =
    formData !== null &&
    originalFormData !== null &&
    (JSON.stringify(formData) !== JSON.stringify(originalFormData) ||
      body !== originalBody);

  // GitHub auth available (installed + authenticated)
  const ghAuthOk = !!(ghAuthStatus?.installed && ghAuthStatus?.authenticated);

  // Find linked session for this task
  const linkedSession = sessions.find(
    (s) => s.task_id === activeTaskId && activeTaskId !== null,
  );

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

  const navigateToTask = useCallback(
    (taskId: string) => {
      setActiveTask(taskId);
      setActiveView("task-detail");
    },
    [setActiveTask, setActiveView],
  );

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

  // Create a new GitHub issue from this task
  const handleCreateGitHubIssue = useCallback(async () => {
    if (!activeProjectId || !activeTaskId || !formData) return;
    if (formData.github_issue) return; // already linked

    setCreatingIssue(true);
    setError(null);
    addBackgroundTask("Creating GitHub issue");
    try {
      // Map task labels (include priority as a label)
      const labels = formData.labels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (formData.priority === "P0") labels.push("critical");
      else if (formData.priority === "P1") labels.push("high-priority");

      const result = await invoke<GitHubIssueCreated>(
        "create_github_issue",
        {
          projectId: activeProjectId,
          title: formData.title,
          body: body || null,
          labels: labels.length > 0 ? labels : null,
        },
      );

      // Parse owner/repo from the returned URL (e.g. https://github.com/owner/repo/issues/123)
      const urlParts = result.url.match(
        /github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/,
      );
      const issueRef = urlParts
        ? `${urlParts[1]}#${result.number}`
        : `#${result.number}`;

      // Update the form data with the new issue reference
      const updatedFormData = { ...formData, github_issue: issueRef };
      setFormData(updatedFormData);

      // Save the task with the new github_issue link
      const updated = await invoke<Task>("save_task_content", {
        projectId: activeProjectId,
        taskId: activeTaskId,
        title: updatedFormData.title,
        status: updatedFormData.status,
        priority: updatedFormData.priority,
        agent: updatedFormData.agent || null,
        model: updatedFormData.model || null,
        branch: updatedFormData.branch || null,
        githubIssue: issueRef,
        dependsOn: updatedFormData.depends_on
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        labels: updatedFormData.labels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
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
      setCreatingIssue(false);
      removeBackgroundTask("Creating GitHub issue");
    }
  }, [
    activeProjectId,
    activeTaskId,
    formData,
    body,
    setFormData,
    updateTask,
    addBackgroundTask,
    removeBackgroundTask,
  ]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  return {
    // IDs
    activeTaskId,
    activeProjectId,

    // Data
    formData,
    body,
    agents,
    tasks,
    linkedSession,

    // State
    loading,
    error,
    saving,
    deleting,
    confirmDelete,
    syncing,
    syncSuccess,
    creatingIssue,
    ghAuthOk,
    hasRemote,
    isDirty,

    // Setters
    setFormData,
    setBody,
    setError,

    // Actions
    handleBack,
    handleSave,
    handleDelete,
    handleDeleteClick,
    handleSyncToGitHub,
    handleCreateGitHubIssue,
    navigateToTask,
  };
}
