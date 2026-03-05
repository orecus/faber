import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  FileCode,
  GitCommitVertical,
  GitPullRequestArrow,
  Github,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { formatErrorWithHint } from "../../lib/errorMessages";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import type { ProjectInfo, SyncStatus } from "../../types";
import { ViewLayout } from "../Shell/ViewLayout";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";
import { Tabs } from "../ui/orecus.io/navigation/tabs";
import BranchSelect from "../ui/BranchSelect";
import BranchFilter from "./BranchFilter";
import ChangesTab from "./ChangesTab";
import CommitDetailPanel from "./CommitDetailPanel";
import CommitGraph from "./CommitGraph";
import IssuesTab from "./IssuesTab";
import PullRequestsTab from "./PullRequestsTab";
import { useGitHubData } from "./useGitHubData";

type GitHubTab = "changes" | "commits" | "pull-requests" | "issues";

export default function GitHubView() {
  const { isGlass } = useTheme();
  const accentColor = useProjectAccentColor();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projectInfo = useAppStore((s) => s.projectInfo);
  const setProjectInfo = useAppStore((s) => s.setProjectInfo);
  const [activeTab, setActiveTab] = useState<GitHubTab>("changes");

  // Sync status
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);

  const {
    commits,
    graphNodes,
    headHash,
    refs,
    selectedCommitHash,
    selectedDetail,
    loading,
    loadingMore,
    error,
    hasMore,
    allBranches,
    setAllBranches,
    loadCommits,
    loadMore,
    refresh,
    selectCommit,
    fetchRefsForCommits,
  } = useGitHubData(activeProjectId);

  // Load commits when no cached data exists for the current project.
  useEffect(() => {
    if (!activeProjectId || commits.length > 0) return;
    loadCommits();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trigger on project change or cache presence, not on loadCommits identity
  }, [activeProjectId, commits.length > 0]);

  // Fetch sync status
  const fetchSyncStatus = useCallback(async () => {
    if (!activeProjectId) return;
    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Checking sync status");
    try {
      const status = await invoke<SyncStatus>("get_sync_status", {
        projectId: activeProjectId,
      });
      setSyncStatus(status);
    } catch {
      // Non-critical — silently ignore (no remote, etc.)
      setSyncStatus(null);
    } finally {
      removeBackgroundTask("Checking sync status");
    }
  }, [activeProjectId]);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  const handleToggleBranches = useCallback(
    (all: boolean) => {
      setAllBranches(all);
    },
    [setAllBranches],
  );

  const handlePull = useCallback(async () => {
    if (!activeProjectId || pulling) return;
    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Pulling from remote");
    setPulling(true);
    try {
      await invoke("git_pull", { projectId: activeProjectId });
      // Run post-pull refreshes in parallel — they're independent
      await Promise.all([
        refresh(),
        fetchSyncStatus(),
        invoke<ProjectInfo>("get_project_info", { id: activeProjectId }).then(setProjectInfo),
      ]);
    } catch (e) {
      console.error("Pull failed:", e);
      useAppStore.getState().flashError(`Pull failed: ${formatErrorWithHint(e, "git-pull")}`);
    } finally {
      setPulling(false);
      removeBackgroundTask("Pulling from remote");
    }
  }, [activeProjectId, pulling, refresh, fetchSyncStatus, setProjectInfo]);

  const handlePush = useCallback(async () => {
    if (!activeProjectId || pushing) return;
    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Pushing to remote");
    setPushing(true);
    try {
      await invoke("git_push", { projectId: activeProjectId });
      await fetchSyncStatus();
    } catch (e) {
      console.error("Push failed:", e);
      useAppStore.getState().flashError(`Push failed: ${formatErrorWithHint(e, "git-push")}`);
    } finally {
      setPushing(false);
      removeBackgroundTask("Pushing to remote");
    }
  }, [activeProjectId, pushing, fetchSyncStatus]);

  const handleBranchChanged = useCallback(async () => {
    if (activeProjectId) {
        const info = await invoke<ProjectInfo>("get_project_info", { id: activeProjectId });
        setProjectInfo(info);
      }
    await refresh();
    await fetchSyncStatus();
  }, [activeProjectId, setProjectInfo, refresh, fetchSyncStatus]);

  const selectedNode =
    graphNodes.find((n) => n.commit.hash === selectedCommitHash) ?? null;

  // Empty state
  if (!activeProjectId) {
    return (
      <div
        className="flex flex-col items-center justify-center text-muted-foreground"
        style={{ gridArea: "content" }}
      >
        <Github className="mb-3 size-10 opacity-30" />
        <p className="text-sm">Select a project to view git history</p>
        <p className="mt-1 text-xs opacity-60">
          Open a project tab to get started
        </p>
      </div>
    );
  }

  return (
    <ViewLayout>
      {/* Header */}
      <ViewLayout.Toolbar>
        <span className="text-[13px] font-medium text-foreground mr-1">
          Git
        </span>

        <Tabs<GitHubTab>
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
          <Tabs.Tab value="changes" icon={<FileCode size={13} />}>
            Changes
          </Tabs.Tab>
          <Tabs.Tab value="commits" icon={<GitCommitVertical size={13} />}>
            Commits
          </Tabs.Tab>
          <Tabs.Tab value="issues" icon={<CircleDot size={13} />}>
            Issues
          </Tabs.Tab>
          <Tabs.Tab
            value="pull-requests"
            icon={<GitPullRequestArrow size={13} />}
          >
            Pull Requests
          </Tabs.Tab>
        </Tabs>

        <div className="flex-1" />

        {/* Branch selector */}
        <BranchSelect
          projectId={activeProjectId}
          currentBranch={projectInfo?.current_branch ?? null}
          mode="checkout"
          onBranchChanged={handleBranchChanged}
          triggerVariant="badge"
        />

        {/* Pull button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handlePull}
          disabled={pulling}
          leftIcon={
            pulling ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowDown className="size-3" />
            )
          }
          hoverEffect="scale"
          clickEffect="scale"
          title="Pull from remote (fast-forward only)"
        >
          Pull
          {syncStatus && syncStatus.behind > 0 && (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">
              {syncStatus.behind}
            </span>
          )}
        </Button>

        {/* Push button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handlePush}
          disabled={pushing}
          leftIcon={
            pushing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowUp className="size-3" />
            )
          }
          hoverEffect="scale"
          clickEffect="scale"
          title="Push to remote"
        >
          Push
          {syncStatus && syncStatus.ahead > 0 && (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-success/15 px-1.5 py-px text-[10px] font-medium text-success">
              {syncStatus.ahead}
            </span>
          )}
        </Button>

        {/* Sync button */}
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          leftIcon={<RefreshCw className="size-3" />}
          hoverEffect="scale"
          clickEffect="scale"
          title="Sync git data"
        >
          Sync
        </Button>
      </ViewLayout.Toolbar>

      {/* Content card */}
      <div
        className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 ${glassStyles[isGlass ? "normal" : "solid"]}`}
      >
        {activeTab === "changes" && (
          <ChangesTab projectId={activeProjectId} />
        )}

        {activeTab === "commits" && (
          <div className="flex flex-col h-full">
            {/* Toolbar */}
            <BranchFilter
              allBranches={allBranches}
              onToggle={handleToggleBranches}
              onRefresh={refresh}
              loading={loading}
              commitCount={commits.length}
            />

            {/* Error banner */}
            {error && (
              <div className="px-3 py-1.5 text-xs bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)] text-destructive">
                {error}
              </div>
            )}

            {/* Main content: graph + detail panel */}
            <div className="flex flex-1 overflow-hidden min-h-0">
              <CommitGraph
                nodes={graphNodes}
                headHash={headHash}
                refs={refs}
                selectedCommitHash={selectedCommitHash}
                loading={loading}
                loadingMore={loadingMore}
                hasMore={hasMore}
                onSelect={selectCommit}
                onLoadMore={loadMore}
                onVisibleCommits={fetchRefsForCommits}
              />

              {selectedCommitHash && (
                <CommitDetailPanel
                  detail={selectedDetail}
                  node={selectedNode}
                  loading={!selectedDetail}
                  onClose={() => selectCommit(null)}
                />
              )}
            </div>
          </div>
        )}

        {activeTab === "issues" && <IssuesTab projectId={activeProjectId} />}

        {activeTab === "pull-requests" && (
          <PullRequestsTab projectId={activeProjectId} />
        )}
      </div>
    </ViewLayout>
  );
}
