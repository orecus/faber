import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CirclePlay,
  ClipboardList,
  Ellipsis,
  Eye,
  EyeOff,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  GitFork,
  Lightbulb,
  Loader2,
  MessageCircle,
  Plus,
  Settings,
  TerminalSquare,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { usePersistedBoolean } from "../../hooks/usePersistedState";
import { useProjectIcon } from "../../hooks/useProjectIcon";
import { AgentIcon } from "../../lib/agentIcons";
import { useAppStore } from "../../store/appStore";
import { pickProjectFolder } from "../../utils/pickProjectFolder";
import { ManageProjectsTab } from "../Settings/ProjectsTab";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import CreateProjectDialog from "./CreateProjectDialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { gradientHexColors } from "../ui/orecus.io/lib/color-utils";
import { FaberLogo } from "../ui/FaberLogo";
import SidebarResizeHandle from "./SidebarResizeHandle";

import type { ChangedFile, McpSessionState, SessionStatus, WorktreeInfo } from "../../types";
import type { ThemeColor } from "../ui/orecus.io/lib/color-utils";

// Stable empty arrays to prevent unnecessary re-renders from selector
const EMPTY_SESSIONS: never[] = [];
const EMPTY_WORKTREES: WorktreeInfo[] = [];

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
      tabIndex={0}
      role="button"
      aria-label={`${session.name || session.agent} session — ${derived.label}`}
      onClick={() => {
        if (!isProjectActive) onSelect();
        setActiveView("sessions");
        setGridLayout({ focusedPaneId: session.id });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!isProjectActive) onSelect();
          setActiveView("sessions");
          setGridLayout({ focusedPaneId: session.id });
        }
      }}
      className={`flex items-center gap-2 px-1 h-7 text-xs rounded-[var(--radius-element)] cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isWaiting ? "bg-warning/10 text-warning" : isError ? "bg-destructive/10 text-destructive" : "text-dim-foreground"}`}
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
        className={`ml-auto shrink-0 flex items-center gap-1 text-2xs ${isWaiting || isError ? "font-medium" : ""}`}
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
  const allSessions = useAppStore(
    (s) => s.projectSessions[projectId] ?? EMPTY_SESSIONS,
  );

  // Filter out chat sessions — they have their own top-level Chat view
  const sessions = useMemo(
    () => allSessions.filter((s) => s.mode !== "chat"),
    [allSessions],
  );

  return (
    <>
      <div className="px-1 pt-2.5 pb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
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
      <div className="px-1 pt-2.5 pb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        Worktrees
      </div>
      <div className="pb-1">
        {nonMainWorktrees.length === 0 ? (
          <div className="flex items-center gap-1.5 px-1 h-7 text-xs text-muted-foreground/60">
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
                tabIndex={0}
                role="button"
                aria-label={`Worktree: ${w.branch ?? w.path.split("/").pop() ?? "worktree"}${isActiveWorktree ? " (active)" : ""}`}
                aria-current={isActiveWorktree ? "true" : undefined}
                onClick={() => {
                  onSelect();
                  navigateToReview(w.path);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect();
                    navigateToReview(w.path);
                  }
                }}
                className={`flex items-center gap-1.5 px-1 h-7 text-xs rounded-[var(--radius-element)] cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isActiveWorktree ? "bg-accent text-foreground" : "text-dim-foreground"}`}
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
  onOpenSettings,
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
  onOpenSettings: () => void;
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
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
        aria-label={`${project.name}${isActive ? " (active)" : ""}`}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
        className={`group flex items-center gap-1.5 px-2 h-8 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
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
          className={`text-sm truncate min-w-0 flex-1 ${isActive ? "text-foreground font-medium" : "text-dim-foreground"}`}
        >
          {project.name}
          {branch && (
            <>
              <span className="text-muted-foreground/60 mx-1">·</span>
              <span className="text-2xs text-muted-foreground font-normal">{branch}</span>
            </>
          )}
          {isActive && changeCount != null && changeCount > 0 && (
            <span className="text-2xs text-warning font-normal ml-1">{changeCount}∆</span>
          )}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <span
                role="button"
                aria-label="Project actions"
                onClick={(e) => e.stopPropagation()}
                className="cursor-pointer text-muted-foreground hover:text-foreground opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0 inline-flex items-center justify-center size-5 rounded-sm hover:bg-accent/50"
              />
            }
          >
            <Ellipsis size={13} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="min-w-40">
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings size={14} />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClose}>
              <EyeOff size={14} />
              Hide Project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span
          role="button"
          tabIndex={0}
          aria-label={expanded ? "Collapse project" : "Expand project"}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setExpanded((prev) => !prev); } }}
          className="inline-flex w-4 justify-center shrink-0 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
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
  const setActiveView = useAppStore((s) => s.setActiveView);
  const closeProject = useAppStore((s) => s.closeProject);
  const addProjectFromPath = useAppStore((s) => s.addProjectFromPath);
  const [showIcons] = usePersistedBoolean("show_project_icons", true);
  const [manageProjectsOpen, setManageProjectsOpen] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
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

  const handleOpenProjectSettings = useCallback(
    (projectId: string) => {
      // Ensure the project is active, then navigate to project settings
      setActiveProject(projectId);
      setActiveView("settings");
    },
    [setActiveProject, setActiveView],
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
      role="navigation"
      aria-label="Project navigation"
      className="relative flex flex-col overflow-hidden select-none border-r border-border bg-card/60"
      style={{ gridArea: "sidebar" }}
    >
      {/* ── Branding + projects header ── */}
      <div className="flex items-center px-3 pt-1.5 pb-1 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <FaberLogo className="size-3.5 shrink-0 text-primary" />
          <span className="text-xs font-medium text-foreground">Faber</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          hoverEffect="none"
          clickEffect="none"
          onClick={() => setManageProjectsOpen(true)}
          aria-label="Manage projects"
          title="Manage projects"
        >
          <Settings size={13} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                hoverEffect="none"
                clickEffect="none"
                aria-label="Add project"
                title="Add project"
              />
            }
          >
            <Plus size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4} className="min-w-44">
            <DropdownMenuItem onClick={handleAddProject}>
              <FolderOpen size={14} />
              Open Existing…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowCreateProject(true)}>
              <FolderPlus size={14} />
              Create New…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showCreateProject && (
        <CreateProjectDialog onDismiss={() => setShowCreateProject(false)} />
      )}

      {manageProjectsOpen && (
        <Dialog open onOpenChange={(open) => { if (!open) setManageProjectsOpen(false); }}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Manage Projects</DialogTitle>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-y-auto -mx-6 px-6">
              <ManageProjectsTab />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Scrollable project list ── */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/60">
        {openProjects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isActive={project.id === activeProjectId}
            showIcons={showIcons}
            onSelect={() => handleSelectProject(project.id)}
            onClose={() => handleCloseProject(project.id)}
            onOpenSettings={() => handleOpenProjectSettings(project.id)}
          />
        ))}
      </div>

      <SidebarResizeHandle />
    </div>
  );
}
