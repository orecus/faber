import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ptyBuffer } from "../lib/ptyBuffer";
import type {
  AgentInfo,
  AgentUsageData,
  CommitInfo,
  ContinuousModeFinished,
  ContinuousModeUpdate,
  ContinuousRun,
  GhAuthStatus,
  McpComplete,
  McpError,
  McpProgressUpdate,
  McpSessionState,
  McpStatusUpdate,
  McpWaiting,
  Project,
  ProjectInfo,
  RefInfo,
  Session,
  ShellInfo,
  Task,
  ViewId,
  WorktreeInfo,
} from "../types";
import { layoutGraph, type GraphNode } from "../lib/graphLayout";
import {
  initNotifications,
  maybeNotify,
  updateNotificationSettings,
} from "../lib/notifications";

// ── Grid Layout State ──

export interface GridLayoutState {
  mode: "auto" | "1-up" | "2-up" | "2-up-v" | "4-up";
  maximizedPaneId: string | null;
  focusedPaneId: string | null;
  columnRatios: number[];
  rowRatios: number[];
  dismissedEndedSessionIds: string[];
  sessionOrder: string[];
}

const initialGridLayout: GridLayoutState = {
  mode: "auto",
  maximizedPaneId: null,
  focusedPaneId: null,
  columnRatios: [50, 50],
  rowRatios: [50, 50],
  dismissedEndedSessionIds: [],
  sessionOrder: [],
};

// ── Per-project Git Data ──

export interface ProjectGitData {
  commits: CommitInfo[];
  graphNodes: GraphNode[];
  headHash: string | null;
  refs: Map<string, RefInfo>;
  hasMore: boolean;
  allBranches: boolean;
}

const emptyGitData: ProjectGitData = {
  commits: [],
  graphNodes: [],
  headHash: null,
  refs: new Map(),
  hasMore: true,
  allBranches: true,
};

// ── Store Interface ──

interface AppState {
  // State fields
  projects: Project[];
  openProjectIds: string[];
  activeProjectId: string | null;
  activeView: ViewId;
  sessions: Session[];
  tasks: Task[];
  activeTaskId: string | null;
  projectInfo: ProjectInfo | null;
  commandPaletteOpen: boolean;
  gridLayout: GridLayoutState;
  agents: AgentInfo[];
  shells: ShellInfo[];
  mcpStatus: Record<string, McpSessionState>;
  backgroundTasks: string[];
  errorFlash: string | null;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightSidebarOpen: boolean;
  rightSidebarWidth: number;
  worktrees: WorktreeInfo[];
  reviewWorktreePath: string | null;
  ghAuthStatus: GhAuthStatus | null;
  continuousMode: Record<string, ContinuousRun>;
  agentUsage: AgentUsageData[];
  agentUsageLoading: boolean;

  // Per-project data (keyed by project ID) — source of truth for sidebar
  projectSessions: Record<string, Session[]>;
  projectWorktrees: Record<string, WorktreeInfo[]>;
  projectGitData: Record<string, ProjectGitData>;

  // Actions — state setters
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  removeProject: (id: string) => void;
  openProject: (id: string) => void;
  closeProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  setActiveView: (view: ViewId) => void;
  setSessions: (sessions: Session[]) => void;
  setTasks: (tasks: Task[]) => void;
  updateTask: (task: Task) => void;
  setActiveTask: (id: string | null) => void;
  setProjectInfo: (info: ProjectInfo | null) => void;
  toggleCommandPalette: () => void;
  closeCommandPalette: () => void;
  setGridLayout: (layout: Partial<GridLayoutState>) => void;
  reorderSession: (sessionId: string, newIndex: number) => void;
  dismissEndedPane: (sessionId: string) => void;
  setAgents: (agents: AgentInfo[]) => void;
  setShells: (shells: ShellInfo[]) => void;
  setMcpStatus: (sessionId: string, data: Partial<McpSessionState>) => void;
  cleanupSessionMcp: (sessionId: string) => void;
  addBackgroundTask: (label: string) => void;
  removeBackgroundTask: (label: string) => void;
  flashError: (message: string) => void;

  // Continuous mode
  setContinuousMode: (projectId: string, run: ContinuousRun | null) => void;

