import { open } from "@tauri-apps/plugin-shell";
import {
  Activity,
  ArrowLeft,
  Check,
  ExternalLink,
  FileText,
  Github,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import { ViewLayout } from "../Shell/ViewLayout";
import { Badge } from "../ui/badge";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";
import { Tabs } from "../ui/orecus.io/navigation/tabs";
import AgentActivityTab from "./AgentActivityTab";
import GitHubTab from "./GitHubTab";
import SyncToGitHubDialog from "./SyncToGitHubDialog";
import type { SyncOptions } from "./SyncToGitHubDialog";
import TaskBody from "./TaskBody";
import TaskDetailActions from "./TaskDetailActions";
import TaskMetadataSidebar from "./TaskMetadataSidebar";
import TaskTitle from "./TaskTitle";
import { useTaskDetail } from "./useTaskDetail";

type DetailTab = "details" | "activity" | "github";

export default function TaskDetailView() {
  const { isGlass } = useTheme();
  const accentColor = useProjectAccentColor();
  const storeTasks = useAppStore((s) => s.tasks);

  const {
    activeTaskId,
    activeProjectId,
    formData,
    body,
    agents,
    tasks,
    linkedSession,
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
    setFormData,
    setBody,
    handleBack,
    handleSave,
    handleDeleteClick,
    handleSyncToGitHub,
    handleCreateGitHubIssue,
    navigateToTask,
  } = useTaskDetail();

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && !saving) {
          handleSave();
        }
      }
      if (e.key === "Escape") {
        // Only navigate back if not inside an input/textarea
        const target = e.target as HTMLElement;
        if (
          target.tagName !== "INPUT" &&
          target.tagName !== "TEXTAREA" &&
          !target.isContentEditable
        ) {
          handleBack();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, saving, handleSave, handleBack]);

  // Get the full task object for action buttons
  const currentTask = useMemo(
    () => storeTasks.find((t) => t.id === activeTaskId) ?? null,
    [storeTasks, activeTaskId],
  );

  // Tab state
  const [activeTab, setActiveTab] = useState<DetailTab>("details");

  // Sync dialog state
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);

  const handleSyncWithOptions = useCallback(
    (options: SyncOptions) => {
      handleSyncToGitHub(options).then(() => {
        setSyncDialogOpen(false);
      });
    },
    [handleSyncToGitHub],
  );

  const handleOpenIssue = useCallback(() => {
    if (!formData?.github_issue) return;
    const [slug, num] = formData.github_issue.split("#");
    if (slug && num) {
      open(`https://github.com/${slug}/issues/${num}`);
    }
  }, [formData]);

  // Title change handler
  const handleTitleChange = useCallback(
    (title: string) => {
      if (formData) {
        setFormData({ ...formData, title });
      }
    },
    [formData, setFormData],
  );

  // ── No task selected ──
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

  // ── Loading ──
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

  // ── Error loading ──
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

  return (
    <ViewLayout>
      {/* ── Toolbar ── */}
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

        <div className="flex-1" />

        {/* Task actions (status-aware: start, research, view session, create PR, archive, reopen) */}
        {currentTask && activeProjectId && (
          <TaskDetailActions task={currentTask} projectId={activeProjectId} />
        )}

        {/* Sync to GitHub (when issue is linked) */}
        {formData.github_issue && (
          <Button
            variant="outline"
            size="sm"
            disabled={syncing || isDirty}
            onClick={() => setSyncDialogOpen(true)}
            title={isDirty ? "Save changes before syncing to GitHub" : undefined}
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
            {syncSuccess ? "Synced!" : "Sync"}
          </Button>
        )}

        {/* Save */}
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
        <div className="rounded-[var(--radius-element)] bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ── Top-level tabs ── */}
      <div className="px-1">
        <Tabs<DetailTab>
          value={activeTab}
          onChange={setActiveTab}
          animation="slide"
          variant="none"
          indicatorVariant="color"
          size="sm"
          color={accentColor}
          align="start"
          barRadius="md"
          tabRadius="md"
          fullWidth={false}
        >
          <Tabs.Tab value="details" icon={<FileText size={12} />}>
            Task Details
          </Tabs.Tab>
          <Tabs.Tab value="activity" icon={<Activity size={12} />}>
            Agent Activity
          </Tabs.Tab>
          {formData.github_issue && (
            <Tabs.Tab value="github" icon={<Github size={12} />}>
              GitHub
            </Tabs.Tab>
          )}
        </Tabs>
      </div>

      {/* ── Two-panel layout ── */}
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">
        {/* Left — Main content area */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col gap-3 pr-3 pb-4 px-1">
            {activeTab === "details" && (
              <>
                {/* Title */}
                <TaskTitle title={formData.title} onChange={handleTitleChange} />

                {/* Body (preview by default, click to edit) */}
                <div className={`flex min-h-[200px] flex-col rounded-lg ring-1 ring-border/40 p-3 ${glassStyles[isGlass ? "normal" : "solid"]}`}>
                  <TaskBody body={body} onChange={setBody} onSave={handleSave} />
                </div>
              </>
            )}

            {activeTab === "activity" && (
              <div className={`flex flex-col rounded-lg ring-1 ring-border/40 p-3 ${glassStyles[isGlass ? "normal" : "solid"]}`}>
                <AgentActivityTab
                  linkedSession={linkedSession}
                  taskId={activeTaskId}
                  projectId={activeProjectId!}
                />
              </div>
            )}

            {activeTab === "github" && formData.github_issue && (
              <div className={`flex flex-col rounded-lg ring-1 ring-border/40 p-3 ${glassStyles[isGlass ? "normal" : "solid"]}`}>
                <GitHubTab
                  githubIssue={formData.github_issue}
                  projectId={activeProjectId!}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right — Metadata sidebar */}
        <div className="w-[260px] shrink-0 overflow-y-auto border-l border-border/40">
          <div className="px-3 py-1">
            <TaskMetadataSidebar
              data={formData}
              onChange={setFormData}
              agents={agents}
              taskId={activeTaskId}
              tasks={tasks}
              onNavigateToTask={navigateToTask}
              onCreateGitHubIssue={ghAuthOk && hasRemote ? handleCreateGitHubIssue : undefined}
              creatingIssue={creatingIssue}
            />
          </div>
        </div>
      </div>

      {/* Sync to GitHub confirmation dialog */}
      {formData.github_issue && activeProjectId && (
        <SyncToGitHubDialog
          open={syncDialogOpen}
          onOpenChange={setSyncDialogOpen}
          onSync={handleSyncWithOptions}
          syncing={syncing}
          taskTitle={formData.title}
          taskBody={body}
          taskStatus={formData.status}
          taskLabels={formData.labels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)}
          issueRef={formData.github_issue}
          projectId={activeProjectId}
        />
      )}
    </ViewLayout>
  );
}
