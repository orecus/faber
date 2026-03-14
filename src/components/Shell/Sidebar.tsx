import {
  AlertCircle,
  Bell,
  Bot,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CirclePause,
  CirclePlay,
  ClipboardList,
  Eye,
  FlaskConical,
  GitFork,
  Lightbulb,
  Loader2,
  MessageCircle,
  MessageSquare,
  Plus,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { usePersistedBoolean } from "../../hooks/usePersistedState";
import { useProjectIcon } from "../../hooks/useProjectIcon";
import { AgentIcon } from "../../lib/agentIcons";
import { useAppStore } from "../../store/appStore";
import { pickProjectFolder } from "../../utils/pickProjectFolder";
import { AgentsTab } from "../Settings/AgentsTab";
import { GeneralTab } from "../Settings/GeneralTab";
import { NotificationsTab } from "../Settings/NotificationsTab";
import { ProjectsTab } from "../Settings/ProjectsTab";
import { PromptsTab } from "../Settings/PromptsTab";
import { TerminalTab } from "../Settings/TerminalTab";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { gradientHexColors } from "../ui/orecus.io/lib/color-utils";
import { FaberLogo } from "../ui/FaberLogo";
import SidebarResizeHandle from "./SidebarResizeHandle";
import SidebarStatusPanel from "./SidebarStatusPanel";
import UsagePanel from "./UsagePanel";

import type { LucideIcon } from "lucide-react";
import type { ChangedFile, McpSessionState, SessionStatus, WorktreeInfo } from "../../types";
import type { ThemeColor } from "../ui/orecus.io/lib/color-utils";

// Stable empty arrays to prevent unnecessary re-renders from selector
const EMPTY_SESSIONS: never[] = [];
const EMPTY_WORKTREES: WorktreeInfo[] = [];

// ── Settings Bar ──

type SettingsDialogId =
  | "general"
  | "terminal"
  | "notifications"
  | "agents"
  | "prompts"
  | "projects";

const SETTINGS_ITEMS: {
  id: SettingsDialogId;
  icon: LucideIcon;
  title: string;
  tooltip: string;
  maxWidth: string;
}[] = [
  {
    id: "general",
    icon: SlidersHorizontal,
    title: "General Settings",
    tooltip: "General",
    maxWidth: "sm:max-w-lg",
  },
  {
    id: "terminal",
    icon: TerminalSquare,
    title: "Terminal Settings",
    tooltip: "Terminal",
    maxWidth: "sm:max-w-md",
  },
  {
    id: "notifications",
    icon: Bell,
    title: "Notifications",
    tooltip: "Notifications",
    maxWidth: "sm:max-w-md",
  },
  {
    id: "agents",
    icon: Bot,
    title: "Agent Configuration",
    tooltip: "Agents",
    maxWidth: "sm:max-w-2xl",
  },
  {
    id: "prompts",
    icon: MessageSquare,
    title: "Prompt Templates & Quick Actions",
    tooltip: "Prompts",
    maxWidth: "sm:max-w-2xl",
  },
];

// Dialog config for items not in the settings bar (opened externally)
const EXTRA_DIALOG_CONFIG: Record<string, { title: string; maxWidth: string }> =
  {
    projects: { title: "Project Settings", maxWidth: "sm:max-w-2xl" },
  };

function SettingsBar({
  openDialog,
  setOpenDialog,
}: {
  openDialog: SettingsDialogId | null;
  setOpenDialog: (id: SettingsDialogId | null) => void;
}) {
  const agents = useAppStore((s) => s.agents);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const config = openDialog
    ? (SETTINGS_ITEMS.find((i) => i.id === openDialog) ??
      (EXTRA_DIALOG_CONFIG[openDialog]
        ? { ...EXTRA_DIALOG_CONFIG[openDialog], id: openDialog }
        : null))
    : null;

  return (
    <>
      <div className="flex items-center justify-center gap-0.5 px-2 py-1">
        {SETTINGS_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="icon-sm"
              hoverEffect="none"
              clickEffect="none"
              title={item.tooltip}
              onClick={() => setOpenDialog(item.id)}
            >
              <Icon size={14} />
            </Button>
          );
        })}
        <Button
          variant="ghost"
          size="icon-sm"
          hoverEffect="none"
          clickEffect="none"
          title="Help & Docs"
          onClick={() => setActiveView("help")}
        >
          <CircleHelp size={14} />
        </Button>
      </div>

      {openDialog && config && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setOpenDialog(null);
          }}
        >
          <DialogContent className={config.maxWidth}>
            <DialogHeader>
              <DialogTitle>{config.title}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-y-auto -mx-6 px-6">
              {openDialog === "general" && <GeneralTab />}
              {openDialog === "terminal" && <TerminalTab />}
              {openDialog === "notifications" && <NotificationsTab />}
              {openDialog === "agents" && <AgentsTab agents={agents} />}
              {openDialog === "prompts" && <PromptsTab />}
              {openDialog === "projects" && (
                <ProjectsTab
                  agents={agents}
                  onClose={() => setOpenDialog(null)}
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── Helpers ──

const STATUS_COLOR: Record<string, string> = {
  starting: "var(--warning)",
  running: "var(--success)",
  paused: "var(--muted-foreground)",
  stopped: "var(--muted-foreground)",
  finished: "var(--dim-foreground)",
  error: "var(--destructive)",
};

function deriveSessionStatus(
  sessionStatus: SessionStatus,
  mcpData?: McpSessionState,
  mode?: string,
): { label: string; color: string } {
  if (mcpData?.completed) {
    return { label: "done", color: "var(--success)" };
  }
  if (mcpData?.error || mcpData?.status === "error") {
    return { label: "error", color: "var(--destructive)" };
  }
  if (mcpData?.waiting || mcpData?.status === "waiting") {
    return { label: "waiting", color: "var(--warning)" };
  }
  if (sessionStatus === "running" && mcpData?.status === "working") {
    const activity = mcpData.activity;
    if (activity === "researching" || activity === "exploring" || (!activity && mode === "research")) {
      return { label: "researching", color: "var(--warning)" };
    }
    if (activity === "planning") {
      return { label: "planning", color: "var(--primary)" };
    }
    if (activity === "testing") {
      return { label: "testing", color: "var(--primary)" };
    }
    if (activity === "debugging") {
      return { label: "debugging", color: "var(--warning)" };
    }
    if (activity === "reviewing") {
      return { label: "reviewing", color: "var(--primary)" };
    }
    if (activity) {
      return { label: activity, color: "var(--primary)" };
    }
    return { label: "working", color: "var(--primary)" };
  }
  if (sessionStatus === "error") {
    return { label: "error", color: "var(--destructive)" };
  }
  if (sessionStatus === "running" && mode === "research") {
    return { label: "researching", color: "var(--warning)" };
  }
  // Agent sessions that are running but haven't reported MCP status yet —
  // show "idle" instead of "running" to avoid implying active work.
  // Shells don't use MCP so "running" is accurate for them.
  if (sessionStatus === "running" && mode !== "shell" && !mcpData?.status) {
    return { label: "idle", color: "var(--muted-foreground)" };
  }
  return {
    label: sessionStatus,
    color: STATUS_COLOR[sessionStatus] ?? "var(--muted-foreground)",
  };
}

// ── Status Icon ──

function StatusIcon({ label }: { label: string }) {
  switch (label) {
    case "working":
    case "coding":
      return <Loader2 size={11} className="shrink-0 animate-spin" />;
    case "researching":
    case "exploring":
      return <Lightbulb size={11} className="shrink-0 animate-pulse" />;
    case "planning":
      return <ClipboardList size={11} className="shrink-0 animate-pulse" />;
    case "testing":
      return <FlaskConical size={11} className="shrink-0 animate-spin" />;
    case "debugging":
      return <Bug size={11} className="shrink-0 animate-spin" />;
    case "reviewing":
      return <Eye size={11} className="shrink-0 animate-spin" />;
    case "waiting":
      return <MessageCircle size={11} className="shrink-0 animate-pulse" />;
    case "error":
      return <AlertCircle size={11} className="shrink-0" />;
    case "done":
    case "finished":
      return <CheckCircle2 size={11} className="shrink-0" />;
    case "starting":
      return <Loader2 size={11} className="shrink-0 animate-spin" />;
    case "idle":
    case "running":
      return <CirclePlay size={11} className="shrink-0" />;
    case "stopped":
    case "paused":
      return <CirclePause size={11} className="shrink-0" />;
    default:
      return null;
  }
}

// ── Project Icon ──

function ProjectIcon({
  projectId,
  projectPath,
  iconPath,
}: {
  projectId: string;
  projectPath: string;
  iconPath: string | null;
}) {
  const svgMarkup = useProjectIcon(projectId, projectPath, iconPath);
  if (!svgMarkup) return null;
  return (
    <span
      className="w-4 h-4 shrink-0 rounded-sm inline-flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}

// ── Session Row ──
// Each row subscribes only to its own mcpStatus[sessionId], so MCP updates
// for session A don't re-render session B's row.

const SessionRow = React.memo(function SessionRow({
  session,
  isProjectActive,
  onSelect,
}: {
  session: { id: string; status: SessionStatus; mode: string; agent: string; name: string | null };
  isProjectActive: boolean;
  onSelect: () => void;
}) {
  const mcpData = useAppStore((s) => s.mcpStatus[session.id]);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setGridLayout = useAppStore((s) => s.setGridLayout);

  const derived = deriveSessionStatus(session.status, mcpData, session.mode);
  const isWaiting = derived.label === "waiting";
  const isError = derived.label === "error";

  return (
    <div
      onClick={() => {
        if (!isProjectActive) onSelect();
        setActiveView("sessions");
        setGridLayout({ focusedPaneId: session.id });
      }}
      className={`flex items-center gap-2 px-1 h-7 text-xs rounded-[var(--radius-element)] cursor-pointer hover:bg-accent ${isWaiting ? "bg-warning/10 text-warning" : isError ? "bg-destructive/10 text-destructive" : "text-dim-foreground"}`}
    >
      <AgentIcon
        agent={session.mode === "shell" ? "shell" : session.agent}
        size={14}
        className="shrink-0 opacity-80"
      />
      <span
        className="flex-1 truncate min-w-0"
        title={session.name ? `${session.name} (${session.agent})` : session.agent}
      >
        {session.name || session.agent}
      </span>
      <span
        className={`ml-auto shrink-0 flex items-center gap-1 text-[10px] ${isWaiting || isError ? "font-medium" : ""}`}
        style={{ color: derived.color }}
      >
        <StatusIcon label={derived.label} />
        {derived.label}
      </span>
    </div>
  );
});

// ── Project Session List ──
// Subscribes only to projectSessions[pid] — not the entire mcpStatus record.

const ProjectSessionList = React.memo(function ProjectSessionList({
  projectId,
  isProjectActive,
  onSelect,
}: {
  projectId: string;
  isProjectActive: boolean;
  onSelect: () => void;
}) {
  const sessions = useAppStore(
    (s) => s.projectSessions[projectId] ?? EMPTY_SESSIONS,
  );

  return (
    <>
      <div className="px-1 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        Sessions
      </div>
      <div className="text-dim-foreground">
        {sessions.length === 0 ? (
          <div className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground/60">
            <TerminalSquare size={12} />
            <span>No active sessions</span>
          </div>
        ) : (
          sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              isProjectActive={isProjectActive}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </>
  );
});

// ── Project Worktree List ──

const ProjectWorktreeList = React.memo(function ProjectWorktreeList({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect: () => void;
}) {
  const worktrees = useAppStore(
    (s) => s.projectWorktrees[projectId] ?? EMPTY_WORKTREES,
  );
  const activeView = useAppStore((s) => s.activeView);
  const reviewWorktreePath = useAppStore((s) => s.reviewWorktreePath);
  const navigateToReview = useAppStore((s) => s.navigateToReview);

  const nonMainWorktrees = worktrees.filter((w) => !w.is_main);

  return (
    <>
      <div className="px-1 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        Worktrees
      </div>
      <div className="pb-1">
        {nonMainWorktrees.length === 0 ? (
          <div className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground/60">
            <GitFork size={12} />
            <span>No worktrees</span>
          </div>
        ) : (
          nonMainWorktrees.map((w) => {
            const isActiveWorktree =
              activeView === "review" && reviewWorktreePath === w.path;
            return (
              <div
                key={w.path}
                onClick={() => {
                  onSelect();
                  navigateToReview(w.path);
                }}
                className={`flex items-center gap-1.5 px-1 py-1 text-xs rounded-[var(--radius-element)] cursor-pointer hover:bg-accent ${isActiveWorktree ? "bg-accent text-foreground" : "text-dim-foreground"}`}
              >
                <GitFork
                  size={12}
                  className={`shrink-0 ${isActiveWorktree ? "text-primary" : ""}`}
                />
                <span className="truncate min-w-0">
                  {w.branch ?? w.path.split("/").pop() ?? "worktree"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
});

// ── Project Item ──
// No longer subscribes to mcpStatus — that's handled by individual SessionRow components.

const ProjectItem = React.memo(function ProjectItem({
  project,
  isActive,
  showIcons,
  onSelect,
  onClose,
}: {
  project: {
    id: string;
    name: string;
    path: string;
    color: string | null;
    icon_path: string | null;
  };
  isActive: boolean;
  showIcons: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const branch = useAppStore((s) => s.projectBranches[project.id] ?? null);

  // Change count — only tracked for the active project (lightweight)
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const projectPathRef = useRef(project.path);
  projectPathRef.current = project.path;
  const projectIdRef = useRef(project.id);
  projectIdRef.current = project.id;

  const refreshChangeCount = useCallback(() => {
    const path = projectPathRef.current;
    const pid = projectIdRef.current;
    if (!path || !pid) {
      setChangeCount(null);
      return;
    }
    invoke<ChangedFile[]>("get_changed_files", { projectId: pid, worktreePath: path })
      .then((files) => setChangeCount(files.length))
      .catch(() => setChangeCount(null));
  }, []);

  useEffect(() => {
    if (!isActive) {
      setChangeCount(null);
      return;
    }
    refreshChangeCount();

    let unlisten: (() => void) | undefined;
    listen("mcp-files-changed", () => refreshChangeCount()).then((fn) => {
      unlisten = fn;
    });

    const interval = setInterval(refreshChangeCount, 30_000);

    return () => {
      unlisten?.();
      clearInterval(interval);
    };
  }, [isActive, refreshChangeCount]);

  const themeColor = (project.color as ThemeColor) || "primary";
  const accentHex =
    gradientHexColors[themeColor]?.start ?? gradientHexColors.primary.start;

  return (
    <div>
      {/* Project header */}
      <div
        onClick={onSelect}
        className={`group flex items-center gap-1.5 px-2 h-8 cursor-pointer ${
          isActive ? "bg-accent/50" : "hover:bg-accent/30"
        }`}
      >
        <span
          className="size-2 rounded-full shrink-0"
          style={{ backgroundColor: accentHex }}
        />
        {showIcons && (
          <ProjectIcon
            projectId={project.id}
            projectPath={project.path}
            iconPath={project.icon_path}
          />
        )}
        <span
          className={`text-[13px] truncate min-w-0 flex-1 ${isActive ? "text-foreground font-medium" : "text-dim-foreground"}`}
        >
          {project.name}
          {branch && (
            <>
              <span className="text-muted-foreground/60 mx-1">·</span>
              <span className="text-[10px] text-muted-foreground font-normal">{branch}</span>
            </>
          )}
          {isActive && changeCount != null && changeCount > 0 && (
            <span className="text-[10px] text-warning font-normal ml-1">{changeCount}∆</span>
          )}
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="cursor-pointer text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          title="Close project"
        >
          <X size={12} />
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          className="inline-flex w-4 justify-center shrink-0 text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="pl-3 pb-1">
          <ProjectSessionList
            projectId={project.id}
            isProjectActive={isActive}
            onSelect={onSelect}
          />
          <ProjectWorktreeList
            projectId={project.id}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
});

// ── Sidebar ──

export default function Sidebar() {
  const projects = useAppStore((s) => s.projects);
  const openProjectIds = useAppStore((s) => s.openProjectIds);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const closeProject = useAppStore((s) => s.closeProject);
  const addProjectFromPath = useAppStore((s) => s.addProjectFromPath);
  const [showIcons] = usePersistedBoolean("show_project_icons", true);
  const [settingsDialog, setSettingsDialog] = useState<SettingsDialogId | null>(
    null,
  );
  const [version, setVersion] = useState("");

  useEffect(() => {
    invoke<string>("get_app_version").then(setVersion).catch(() => {});
  }, []);

  const openProjects = useMemo(
    () => projects.filter((p) => openProjectIds.includes(p.id)),
    [projects, openProjectIds],
  );

  const handleSelectProject = useCallback(
    (id: string) => setActiveProject(id),
    [setActiveProject],
  );
  const handleCloseProject = useCallback(
    (id: string) => closeProject(id),
    [closeProject],
  );

  async function handleAddProject() {
    try {
      const selected = await pickProjectFolder();
      if (!selected) return;
      await addProjectFromPath(selected);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      className="relative flex flex-col overflow-hidden select-none border-r border-border bg-card/60"
      style={{ gridArea: "sidebar" }}
    >
      {/* ── Branding + projects header ── */}
      <div className="flex items-center px-3 pt-1.5 pb-1 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <FaberLogo className="size-3.5 shrink-0 text-primary" />
          <span className="text-[11px] font-medium text-foreground">Faber</span>
          {version && (
            <span className="text-[10px] text-muted-foreground">v{version}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          hoverEffect="none"
          clickEffect="none"
          onClick={() => setSettingsDialog("projects")}
          title="Project settings"
        >
          <Settings size={13} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          hoverEffect="none"
          clickEffect="none"
          onClick={handleAddProject}
          title="Add project"
        >
          <Plus size={14} />
        </Button>
      </div>

      {/* ── Scrollable project list ── */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/40">
        {openProjects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isActive={project.id === activeProjectId}
            showIcons={showIcons}
            onSelect={() => handleSelectProject(project.id)}
            onClose={() => handleCloseProject(project.id)}
          />
        ))}
      </div>

      {/* ── Bottom: settings + status ── */}
      <div className="mt-auto shrink-0 border-t border-border">
        <SettingsBar
          openDialog={settingsDialog}
          setOpenDialog={setSettingsDialog}
        />
        <UsagePanel />
        <SidebarStatusPanel />
      </div>

      <SidebarResizeHandle />
    </div>
  );
}