  // Per-project data actions
  updateProjectSessions: (projectId: string, sessions: Session[]) => void;
  updateProjectWorktrees: (projectId: string, worktrees: WorktreeInfo[]) => void;
  updateProjectGitData: (projectId: string, data: Partial<ProjectGitData>) => void;
  clearProjectGitData: (projectId: string) => void;

  // Sidebar
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (v: number) => void;
  setRightSidebarOpen: (v: boolean) => void;
  setRightSidebarWidth: (v: number) => void;
  toggleRightSidebar: () => void;

  // Worktrees / Diff Review
  setWorktrees: (worktrees: WorktreeInfo[]) => void;
  setReviewWorktreePath: (path: string | null) => void;
  navigateToReview: (worktreePath: string) => void;
  setGhAuthStatus: (status: GhAuthStatus | null) => void;
  /** Re-check gh auth status from backend and update the store. */
  refreshGhAuth: () => Promise<void>;

  // Agent usage
  fetchAgentUsage: () => Promise<void>;

  // Async actions
  addProjectFromPath: (path: string) => Promise<void>;
  initialize: () => () => void;
}

// Debounce timer for sidebar width persistence
let sidebarWidthTimer: ReturnType<typeof setTimeout> | null = null;
let rightSidebarWidthTimer: ReturnType<typeof setTimeout> | null = null;

