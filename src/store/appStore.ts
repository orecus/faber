import { startTransition } from "react";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ptyBuffer } from "../lib/ptyBuffer";
import type {
  AcpAvailableCommand,
  AcpAvailableCommandsUpdate,
  AcpChatMessage,
  AcpConfigOption,
  AcpConfigOptionUpdate,
  AcpError,
  AcpMessageChunk,
  AcpModeUpdate,
  AcpPlanEntry,
  AcpPlanUpdate,
  AcpPromptComplete,
  AcpRegistryEntry,
  AcpSessionInfo,
  AcpToolCall,
  AcpToolCallState,
  AcpToolCallUpdate,
  AcpUsageData,
  AgentInfo,
  AgentUsageData,
  CommitInfo,
  ContinuousModeFinished,
  ContinuousModeUpdate,
  ContinuousRun,
  GhAuthStatus,
  McpComplete,
  McpError as McpErrorEvent,
  McpProgressUpdate,
  McpSessionState,
  McpStatusUpdate,
  McpWaiting,
  Project,
  ProjectInfo,
  PromptTemplate,
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
  previousView: ViewId | null;
  sessions: Session[];
  tasks: Task[];
  activeTaskId: string | null;
  projectInfo: ProjectInfo | null;
  commandPaletteOpen: boolean;
  gridLayout: GridLayoutState;
  agents: AgentInfo[];
  acpRegistry: AcpRegistryEntry[];
  acpRegistryLoading: boolean;
  acpRegistryError: string | null;
  acpUpdatesAvailable: number;
  shells: ShellInfo[];
  mcpStatus: Record<string, McpSessionState>;

  // ACP chat state (per-session)
  acpMessages: Record<string, AcpChatMessage[]>;
  acpToolCalls: Record<string, AcpToolCallState[]>;
  acpPlans: Record<string, AcpPlanEntry[]>;
  acpModes: Record<string, string>;
  acpModels: Record<string, string>;
  acpPromptPending: Record<string, boolean>;
  /** Accumulated thinking text per session (from AgentThoughtChunk events). */
  acpThinking: Record<string, string>;
  /** Timestamp when thinking started for each session (for duration tracking). */
  acpThinkingStartTime: Record<string, number>;
  /** Flushed thinking blocks per session (standalone timeline items). */
  acpThinkingBlocks: Record<string, import("../types").AcpThinkingBlock[]>;
  /** Whether a tool call has arrived since the last message chunk (per session). */
  acpHadToolCallSinceChunk: Record<string, boolean>;
  acpPermissionRequests: Record<string, import("../types").AcpPermissionRequest[]>;
  /** Available slash commands per ACP session (from AvailableCommandsUpdate). */
  acpAvailableCommands: Record<string, AcpAvailableCommand[]>;
  /** Config options per ACP session (from ConfigOptionUpdate). */
  acpConfigOptions: Record<string, AcpConfigOption[]>;
  /** Context window usage + cost per ACP session (from UsageUpdate). */
  acpUsage: Record<string, AcpUsageData>;

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
  promptTemplates: PromptTemplate[];

  // Per-project data (keyed by project ID) — source of truth for sidebar
  projectSessions: Record<string, Session[]>;
  projectWorktrees: Record<string, WorktreeInfo[]>;
  projectGitData: Record<string, ProjectGitData>;
  projectBranches: Record<string, string | null>;

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
  fetchAcpRegistry: (forceRefresh?: boolean) => Promise<void>;
  setShells: (shells: ShellInfo[]) => void;
  setMcpStatus: (sessionId: string, data: Partial<McpSessionState>) => void;
  cleanupSessionMcp: (sessionId: string) => void;

  // ACP actions
  appendAcpChunk: (sessionId: string, text: string, forceNew?: boolean) => void;
  addAcpUserMessage: (sessionId: string, text: string, attachments?: import("../types").AcpMessageAttachment[]) => void;
  addAcpToolCall: (sessionId: string, tc: AcpToolCallState) => void;
  updateAcpToolCall: (sessionId: string, toolCallId: string, status: string, title: string | null, content?: import("../types").ToolCallContentItem[] | null) => void;
  setAcpPlan: (sessionId: string, entries: AcpPlanEntry[]) => void;
  setAcpMode: (sessionId: string, mode: string) => void;
  setAcpModel: (sessionId: string, model: string) => void;
  setAcpPromptPending: (sessionId: string, pending: boolean) => void;
  appendAcpThinking: (sessionId: string, text: string) => void;
  flushAcpThinking: (sessionId: string) => void;
  clearAcpThinking: (sessionId: string) => void;
  addAcpPermissionRequest: (sessionId: string, request: import("../types").AcpPermissionRequest) => void;
  removeAcpPermissionRequest: (sessionId: string, requestId: string) => void;
  setAcpAvailableCommands: (sessionId: string, commands: AcpAvailableCommand[]) => void;
  setAcpConfigOptions: (sessionId: string, options: AcpConfigOption[]) => void;
  setAcpUsage: (sessionId: string, data: AcpUsageData) => void;
  cleanupSessionAcp: (sessionId: string) => void;

  addBackgroundTask: (label: string) => void;
  removeBackgroundTask: (label: string) => void;
  flashError: (message: string) => void;

  // Research → Implementation flow
  /** Session IDs of research sessions that have completed (for showing the "Continue to Implementation" bar). */
  researchCompleteSessionIds: string[];
  /** Session ID for which we should show the LaunchTaskDialog (triggered from ResearchCompleteBar). */
  launchTaskForSessionId: string | null;
  /** Mark a research session as complete (shows the implementation prompt bar). */
  addResearchComplete: (sessionId: string) => void;
  /** Dismiss the research complete bar for a session (user chose not to continue). */
  dismissResearchComplete: (sessionId: string) => void;
  /** Set the session ID to show LaunchTaskDialog for (null to close). */
  setLaunchTaskForSession: (sessionId: string | null) => void;

  // Continuous mode
  setContinuousMode: (projectId: string, run: ContinuousRun | null) => void;

  // Per-project data actions
  updateProjectSessions: (projectId: string, sessions: Session[]) => void;
  updateProjectWorktrees: (projectId: string, worktrees: WorktreeInfo[]) => void;
  updateProjectGitData: (projectId: string, data: Partial<ProjectGitData>) => void;
  clearProjectGitData: (projectId: string) => void;
  refreshProjectBranches: () => void;

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

  // Prompt templates
  loadPromptTemplates: () => Promise<void>;
  savePromptTemplates: (templates: PromptTemplate[]) => Promise<void>;
  resetPromptTemplates: () => Promise<void>;
  getSessionPrompt: (mode: string) => PromptTemplate | undefined;

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
    previousView: null,
    sessions: [],
    tasks: [],
    activeTaskId: null,
    projectInfo: null,
    commandPaletteOpen: false,
    gridLayout: initialGridLayout,
    agents: [],
    acpRegistry: [],
    acpRegistryLoading: false,
    acpRegistryError: null,
    acpUpdatesAvailable: 0,
    shells: [],
    mcpStatus: {},
    acpMessages: {},
    acpToolCalls: {},
    acpPlans: {},
    acpModes: {},
    acpModels: {},
    acpPromptPending: {},
    acpThinking: {},
    acpThinkingStartTime: {},
    acpThinkingBlocks: {},
    acpHadToolCallSinceChunk: {},
    acpPermissionRequests: {},
    acpAvailableCommands: {},
    acpConfigOptions: {},
    acpUsage: {},
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
    promptTemplates: [],
    projectSessions: {},
    projectWorktrees: {},
    projectGitData: {},
    projectBranches: {},

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
        // Persist if filtered list changed
        if (openProjectIds.length !== state.openProjectIds.length) {
          invoke("set_setting", { key: "open_project_ids", value: JSON.stringify(openProjectIds) }).catch(() => {});
        }
        return { projects: sorted, openProjectIds, activeProjectId };
      }),

    addProject: (project) =>
      set((state) => {
        const openProjectIds = [...state.openProjectIds, project.id];
        invoke("set_setting", { key: "open_project_ids", value: JSON.stringify(openProjectIds) }).catch(() => {});
        return {
          projects: [...state.projects, project].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
          openProjectIds,
          activeProjectId: project.id,
        };
      }),

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
        invoke("set_setting", { key: "open_project_ids", value: JSON.stringify(openProjectIds) }).catch(() => {});
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
        invoke("set_setting", { key: "open_project_ids", value: JSON.stringify(openProjectIds) }).catch(() => {});
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
        invoke("set_setting", { key: "open_project_ids", value: JSON.stringify(openProjectIds) }).catch(() => {});
        return {
          openProjectIds,
          activeProjectId,
          projectSessions: restSessions,
          projectWorktrees: restWorktrees,
          projectGitData: restGitData,
        };
      }),

    setActiveProject: (id) => set({ activeProjectId: id }),

    setActiveView: (view) =>
      startTransition(() => {
        const current = get().activeView;
        set({ activeView: view, previousView: current !== view ? current : get().previousView });
      }),

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
      // Clean up MCP + ACP state for the dismissed session
      if (get().mcpStatus[sessionId]) {
        get().cleanupSessionMcp(sessionId);
      }
      if (get().acpMessages[sessionId]) {
        get().cleanupSessionAcp(sessionId);
      }
    },

    setAgents: (agents) => set({ agents }),

    fetchAcpRegistry: async (forceRefresh = false) => {
      set({ acpRegistryLoading: true, acpRegistryError: null });
      try {
        const entries = await invoke<AcpRegistryEntry[]>("fetch_acp_registry", {
          forceRefresh,
        });
        const updateCount = entries.filter((e) => e.update_available).length;
        set({ acpRegistry: entries, acpRegistryLoading: false, acpUpdatesAvailable: updateCount });
      } catch (err) {
        set({
          acpRegistryLoading: false,
          acpRegistryError: err instanceof Error ? err.message : String(err),
        });
      }
    },

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

    // ── ACP actions ──

    appendAcpChunk: (sessionId, text, forceNew = false) =>
      set((state) => {
        const msgs = [...(state.acpMessages[sessionId] ?? [])];
        const last = msgs[msgs.length - 1];
        if (!forceNew && last && last.role === "agent") {
          // Append to the current agent message (streaming)
          msgs[msgs.length - 1] = { ...last, text: last.text + text };
          return { acpMessages: { ...state.acpMessages, [sessionId]: msgs } };
        } else {
          // Start a new agent message — mark as narration if forced by tool-call boundary
          const now = Date.now();
          msgs.push({
            id: `msg_${now}_${Math.random().toString(36).slice(2, 6)}`,
            role: "agent",
            text,
            timestamp: now,
            ...(forceNew ? { isNarration: true } : {}),
          });
          return { acpMessages: { ...state.acpMessages, [sessionId]: msgs } };
        }
      }),

    addAcpUserMessage: (sessionId, text, attachments) =>
      set((state) => {
        const msgs = [...(state.acpMessages[sessionId] ?? [])];
        msgs.push({
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: "user",
          text,
          timestamp: Date.now(),
          attachments: attachments && attachments.length > 0 ? attachments : undefined,
        });
        return { acpMessages: { ...state.acpMessages, [sessionId]: msgs } };
      }),

    addAcpToolCall: (sessionId, tc) =>
      set((state) => {
        const existing = state.acpToolCalls[sessionId] ?? [];
        // Deduplicate: skip if this tool_call_id already exists
        if (existing.some((t) => t.tool_call_id === tc.tool_call_id)) return {};
        return { acpToolCalls: { ...state.acpToolCalls, [sessionId]: [...existing, tc] } };
      }),

    updateAcpToolCall: (sessionId, toolCallId, status, title, content) =>
      set((state) => {
        const existing = state.acpToolCalls[sessionId] ?? [];
        const found = existing.some((tc) => tc.tool_call_id === toolCallId);

        if (found) {
          // Update existing tool call
          const tcs = existing.map((tc) =>
            tc.tool_call_id === toolCallId
              ? {
                  ...tc,
                  status,
                  ...(title != null ? { title } : {}),
                  ...(content != null ? { content } : {}),
                }
              : tc,
          );
          return { acpToolCalls: { ...state.acpToolCalls, [sessionId]: tcs } };
        } else {
          // Auto-create: the ToolCallUpdate arrived before (or without) a ToolCall event.
          // This happens when agents send permission requests that auto-approve — the
          // initial ToolCall notification may be swallowed by the permission flow.
          const msgs = state.acpMessages[sessionId] ?? [];
          const tcs = [
            ...existing,
            {
              tool_call_id: toolCallId,
              title: title ?? toolCallId,
              kind: "other",
              status,
              messageIndex: msgs.length > 0 ? msgs.length - 1 : -1,
              timestamp: Date.now(),
            },
          ];
          return { acpToolCalls: { ...state.acpToolCalls, [sessionId]: tcs } };
        }
      }),

    setAcpPlan: (sessionId, entries) =>
      set((state) => ({
        acpPlans: { ...state.acpPlans, [sessionId]: entries },
      })),

    setAcpMode: (sessionId, mode) =>
      set((state) => ({
        acpModes: { ...state.acpModes, [sessionId]: mode },
      })),

    setAcpModel: (sessionId, model) =>
      set((state) => ({
        acpModels: { ...state.acpModels, [sessionId]: model },
      })),

    setAcpPromptPending: (sessionId, pending) =>
      set((state) => ({
        acpPromptPending: { ...state.acpPromptPending, [sessionId]: pending },
      })),

    appendAcpThinking: (sessionId, text) =>
      set((state) => {
        const isFirstChunk = !state.acpThinking[sessionId];
        return {
          acpThinking: {
            ...state.acpThinking,
            [sessionId]: (state.acpThinking[sessionId] ?? "") + text,
          },
          // Track when thinking started (first chunk only)
          acpThinkingStartTime: isFirstChunk
            ? { ...state.acpThinkingStartTime, [sessionId]: Date.now() }
            : state.acpThinkingStartTime,
        };
      }),

    flushAcpThinking: (sessionId) =>
      set((state) => {
        const pendingText = state.acpThinking[sessionId];
        if (!pendingText) return {};

        const startTime = state.acpThinkingStartTime[sessionId];
        const now = Date.now();
        const duration = startTime ? Math.ceil((now - startTime) / 1000) : undefined;

        const block: import("../types").AcpThinkingBlock = {
          id: `think_${now}_${Math.random().toString(36).slice(2, 6)}`,
          text: pendingText,
          timestamp: startTime ?? now,
          duration,
        };

        const { [sessionId]: _, ...restThinking } = state.acpThinking;
        const { [sessionId]: _ts, ...restTimes } = state.acpThinkingStartTime;

        return {
          acpThinkingBlocks: {
            ...state.acpThinkingBlocks,
            [sessionId]: [...(state.acpThinkingBlocks[sessionId] ?? []), block],
          },
          acpThinking: restThinking,
          acpThinkingStartTime: restTimes,
        };
      }),

    clearAcpThinking: (sessionId) =>
      set((state) => {
        const { [sessionId]: _, ...rest } = state.acpThinking;
        const { [sessionId]: _ts, ...restTimes } = state.acpThinkingStartTime;
        return { acpThinking: rest, acpThinkingStartTime: restTimes };
      }),

    addAcpPermissionRequest: (sessionId, request) =>
      set((state) => ({
        acpPermissionRequests: {
          ...state.acpPermissionRequests,
          [sessionId]: [...(state.acpPermissionRequests[sessionId] ?? []), request],
        },
      })),

    removeAcpPermissionRequest: (sessionId, requestId) =>
      set((state) => ({
        acpPermissionRequests: {
          ...state.acpPermissionRequests,
          [sessionId]: (state.acpPermissionRequests[sessionId] ?? []).filter(
            (r) => r.request_id !== requestId,
          ),
        },
      })),

    setAcpAvailableCommands: (sessionId, commands) =>
      set((state) => ({
        acpAvailableCommands: { ...state.acpAvailableCommands, [sessionId]: commands },
      })),

    setAcpConfigOptions: (sessionId, options) =>
      set((state) => ({
        acpConfigOptions: { ...state.acpConfigOptions, [sessionId]: options },
      })),

    setAcpUsage: (sessionId, data) =>
      set((state) => ({
        acpUsage: { ...state.acpUsage, [sessionId]: data },
      })),

    cleanupSessionAcp: (sessionId) => {
      set((state) => {
        const { [sessionId]: _m, ...msgs } = state.acpMessages;
        const { [sessionId]: _t, ...tcs } = state.acpToolCalls;
        const { [sessionId]: _p, ...plans } = state.acpPlans;
        const { [sessionId]: _d, ...modes } = state.acpModes;
        const { [sessionId]: _md, ...models } = state.acpModels;
        const { [sessionId]: _pp, ...pending } = state.acpPromptPending;
        const { [sessionId]: _th, ...thinking } = state.acpThinking;
        const { [sessionId]: _ts, ...thinkingTimes } = state.acpThinkingStartTime;
        const { [sessionId]: _tb, ...thinkingBlocks } = state.acpThinkingBlocks;
        const { [sessionId]: _htc, ...hadToolCall } = state.acpHadToolCallSinceChunk;
        const { [sessionId]: _pr, ...permReqs } = state.acpPermissionRequests;
        const { [sessionId]: _ac, ...availCmds } = state.acpAvailableCommands;
        const { [sessionId]: _co, ...cfgOpts } = state.acpConfigOptions;
        const { [sessionId]: _u, ...usage } = state.acpUsage;
        return {
          acpMessages: msgs,
          acpToolCalls: tcs,
          acpPlans: plans,
          acpModes: modes,
          acpModels: models,
          acpPromptPending: pending,
          acpThinking: thinking,
          acpThinkingStartTime: thinkingTimes,
          acpThinkingBlocks: thinkingBlocks,
          acpHadToolCallSinceChunk: hadToolCall,
          acpPermissionRequests: permReqs,
          acpAvailableCommands: availCmds,
          acpConfigOptions: cfgOpts,
          acpUsage: usage,
        };
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

    // ── Research → Implementation flow ──

    researchCompleteSessionIds: [],
    launchTaskForSessionId: null,

    addResearchComplete: (sessionId) =>
      set((state) => ({
        researchCompleteSessionIds: state.researchCompleteSessionIds.includes(sessionId)
          ? state.researchCompleteSessionIds
          : [...state.researchCompleteSessionIds, sessionId],
      })),

    dismissResearchComplete: (sessionId) =>
      set((state) => ({
        researchCompleteSessionIds: state.researchCompleteSessionIds.filter((id) => id !== sessionId),
      })),

    setLaunchTaskForSession: (sessionId) =>
      set({ launchTaskForSessionId: sessionId }),

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

    refreshProjectBranches: () => {
      const ids = get().openProjectIds;
      if (ids.length === 0) return;
      invoke<Record<string, string | null>>("get_project_branches", { projectIds: ids })
        .then((branches) => set({ projectBranches: branches }))
        .catch(() => {});
    },

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

    navigateToReview: (worktreePath) => {
      const current = get().activeView;
      set({ reviewWorktreePath: worktreePath, activeView: "review", previousView: current !== "review" ? current : get().previousView });
    },

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

    // ── Prompt templates ──

    loadPromptTemplates: async () => {
      try {
        const templates = await invoke<PromptTemplate[]>("get_prompt_templates");
        set({ promptTemplates: templates });
      } catch (e) {
        console.error("Failed to load prompt templates:", e);
      }
    },

    savePromptTemplates: async (templates: PromptTemplate[]) => {
      set({ promptTemplates: templates });
      try {
        await invoke("set_prompt_templates", { templates });
      } catch (e) {
        console.error("Failed to save prompt templates:", e);
        // Reload from backend on error to stay in sync
        get().loadPromptTemplates();
      }
    },

    resetPromptTemplates: async () => {
      try {
        const templates = await invoke<PromptTemplate[]>("reset_prompt_templates");
        set({ promptTemplates: templates });
      } catch (e) {
        console.error("Failed to reset prompt templates:", e);
      }
    },

    getSessionPrompt: (mode: string) => {
      return get().promptTemplates.find(
        (t) => t.category === "session" && t.session_mode === mode,
      );
    },

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
        // Navigate to the session's project and the appropriate view
        const session = get().sessions.find((s) => s.id === sessionId)
          ?? Object.values(get().projectSessions).flat().find((s) => s.id === sessionId);
        if (session) {
          if (session.project_id !== get().activeProjectId) {
            get().setActiveProject(session.project_id);
          }
          if (session.mode === "chat") {
            // Chat sessions live in the Chat view, not the session grid
            set({ activeView: "chat" });
          } else {
            set({ activeView: "sessions" });
            get().setGridLayout({ focusedPaneId: sessionId });
          }
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

      // Load prompt templates
      get().loadPromptTemplates();

      // Auto-check for ACP adapter updates on startup (respects user preference + 1hr cooldown)
      invoke<string | null>("get_setting", { key: "auto_check_acp_updates" })
        .then(async (val) => {
          // Default to enabled if no setting exists
          if (val === "false") return;
          // Check cooldown: skip if last check was less than 1 hour ago
          const lastCheck = await invoke<string | null>("get_setting", { key: "last_acp_registry_check" }).catch(() => null);
          if (lastCheck) {
            const elapsed = Date.now() - Number(lastCheck);
            if (elapsed < 3600_000) return; // Less than 1 hour
          }
          // Perform the check
          await get().fetchAcpRegistry(true);
          // Update last-checked timestamp
          invoke("set_setting", { key: "last_acp_registry_check", value: String(Date.now()) }).catch(() => {});
        })
        .catch(() => {});

      // Fetch agent usage data and start 5-minute polling
      get().fetchAgentUsage();
      const usageInterval = setInterval(() => {
        get().fetchAgentUsage();
      }, 300_000);
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

      // Load projects, then restore persisted open state or open all
      addBackgroundTask("Loading projects");
      Promise.all([
        invoke<Project[]>("list_projects"),
        invoke<string | null>("get_setting", { key: "open_project_ids" }),
      ])
        .then(([projects, savedOpenIds]) => {
          const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
          const allIds = sorted.map((p) => p.id);

          // Restore persisted open projects, falling back to all
          let openProjectIds = allIds;
          if (savedOpenIds) {
            try {
              const parsed: string[] = JSON.parse(savedOpenIds);
              // Filter to only valid project IDs
              const valid = parsed.filter((id) => allIds.includes(id));
              if (valid.length > 0) openProjectIds = valid;
            } catch { /* fall back to all */ }
          }

          set({
            projects: sorted,
            openProjectIds,
            activeProjectId: openProjectIds[0] ?? null,
          });
          // Load sessions + worktrees for every open project
          for (const id of openProjectIds) {
            refreshProject(id);
          }
          // Fetch branch names for all open projects
          get().refreshProjectBranches();
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

          // Refresh branch names (lightweight, no spinner needed)
          get().refreshProjectBranches();

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

      // Guard flag to prevent duplicate event processing during React StrictMode
      // double-mount or HMR reloads. The Tauri `listen()` cleanup is async (returns
      // Promise<UnlistenFn>), so old listeners can briefly coexist with new ones.
      // This flag is checked synchronously in every handler to reject stale events.
      let disposed = false;
      cleanups.push(() => { disposed = true; });

      // Session started/stopped — payload is a full Session with project_id.
      // Only refresh the affected project (not all open projects).
      // Task status changes are handled by the separate "task-updated" event,
      // so no sync_tasks needed here.
      for (const event of ["session-started", "session-stopped"]) {
        eventCleanups.push(
          listen<Session>(event, (e) => {
            if (disposed) return;
            const pid = e.payload.project_id;
            if (pid) {
              refreshProject(pid);
            }
            // For ACP sessions with an initial prompt (task/research), set
            // promptPending so the chat UI shows a thinking indicator immediately.
            // Chat and vibe sessions start without a prompt — they wait for user input.
            if (
              event === "session-started" &&
              e.payload.transport === "acp" &&
              e.payload.mode !== "chat" &&
              e.payload.mode !== "vibe"
            ) {
              get().setAcpPromptPending(e.payload.id, true);
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
            if (disposed) return;
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
            if (disposed) return;
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
          if (disposed) return;
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
          if (disposed) return;
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
          if (disposed) return;
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
          if (disposed) return;
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
        listen<McpErrorEvent>("mcp-error", (event) => {
          if (disposed) return;
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
          if (disposed) return;
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

          // Refresh branches — agent may have created/switched branches
          get().refreshProjectBranches();

          // If this is a research session with a linked task, show the
          // "Continue to Implementation" bar
          const session = get().sessions.find((s) => s.id === session_id);
          if (session?.mode === "research" && session.task_id) {
            get().addResearchComplete(session_id);
          }
        }),
      );

      // ── ACP event listeners ──

      eventCleanups.push(
        listen<AcpMessageChunk>("acp-thought-chunk", (event) => {
          if (disposed) return;
          console.log("[ACP] thought-chunk", event.payload.session_id, `${event.payload.text.length}ch`, event.payload.text.slice(0, 80));
          get().appendAcpThinking(event.payload.session_id, event.payload.text);
        }),
      );

      eventCleanups.push(
        listen<AcpMessageChunk>("acp-message-chunk", (event) => {
          if (disposed) return;
          const { session_id, text } = event.payload;
          const hadToolCall = get().acpHadToolCallSinceChunk[session_id] ?? false;
          console.log("[ACP] message-chunk", session_id, `${text.length}ch`, hadToolCall ? "(narration)" : "", text.slice(0, 120));
          // Flush any pending thinking into a standalone block before the message
          get().flushAcpThinking(session_id);
          get().appendAcpChunk(session_id, text, hadToolCall);
          // Reset the flag after consuming it
          if (hadToolCall) {
            set((state) => ({
              acpHadToolCallSinceChunk: { ...state.acpHadToolCallSinceChunk, [session_id]: false },
            }));
          }
        }),
      );

      eventCleanups.push(
        listen<AcpToolCall>("acp-tool-call", (event) => {
          if (disposed) return;
          console.log("[ACP] tool-call", event.payload.session_id, event.payload.tool_call_id, event.payload.title, event.payload.kind, event.payload.status);
          const { session_id, ...rest } = event.payload;
          // Flush any pending thinking into a standalone block before the tool call
          get().flushAcpThinking(session_id);
          const msgs = get().acpMessages[session_id] ?? [];
          get().addAcpToolCall(session_id, {
            ...rest,
            messageIndex: msgs.length - 1,
            timestamp: Date.now(),
          });
          // Mark that a tool call has occurred since the last message chunk
          set((state) => ({
            acpHadToolCallSinceChunk: { ...state.acpHadToolCallSinceChunk, [session_id]: true },
          }));
        }),
      );

      eventCleanups.push(
        listen<AcpToolCallUpdate>("acp-tool-call-update", (event) => {
          if (disposed) return;
          console.log("[ACP] tool-call-update", event.payload.session_id, event.payload.tool_call_id, event.payload.status, event.payload.title);
          const { session_id, tool_call_id, status, title, content } = event.payload;
          get().updateAcpToolCall(session_id, tool_call_id, status, title, content);
        }),
      );

      eventCleanups.push(
        listen<AcpPlanUpdate>("acp-plan-update", (event) => {
          if (disposed) return;
          console.log("[ACP] plan-update", event.payload.session_id, `${event.payload.entries.length} entries`, event.payload.entries);
          get().setAcpPlan(event.payload.session_id, event.payload.entries);
        }),
      );

      eventCleanups.push(
        listen<AcpModeUpdate>("acp-mode-update", (event) => {
          if (disposed) return;
          console.log("[ACP] mode-update", event.payload.session_id, event.payload.mode);
          get().setAcpMode(event.payload.session_id, event.payload.mode);
        }),
      );

      eventCleanups.push(
        listen<AcpSessionInfo>("acp-session-info", (event) => {
          if (disposed) return;
          console.log("[ACP] session-info", event.payload.session_id, event.payload.title);
          // Update session name if provided
          if (event.payload.title) {
            const sessions = get().sessions.map((s) =>
              s.id === event.payload.session_id
                ? { ...s, name: event.payload.title }
                : s,
            );
            set({ sessions });
          }
        }),
      );

      eventCleanups.push(
        listen<AcpPromptComplete>("acp-prompt-complete", (event) => {
          if (disposed) return;
          console.log("[ACP] prompt-complete", event.payload.session_id, event.payload.stop_reason);
          // Flush any trailing thinking (e.g. thinking was the last thing before stop)
          get().flushAcpThinking(event.payload.session_id);
          get().setAcpPromptPending(event.payload.session_id, false);
        }),
      );

      eventCleanups.push(
        listen<AcpError>("acp-error", (event) => {
          if (disposed) return;
          const { session_id, error } = event.payload;
          console.error("[ACP] error", session_id, error);
          get().setAcpPromptPending(session_id, false);

          // Inject error as a visible message in the chat timeline
          set((state) => {
            const msgs = [...(state.acpMessages[session_id] ?? [])];
            msgs.push({
              id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              role: "agent",
              text: error,
              timestamp: Date.now(),
              isError: true,
            });
            return { acpMessages: { ...state.acpMessages, [session_id]: msgs } };
          });

          // Fire OS notification for ACP errors
          const session = get().sessions.find((s) => s.id === session_id);
          const sessionName = getSessionName(get, session_id);
          maybeNotify(
            "error",
            session_id,
            sessionName,
            error,
            get().activeView,
            session?.project_id === get().activeProjectId,
          );
        }),
      );

      eventCleanups.push(
        listen<import("../types").AcpPermissionRequest>("acp-permission-request", (event) => {
          if (disposed) return;
          console.log("[ACP] permission-request", event.payload.session_id, event.payload.capability, event.payload.detail, event.payload.options);
          get().addAcpPermissionRequest(event.payload.session_id, event.payload);
          // Fire OS notification for permission requests (needs user attention)
          const session = get().sessions.find((s) => s.id === event.payload.session_id);
          const sessionName = getSessionName(get, event.payload.session_id);
          maybeNotify(
            "permission",
            event.payload.session_id,
            sessionName,
            event.payload.description || "Agent is requesting permission for an action",
            get().activeView,
            session?.project_id === get().activeProjectId,
          );
        }),
      );

      eventCleanups.push(
        listen<import("../types").AcpPermissionResponse>("acp-permission-response", (event) => {
          if (disposed) return;
          console.log("[ACP] permission-response", event.payload.session_id, event.payload.request_id, event.payload);
          get().removeAcpPermissionRequest(event.payload.session_id, event.payload.request_id);
        }),
      );

      // ACP available commands update
      eventCleanups.push(
        listen<AcpAvailableCommandsUpdate>("acp-available-commands", (event) => {
          if (disposed) return;
          console.log("[ACP] available-commands", event.payload.session_id, event.payload.commands.length);
          get().setAcpAvailableCommands(event.payload.session_id, event.payload.commands);
        }),
      );

      // ACP config option update
      eventCleanups.push(
        listen<AcpConfigOptionUpdate>("acp-config-option-update", (event) => {
          if (disposed) return;
          console.log("[ACP] config-option-update", event.payload.session_id, event.payload.config_options.length);
          get().setAcpConfigOptions(event.payload.session_id, event.payload.config_options);
        }),
      );

      // ACP usage update (context window + cost)
      eventCleanups.push(
        listen<AcpUsageData & { session_id: string }>("acp-usage-update", (event) => {
          if (disposed) return;
          const { session_id, ...data } = event.payload;
          get().setAcpUsage(session_id, data);
        }),
      );

      eventCleanups.push(
        listen<Task>("task-updated", (event) => {
          if (disposed) return;
          get().updateTask(event.payload);
        }),
      );

      // File watcher: tasks-updated event (batch refresh from disk sync)
      eventCleanups.push(
        listen<string>("tasks-updated", (event) => {
          if (disposed) return;
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
          if (disposed) return;
          const { project_id, run } = event.payload;
          // Keep completed runs visible — user must dismiss to close sessions
          get().setContinuousMode(project_id, run);
        }),
      );

      eventCleanups.push(
        listen<ContinuousModeFinished>("continuous-mode-finished", (event) => {
          if (disposed) return;
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
