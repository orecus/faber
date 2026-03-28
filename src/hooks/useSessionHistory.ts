import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatErrorWithHint } from "../lib/errorMessages";
import { useAppStore } from "../store/appStore";
import type { AgentSessionInfo, SessionMode } from "../types";

/** Faber metadata matched from active sessions by acp_session_id. */
export interface FaberSessionMeta {
  mode: SessionMode;
  taskId: string | null;
  isActive: boolean;
}

const SESSION_LIST_TTL_MS = 60_000;

/**
 * Shared hook for session history sidebar data.
 * Handles agent selection, session list fetching, filtering, and resume actions.
 */
export function useSessionHistory() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const sessions = useAppStore((s) => s.sessions);
  const agents = useAppStore((s) => s.agents);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const fetchAgentSessionList = useAppStore((s) => s.fetchAgentSessionList);
  const retryAgentSessionList = useAppStore((s) => s.retryAgentSessionList);
  const removeAgentSession = useAppStore((s) => s.removeAgentSession);
  const agentSessionList = useAppStore((s) => s.agentSessionList);
  const agentSessionListSupported = useAppStore(
    (s) => s.agentSessionListSupported,
  );
  const agentLoadSessionSupported = useAppStore(
    (s) => s.agentLoadSessionSupported,
  );
  const agentSessionListLoading = useAppStore((s) => s.agentSessionListLoading);
  const agentSessionListFetchedAt = useAppStore(
    (s) => s.agentSessionListFetchedAt,
  );

  const [selectedAgentName, setSelectedAgentName] = useState("");
  const [resuming, setResuming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  // ACP-capable agents only
  const acpAgents = useMemo(
    () => agents.filter((a) => a.installed && a.acp_installed),
    [agents],
  );

  // Default to first ACP agent
  useEffect(() => {
    if (acpAgents.length > 0 && !selectedAgentName) {
      setSelectedAgentName(acpAgents[0].name);
    }
  }, [acpAgents, selectedAgentName]);

  // Session list key and data
  const sessionListKey =
    selectedAgentName && activeProjectId
      ? `${selectedAgentName}:${activeProjectId}`
      : null;
  const sessionHistory = sessionListKey
    ? (agentSessionList[sessionListKey] ?? null)
    : null;
  const isListLoading = sessionListKey
    ? (agentSessionListLoading[sessionListKey] ?? false)
    : false;
  const isListSupported = selectedAgentName
    ? (agentSessionListSupported[selectedAgentName] ?? true)
    : true;
  const isLoadSupported = selectedAgentName
    ? (agentLoadSessionSupported[selectedAgentName] ?? true)
    : true;

  // Auto-fetch when needed
  const autoFetch = useCallback(() => {
    if (selectedAgentName && activeProjectId && !isListLoading) {
      const fetchedAt = sessionListKey
        ? (agentSessionListFetchedAt[sessionListKey] ?? 0)
        : 0;
      const isStale =
        sessionHistory === null || Date.now() - fetchedAt > SESSION_LIST_TTL_MS;
      if (isStale) {
        fetchAgentSessionList(selectedAgentName, activeProjectId);
      }
    }
  }, [
    selectedAgentName,
    activeProjectId,
    sessionHistory,
    sessionListKey,
    agentSessionListFetchedAt,
    isListLoading,
    fetchAgentSessionList,
  ]);

  // Filter sessions by search
  const filteredSessions = useMemo(() => {
    if (!sessionHistory) return [];
    if (!searchFilter.trim()) return sessionHistory;
    const q = searchFilter.toLowerCase();
    return sessionHistory.filter(
      (s: AgentSessionInfo) =>
        s.title?.toLowerCase().includes(q) ||
        s.session_id.toLowerCase().includes(q),
    );
  }, [sessionHistory, searchFilter]);

  // Agent selection handler
  const handleAgentSelect = useCallback(
    (name: string) => {
      setSelectedAgentName(name);
      if (activeProjectId) {
        fetchAgentSessionList(name, activeProjectId);
      }
    },
    [activeProjectId, fetchAgentSessionList],
  );

  // Refresh list
  const handleRefreshList = useCallback(() => {
    if (selectedAgentName && activeProjectId) {
      fetchAgentSessionList(selectedAgentName, activeProjectId);
    }
  }, [selectedAgentName, activeProjectId, fetchAgentSessionList]);

  // Retry after "not supported"
  const handleRetry = useCallback(() => {
    if (selectedAgentName && activeProjectId) {
      retryAgentSessionList(selectedAgentName, activeProjectId);
    }
  }, [selectedAgentName, activeProjectId, retryAgentSessionList]);

  // Resume into ChatView
  const handleResumeInChat = useCallback(
    async (agentSessionId: string) => {
      if (!activeProjectId || !selectedAgentName || resuming) return;
      setError(null);
      setResuming(agentSessionId);
      const taskLabel = "Resuming chat session";
      addBackgroundTask(taskLabel);
      try {
        await invoke("resume_acp_session", {
          projectId: activeProjectId,
          agentName: selectedAgentName,
          agentSessionId,
        });
      } catch (err) {
        setError(formatErrorWithHint(err, "agent-launch"));
        removeAgentSession(selectedAgentName, activeProjectId, agentSessionId);
      } finally {
        setResuming(null);
        removeBackgroundTask(taskLabel);
      }
    },
    [
      activeProjectId,
      selectedAgentName,
      resuming,
      addBackgroundTask,
      removeBackgroundTask,
      removeAgentSession,
    ],
  );

  // Resume and open in Sessions view
  const handleLaunchAsSession = useCallback(
    async (agentSessionId: string) => {
      if (!activeProjectId || !selectedAgentName || resuming) return;
      setError(null);
      setResuming(agentSessionId);
      const taskLabel = "Launching session";
      addBackgroundTask(taskLabel);
      try {
        await invoke("resume_acp_session", {
          projectId: activeProjectId,
          agentName: selectedAgentName,
          agentSessionId,
          target: "session",
        });
        setActiveView("sessions");
      } catch (err) {
        setError(formatErrorWithHint(err, "agent-launch"));
        removeAgentSession(selectedAgentName, activeProjectId, agentSessionId);
      } finally {
        setResuming(null);
        removeBackgroundTask(taskLabel);
      }
    },
    [
      activeProjectId,
      selectedAgentName,
      resuming,
      addBackgroundTask,
      removeBackgroundTask,
      removeAgentSession,
      setActiveView,
    ],
  );

  // Cross-reference: map agent session IDs to Faber session metadata
  const acpSessionMap = useMemo(() => {
    const map = new Map<string, FaberSessionMeta>();
    for (const s of sessions) {
      if (s.acp_session_id && s.project_id === activeProjectId) {
        map.set(s.acp_session_id, {
          mode: s.mode,
          taskId: s.task_id,
          isActive: s.status === "running" || s.status === "starting",
        });
      }
    }
    return map;
  }, [sessions, activeProjectId]);

  // Whether sidebar has data to show
  const showHistory =
    acpAgents.length > 0 && (sessionHistory !== null || isListLoading);

  return {
    // State
    selectedAgentName,
    acpAgents,
    sessionHistory,
    filteredSessions,
    acpSessionMap,
    isListLoading,
    isListSupported,
    isLoadSupported,
    searchFilter,
    resuming,
    error,
    showHistory,
    // Actions
    autoFetch,
    setSearchFilter,
    handleAgentSelect,
    handleRefreshList,
    handleRetry,
    handleResumeInChat,
    handleLaunchAsSession,
    setError,
  };
}