/** Resolve a display name for a session from the store (searches all projects). */
function getSessionName(
  get: () => AppState,
  sessionId: string,
): string {
  // Check active project sessions first, then all project sessions
  const session = get().sessions.find((s) => s.id === sessionId)
    ?? Object.values(get().projectSessions).flat().find((s) => s.id === sessionId);
  return session?.name || session?.agent || sessionId;
}

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    // ── Initial State ──
    projects: [],
    openProjectIds: [],
    activeProjectId: null,
    activeView: "dashboard",
    sessions: [],
    tasks: [],
    activeTaskId: null,
    projectInfo: null,
    commandPaletteOpen: false,
    gridLayout: initialGridLayout,
    agents: [],
    shells: [],
    mcpStatus: {},
    backgroundTasks: [],
    errorFlash: null,
    sidebarCollapsed: false,
    sidebarWidth: 260,
    rightSidebarOpen: false,
    rightSidebarWidth: 300,
    worktrees: [],
    reviewWorktreePath: null,
    ghAuthStatus: null,
    continuousMode: {},
    agentUsage: [],
    agentUsageLoading: false,
    projectSessions: {},
    projectWorktrees: {},
    projectGitData: {},

    // ── Actions ──

    setProjects: (projects) =>
      set((state) => {
        const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
        const validIds = new Set(sorted.map((p) => p.id));
        const openProjectIds = state.openProjectIds.filter((id) => validIds.has(id));
        const activeProjectId =
          state.activeProjectId && validIds.has(state.activeProjectId)
            ? state.activeProjectId
            : openProjectIds[0] ?? null;
        return { projects: sorted, openProjectIds, activeProjectId };
      }),

    addProject: (project) =>
      set((state) => ({
        projects: [...state.projects, project].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        openProjectIds: [...state.openProjectIds, project.id],
        activeProjectId: project.id,
      })),

    updateProject: (project) =>
      set((state) => ({
        projects: state.projects
          .map((p) => (p.id === project.id ? project : p))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),

    removeProject: (id) =>
      set((state) => {
        const projects = state.projects.filter((p) => p.id !== id);
        const openProjectIds = state.openProjectIds.filter((pid) => pid !== id);
        let activeProjectId = state.activeProjectId;
        if (activeProjectId === id) {
          activeProjectId = openProjectIds[openProjectIds.length - 1] ?? null;
        }
        // Clean up per-project data
        const { [id]: _s, ...restSessions } = state.projectSessions;
        const { [id]: _w, ...restWorktrees } = state.projectWorktrees;
        const { [id]: _g, ...restGitData } = state.projectGitData;
        return {
          projects,
          openProjectIds,
          activeProjectId,
          projectSessions: restSessions,
          projectWorktrees: restWorktrees,
          projectGitData: restGitData,
        };
      }),

    openProject: (id) =>
      set((state) => {
        const openProjectIds = state.openProjectIds.includes(id)
          ? state.openProjectIds
          : [...state.openProjectIds, id];
        return { openProjectIds, activeProjectId: id };
      }),

    closeProject: (id) =>
      set((state) => {
        const openProjectIds = state.openProjectIds.filter((pid) => pid !== id);
        let activeProjectId = state.activeProjectId;
        if (activeProjectId === id) {
          activeProjectId = openProjectIds[openProjectIds.length - 1] ?? null;
        }
        // Clean up per-project data
        const { [id]: _s, ...restSessions } = state.projectSessions;
        const { [id]: _w, ...restWorktrees } = state.projectWorktrees;
        const { [id]: _g, ...restGitData } = state.projectGitData;
        return {
          openProjectIds,
          activeProjectId,
          projectSessions: restSessions,
          projectWorktrees: restWorktrees,
          projectGitData: restGitData,
        };
      }),

    setActiveProject: (id) => set({ activeProjectId: id }),

    setActiveView: (view) => set({ activeView: view }),

    setSessions: (sessions) =>
      set((state) => {
        const freshIds = new Set(sessions.map((s) => s.id));
        const stillRelevant = state.gridLayout.dismissedEndedSessionIds.filter((id) =>
          freshIds.has(id),
        );
        // Reconcile sessionOrder: keep existing ordered IDs that still exist, append new ones
        const prevOrder = state.gridLayout.sessionOrder;
        const kept = prevOrder.filter((id) => freshIds.has(id));
        const keptSet = new Set(kept);
        const appended = sessions.filter((s) => !keptSet.has(s.id)).map((s) => s.id);
        // Clear maximizedPaneId if the session no longer exists
        const prevMax = state.gridLayout.maximizedPaneId;
        const newMax = prevMax && freshIds.has(prevMax) ? prevMax : null;
        return {
          sessions,
          gridLayout: {
            ...state.gridLayout,
            dismissedEndedSessionIds: stillRelevant,
            sessionOrder: [...kept, ...appended],
            maximizedPaneId: newMax,
          },
        };
      }),

    setTasks: (tasks) => set({ tasks }),

    updateTask: (task) =>
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
      })),

    setActiveTask: (id) => set({ activeTaskId: id }),

    setProjectInfo: (info) => set({ projectInfo: info }),

    toggleCommandPalette: () =>
      set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

    closeCommandPalette: () => set({ commandPaletteOpen: false }),

    setGridLayout: (layout) =>
      set((state) => ({ gridLayout: { ...state.gridLayout, ...layout } })),

    reorderSession: (sessionId, newIndex) =>
      set((state) => {
        const order = [...state.gridLayout.sessionOrder];
        const oldIndex = order.indexOf(sessionId);
        if (oldIndex === -1) return state;
        order.splice(oldIndex, 1);
        order.splice(newIndex, 0, sessionId);
        return { gridLayout: { ...state.gridLayout, sessionOrder: order } };
      }),

    dismissEndedPane: (sessionId) => {
      const pid = get().activeProjectId;
      set((state) => {
        // Also remove from projectSessions so the sidebar updates immediately
        const updatedProjectSessions = pid && state.projectSessions[pid]
          ? {
              ...state.projectSessions,
              [pid]: state.projectSessions[pid].filter((s) => s.id !== sessionId),
            }
          : state.projectSessions;

        return {
          sessions: state.sessions.filter((s) => s.id !== sessionId),
          projectSessions: updatedProjectSessions,
          gridLayout: {
            ...state.gridLayout,
            dismissedEndedSessionIds: [
              ...state.gridLayout.dismissedEndedSessionIds,
              sessionId,
            ],
            sessionOrder: state.gridLayout.sessionOrder.filter((id) => id !== sessionId),
            maximizedPaneId:
              state.gridLayout.maximizedPaneId === sessionId
                ? null
                : state.gridLayout.maximizedPaneId,
          },
        };
      });
      // Clean up MCP state + attention counters for the dismissed session
      if (get().mcpStatus[sessionId]) {
        get().cleanupSessionMcp(sessionId);
      }
    },

    setAgents: (agents) => set({ agents }),

    setShells: (shells) => set({ shells }),

    setMcpStatus: (sessionId, data) =>
      set((state) => {
        const prev = state.mcpStatus[sessionId] ?? {};
        return {
          mcpStatus: {
            ...state.mcpStatus,
            [sessionId]: { ...prev, ...data },
          },
        };
      }),

    cleanupSessionMcp: (sessionId) => {
      set((state) => {
        const { [sessionId]: _, ...rest } = state.mcpStatus;
        return { mcpStatus: rest };
      });
    },

    addBackgroundTask: (label) =>
      set((state) => ({
        backgroundTasks: state.backgroundTasks.includes(label)
          ? state.backgroundTasks
          : [...state.backgroundTasks, label],
      })),

    removeBackgroundTask: (label) =>
      set((state) => ({
        backgroundTasks: state.backgroundTasks.filter((t) => t !== label),
      })),

    flashError: (message) => {
      set({ errorFlash: message });
      setTimeout(() => set({ errorFlash: null }), 4000);
    },

    // ── Per-project data actions ──

    updateProjectSessions: (projectId, sessions) => {
      set((state) => ({
        projectSessions: { ...state.projectSessions, [projectId]: sessions },
      }));
      // If this is the active project, also reconcile the grid-view sessions
      if (projectId === get().activeProjectId) {
        get().setSessions(sessions);
      }
    },

    updateProjectWorktrees: (projectId, worktrees) => {
      set((state) => ({
        projectWorktrees: { ...state.projectWorktrees, [projectId]: worktrees },
      }));
      if (projectId === get().activeProjectId) {
        set({ worktrees });
      }
    },

    updateProjectGitData: (projectId, data) =>
      set((state) => {
        const prev = state.projectGitData[projectId] ?? emptyGitData;
        const merged = { ...prev, ...data };
        // Recompute graphNodes whenever commits change
        if (data.commits) {
          merged.graphNodes = layoutGraph(merged.commits);
        }
        return {
          projectGitData: { ...state.projectGitData, [projectId]: merged },
        };
      }),

    clearProjectGitData: (projectId) =>
      set((state) => {
        const { [projectId]: _, ...rest } = state.projectGitData;
        return { projectGitData: rest };
      }),

    // ── Sidebar persistence ──

    setSidebarCollapsed: (v) => {
      set({ sidebarCollapsed: v });
      invoke("set_setting", { key: "sidebar_collapsed", value: String(v) }).catch(() => {});
    },

    setSidebarWidth: (v) => {
      set({ sidebarWidth: v });
      if (sidebarWidthTimer) clearTimeout(sidebarWidthTimer);
      sidebarWidthTimer = setTimeout(() => {
        invoke("set_setting", { key: "sidebar_width", value: String(v) }).catch(() => {});
      }, 300);
    },

    setRightSidebarOpen: (v) => {
      set({ rightSidebarOpen: v });
      invoke("set_setting", { key: "right_sidebar_open", value: String(v) }).catch(() => {});
    },

    setRightSidebarWidth: (v) => {
      set({ rightSidebarWidth: v });
      if (rightSidebarWidthTimer) clearTimeout(rightSidebarWidthTimer);
      rightSidebarWidthTimer = setTimeout(() => {
        invoke("set_setting", { key: "right_sidebar_width", value: String(v) }).catch(() => {});
      }, 300);
    },

    toggleRightSidebar: () => {
      const next = !get().rightSidebarOpen;
      set({ rightSidebarOpen: next });
      invoke("set_setting", { key: "right_sidebar_open", value: String(next) }).catch(() => {});
    },

    // ── Worktrees / Diff Review ──

    setWorktrees: (worktrees) => set({ worktrees }),

    setReviewWorktreePath: (path) => set({ reviewWorktreePath: path }),

    navigateToReview: (worktreePath) =>
      set({ reviewWorktreePath: worktreePath, activeView: "review" }),

    setGhAuthStatus: (status) => set({ ghAuthStatus: status }),

    refreshGhAuth: async () => {
      try {
        const status = await invoke<GhAuthStatus>("check_gh_auth");
        set({ ghAuthStatus: status });
      } catch {
        set({
          ghAuthStatus: {
            installed: false,
            authenticated: false,
            username: null,
            error: "Failed to check gh auth status",
            token_source: null,
            missing_scopes: [],
            has_scope_warnings: false,
          },
        });
      }
    },

    // ── Continuous mode ──

    setContinuousMode: (projectId, run) =>
      set((state) => {
        if (run === null) {
          const { [projectId]: _, ...rest } = state.continuousMode;
          return { continuousMode: rest };
        }
        return {
          continuousMode: { ...state.continuousMode, [projectId]: run },
        };
      }),

    // ── Agent usage ──

    fetchAgentUsage: async () => {
      set({ agentUsageLoading: true });
      try {
        const data = await invoke<AgentUsageData[]>("get_agent_usage");
        set({ agentUsage: data });
      } catch {
        // Silently fail — usage is non-critical
      } finally {
        set({ agentUsageLoading: false });
      }
    },

    // ── Async actions ──

    addProjectFromPath: async (path) => {
      const project = await invoke<Project>("add_project", { path });
      get().addProject(project);
    },

    // ── Initialize — called once on mount, returns cleanup function ──

    initialize: () => {
      const cleanups: (() => void)[] = [];
      const { addBackgroundTask, removeBackgroundTask } = get();

      // ── Helper: refresh sessions + worktrees for a single project ──
      // Debounced per project ID (200ms) to avoid duplicate IPC calls
      // when multiple session events fire in quick succession.
      const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const refreshProject = (pid: string) => {
        const existing = refreshTimers.get(pid);
        if (existing) clearTimeout(existing);
        refreshTimers.set(
          pid,
          setTimeout(() => {
            refreshTimers.delete(pid);
            invoke<Session[]>("list_sessions", { projectId: pid })
              .then((sessions) => get().updateProjectSessions(pid, sessions))
              .catch(() => {});
            invoke<WorktreeInfo[]>("list_worktrees", { projectId: pid })
              .then((worktrees) => get().updateProjectWorktrees(pid, worktrees))
              .catch(() => {});
          }, 200),
        );
      };

      /** Look up a session's project ID from the per-project session cache. */
      const findProjectForSession = (sessionId: string): string | null => {
        for (const [pid, sessions] of Object.entries(get().projectSessions)) {
          if (sessions.some((s) => s.id === sessionId)) return pid;
        }
        return null;
      };

      // Load ALL settings in a single IPC call instead of 8+ individual get_setting calls.
      // The backend's get_all_settings command returns every global setting at once.
      invoke<{ key: string; value: string }[]>("get_all_settings")
        .then((settings) => {
          const map = new Map(settings.map((s) => [s.key, s.value]));
          // Sidebar settings
          const patch: Partial<ReturnType<typeof get>> = {};
          const sc = map.get("sidebar_collapsed");
          if (sc != null) (patch as Record<string, unknown>).sidebarCollapsed = sc === "true";
          const sw = map.get("sidebar_width");
          if (sw != null) { const n = Number(sw); if (!isNaN(n)) (patch as Record<string, unknown>).sidebarWidth = n; }
          const rso = map.get("right_sidebar_open");
          if (rso != null) (patch as Record<string, unknown>).rightSidebarOpen = rso === "true";
          const rsw = map.get("right_sidebar_width");
          if (rsw != null) { const n = Number(rsw); if (!isNaN(n)) (patch as Record<string, unknown>).rightSidebarWidth = n; }
          if (Object.keys(patch).length > 0) set(patch);

          // Notification settings
          updateNotificationSettings({
            enabled: map.get("notifications_enabled") !== "false",
            on_complete: map.get("notifications_on_complete") !== "false",
            on_error: map.get("notifications_on_error") !== "false",
            on_waiting: map.get("notifications_on_waiting") !== "false",
          });
        })
        .catch(() => {});

      const cleanupNotifications = initNotifications((sessionId) => {
        // Navigate to the session's project and terminal grid
        const session = get().sessions.find((s) => s.id === sessionId)
          ?? Object.values(get().projectSessions).flat().find((s) => s.id === sessionId);
        if (session) {
          if (session.project_id !== get().activeProjectId) {
            get().setActiveProject(session.project_id);
          }
          set({ activeView: "sessions" });
          get().setGridLayout({ focusedPaneId: sessionId });
        }
      });
      cleanups.push(cleanupNotifications);

      // Detect agents and shells
      addBackgroundTask("Detecting agents");
      invoke<AgentInfo[]>("list_agents")
        .then((agents) => set({ agents }))
        .catch(() => {})
        .finally(() => removeBackgroundTask("Detecting agents"));

      addBackgroundTask("Detecting shells");
      invoke<ShellInfo[]>("list_available_shells")
        .then((shells) => set({ shells }))
        .catch(() => {})
        .finally(() => removeBackgroundTask("Detecting shells"));

      // Fetch agent usage data and start 60s polling
      get().fetchAgentUsage();
      const usageInterval = setInterval(() => {
        get().fetchAgentUsage();
      }, 60_000);
      cleanups.push(() => clearInterval(usageInterval));

      // Check GitHub CLI auth status (tracked as background task)
      addBackgroundTask("Checking GitHub auth");
      invoke<GhAuthStatus>("check_gh_auth")
        .then((status) => set({ ghAuthStatus: status }))
        .catch(() =>
          set({
            ghAuthStatus: {
              installed: false,
              authenticated: false,
              username: null,
              error: "Failed to check gh auth status",
              token_source: null,
              missing_scopes: [],
              has_scope_warnings: false,
            },
          }),
        )
        .finally(() => removeBackgroundTask("Checking GitHub auth"));

      // Load projects, then load sessions/worktrees for all of them
      addBackgroundTask("Loading projects");
      invoke<Project[]>("list_projects")
        .then((projects) => {
          // Batch all project state into a single set() to avoid N+1 re-renders
          const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
          const allIds = sorted.map((p) => p.id);
          set({
            projects: sorted,
            openProjectIds: allIds,
            activeProjectId: allIds[0] ?? null,
          });
          // Load sessions + worktrees for every open project
          for (const p of projects) {
            refreshProject(p.id);
          }
        })
        .catch(() => {})
        .finally(() => removeBackgroundTask("Loading projects"));

      // Watch activeProjectId changes to load project data.
      // Tasks are deferred slightly so tab-switch animations can complete without jank.
      // Sessions/worktrees are applied instantly from the per-project cache.
      let deferredLoadTimer: ReturnType<typeof setTimeout> | null = null;
      const unsubActiveProject = useAppStore.subscribe(
        (s) => s.activeProjectId,
        (pid, prevPid) => {
          if (deferredLoadTimer) {
            clearTimeout(deferredLoadTimer);
            deferredLoadTimer = null;
          }

          const { addBackgroundTask: addBg, removeBackgroundTask: rmBg } = get();

          // Clear stale diff review state immediately on any project switch
          set({ reviewWorktreePath: null });

          // Reset project-specific views to dashboard so the user never sees
          // "Task not found" errors from the previous project.
          const currentView = get().activeView;
          const projectSpecificViews: Set<string> = new Set([
            "task-detail",
            "review",
            "github",
          ]);
          if (projectSpecificViews.has(currentView)) {
            set({ activeView: "dashboard" as const });
          }
          // Always clear the selected task — it belongs to the old project
          set({ activeTaskId: null });

          if (!pid) {
            set({ projectInfo: null, sessions: [], tasks: [], worktrees: [] });
            return;
          }

          // Instantly apply cached sessions/worktrees for the new project
          get().setSessions(get().projectSessions[pid] ?? []);
          set({ worktrees: get().projectWorktrees[pid] ?? [] });

          addBg("Loading project info");
          invoke<ProjectInfo>("get_project_info", { id: pid })
            .then((info) => set({ projectInfo: info }))
            .catch(() => set({ projectInfo: null }))
            .finally(() => rmBg("Loading project info"));

          deferredLoadTimer = setTimeout(() => {
            // Bail if the active project changed while we waited
            if (get().activeProjectId !== pid) return;

            addBg("Syncing tasks");
            invoke("sync_tasks", { projectId: pid })
              .then(() => invoke<Task[]>("list_tasks", { projectId: pid }))
              .then((tasks) => set({ tasks }))
              .catch(() => set({ tasks: [] }))
              .finally(() => rmBg("Syncing tasks"));

            // Start file watcher for the new project
            invoke("start_task_watcher", { projectId: pid }).catch(() => {});

            // Also refresh sessions/worktrees from backend for freshness
            // (skip during initial load — the list_projects handler already triggers refreshProject)
            if (get().projectSessions[pid] == null) {
              refreshProject(pid);
            }
          }, 250);

          // Stop watcher for previous project (if any)
          if (prevPid && prevPid !== pid) {
            invoke("stop_task_watcher", { projectId: prevPid }).catch(() => {});
          }
        },
      );
      cleanups.push(unsubActiveProject);
      cleanups.push(() => { if (deferredLoadTimer) clearTimeout(deferredLoadTimer); });

      // Keyboard shortcuts
      function handleKeyDown(e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
          e.preventDefault();
          get().toggleCommandPalette();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "b") {
          e.preventDefault();
          get().toggleRightSidebar();
        }
        if (e.key === "Escape" && get().commandPaletteOpen) {
          get().closeCommandPalette();
        }
      }
      window.addEventListener("keydown", handleKeyDown);
      cleanups.push(() => window.removeEventListener("keydown", handleKeyDown));

      // ── Centralized event listeners ──
      // All session/worktree refreshes happen here. Components read from the store.
      const eventCleanups: Promise<() => void>[] = [];

      // Session started/stopped — payload is a full Session with project_id.
      // Only refresh the affected project (not all open projects).
      // Task status changes are handled by the separate "task-updated" event,
      // so no sync_tasks needed here.
      for (const event of ["session-started", "session-stopped"]) {
        eventCleanups.push(
          listen<Session>(event, (e) => {
            const pid = e.payload.project_id;
            if (pid) {
              refreshProject(pid);
            }
          }),
        );
      }

      // Session removed — atomic stop+delete already happened on the backend.
      // Surgically remove from store without triggering a full refresh.
      eventCleanups.push(
        listen<{ session_id: string; project_id: string }>(
          "session-removed",
          (e) => {
            const { session_id, project_id } = e.payload;
            set((state) => {
              const filterOut = (s: Session) => s.id !== session_id;
              const prevProjectSessions = state.projectSessions[project_id];
              return {
                sessions: state.sessions.filter(filterOut),
                projectSessions: prevProjectSessions
                  ? {
                      ...state.projectSessions,
                      [project_id]: prevProjectSessions.filter(filterOut),
                    }
                  : state.projectSessions,
                gridLayout: {
                  ...state.gridLayout,
                  dismissedEndedSessionIds:
                    state.gridLayout.dismissedEndedSessionIds.filter(
                      (id) => id !== session_id,
                    ),
                  sessionOrder: state.gridLayout.sessionOrder.filter(
                    (id) => id !== session_id,
                  ),
                  maximizedPaneId:
                    state.gridLayout.maximizedPaneId === session_id
                      ? null
                      : state.gridLayout.maximizedPaneId,
                },
              };
            });
            // Also clean up MCP state + attention counters for the removed session
            get().cleanupSessionMcp(session_id);
            // Refresh worktrees for the project (worktree may have been cleaned up)
            invoke<WorktreeInfo[]>("list_worktrees", { projectId: project_id })
              .then((worktrees) => get().updateProjectWorktrees(project_id, worktrees))
              .catch(() => {});
          },
        ),
      );

      // Session status changed — payload has session_id but no project_id.
      // Look up the owning project from our cache.
      eventCleanups.push(
        listen<{ session_id: string; new_status?: string }>(
          "session-status-changed",
          (e) => {
            const { session_id, new_status } = e.payload;
            const pid = findProjectForSession(session_id);
            if (pid) {
              refreshProject(pid);
            }
            // When a session reaches a terminal state, clean up MCP state
            // so the connected-client counter stays in sync, and clear the
            // PTY output buffer to avoid retaining sensitive terminal content.
            if (
              new_status === "stopped" ||
              new_status === "finished" ||
              new_status === "error"
            ) {
              get().cleanupSessionMcp(session_id);
              ptyBuffer.clear(session_id);
            }
          },
        ),
      );

      // PTY natural exit — same lookup pattern.
      eventCleanups.push(
        listen<{ session_id: string }>("pty-exit", (e) => {
          const { session_id } = e.payload;
          const pid = findProjectForSession(session_id);
          if (pid) {
            refreshProject(pid);
          }
          // Agent process exited — clean up MCP state + attention counters
          // so the sidebar stays accurate.
          get().cleanupSessionMcp(session_id);
        }),
      );

      // MCP event listeners

      eventCleanups.push(
        listen<McpStatusUpdate>("mcp-status-update", (event) => {
          const newStatus = event.payload.status;

          const data: Partial<McpSessionState> = {
            status: newStatus,
            message: event.payload.message,
            activity: newStatus === "working" ? (event.payload.activity ?? undefined) : undefined,
          };
          if (newStatus === "waiting") {
            // Agent used report_status("waiting", ...) instead of report_waiting
            data.waiting = true;
            data.waiting_question = event.payload.message;
          } else {
            data.waiting = false;
            data.waiting_question = undefined;
          }
          if (newStatus === "error") {
            // Agent used report_status("error", ...) instead of report_error
            data.error = true;
            data.error_message = event.payload.message;
          } else {
            data.error = false;
            data.error_message = undefined;
          }
          if (newStatus !== "done") {
            // Agent resumed work after completion — clear stale completed/progress state
            data.completed = false;
            data.summary = undefined;
            data.current_step = undefined;
            data.total_steps = undefined;
            data.description = undefined;
          }
          get().setMcpStatus(event.payload.session_id, data);
        }),
      );

      eventCleanups.push(
        listen<McpProgressUpdate>("mcp-progress-update", (event) => {
          get().setMcpStatus(event.payload.session_id, {
            current_step: event.payload.current_step,
            total_steps: event.payload.total_steps,
            description: event.payload.description,
            // Agent is actively working — clear any stale completed/waiting/error state
            status: "working",
            completed: false,
            summary: undefined,
            waiting: false,
            waiting_question: undefined,
            error: false,
            error_message: undefined,
          });
        }),
      );

      eventCleanups.push(
        listen<McpWaiting>("mcp-waiting", (event) => {
          const { project_id, session_id } = event.payload;

          get().setMcpStatus(session_id, {
            status: "waiting",
            message: event.payload.question,
            waiting: true,
            waiting_question: event.payload.question,
            error: false,
            error_message: undefined,
          });

          const sessionName = getSessionName(get, session_id);
          maybeNotify(
            "waiting",
            session_id,
            sessionName,
            event.payload.question,
            get().activeView,
            project_id === get().activeProjectId,
          );
        }),
      );

      eventCleanups.push(
        listen<McpError>("mcp-error", (event) => {
          const { project_id, session_id } = event.payload;

          get().setMcpStatus(session_id, {
            status: "error",
            message: event.payload.error,
            error: true,
            error_message: event.payload.error,
            // Clear stale waiting/completed state — error takes precedence
            waiting: false,
            waiting_question: undefined,
            completed: false,
            summary: undefined,
          });

          const sessionName = getSessionName(get, session_id);
          maybeNotify(
            "error",
            session_id,
            sessionName,
            event.payload.error,
            get().activeView,
            project_id === get().activeProjectId,
          );
        }),
      );

      eventCleanups.push(
        listen<McpComplete>("mcp-complete", (event) => {
          const { project_id, session_id } = event.payload;

          get().setMcpStatus(session_id, {
            status: "done",
            completed: true,
            summary: event.payload.summary,
            waiting: false,
            waiting_question: undefined,
            error: false,
            error_message: undefined,
            activity: undefined,
          });

          const sessionName = getSessionName(get, session_id);
          maybeNotify(
            "complete",
            session_id,
            sessionName,
            event.payload.summary || "Task completed successfully",
            get().activeView,
            project_id === get().activeProjectId,
          );
        }),
      );

      eventCleanups.push(
        listen<Task>("task-updated", (event) => {
          get().updateTask(event.payload);
        }),
      );

      // File watcher: tasks-updated event (batch refresh from disk sync)
      eventCleanups.push(
        listen<string>("tasks-updated", (event) => {
          const projectId = event.payload;
          if (projectId === get().activeProjectId) {
            invoke<Task[]>("list_tasks", { projectId })
              .then((tasks) => set({ tasks }))
              .catch(() => {});
          }
        }),
      );

      // Continuous mode events
      eventCleanups.push(
        listen<ContinuousModeUpdate>("continuous-mode-update", (event) => {
          const { project_id, run } = event.payload;
          get().setContinuousMode(project_id, run);
        }),
      );

      eventCleanups.push(
        listen<ContinuousModeFinished>("continuous-mode-finished", (event) => {
          const { project_id, completed_count } = event.payload;
          get().setContinuousMode(project_id, null);
          // Refresh tasks for the project since statuses changed
          invoke<Task[]>("list_tasks", { projectId: project_id })
            .then((tasks) => {
              if (project_id === get().activeProjectId) {
                set({ tasks });
              }
            })
            .catch(() => {});
          // Send notification
          maybeNotify(
            "complete",
            `continuous-${project_id}`,
            "Continuous Mode",
            `All ${completed_count} tasks completed`,
            get().activeView,
            project_id === get().activeProjectId,
          );
        }),
      );

      // Cleanup for event listeners
      cleanups.push(() => {
        for (const p of eventCleanups) {
          p.then((unsub) => unsub());
        }
      });

      // Clean up debounce timers for refreshProject
      cleanups.push(() => {
        for (const timer of refreshTimers.values()) clearTimeout(timer);
        refreshTimers.clear();
      });

      return () => {
        for (const cleanup of cleanups) cleanup();
      };
    },
  })),
);
