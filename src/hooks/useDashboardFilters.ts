import { useCallback } from "react";
import { useAppStore } from "../store/appStore";
import type { Priority, TaskStatus } from "../types";

export interface FilterState {
  priorities: Set<Priority>;
  labels: Set<string>;
  agents: Set<string>;
  statuses: Set<TaskStatus>;
  epics: Set<string>;
  searchQuery: string;
  showArchived: boolean;
}

export type FilterAction =
  | { type: "TOGGLE_PRIORITY"; priority: Priority }
  | { type: "TOGGLE_LABEL"; label: string }
  | { type: "TOGGLE_AGENT"; agent: string }
  | { type: "TOGGLE_STATUS"; status: TaskStatus }
  | { type: "TOGGLE_EPIC"; epicId: string }
  | { type: "SET_SEARCH"; text: string }
  | { type: "TOGGLE_ARCHIVED" }
  | { type: "CLEAR_ALL" };

export const initialFilterState: FilterState = {
  priorities: new Set(),
  labels: new Set(),
  agents: new Set(),
  statuses: new Set(),
  epics: new Set(),
  searchQuery: "",
  showArchived: false,
};

export function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case "TOGGLE_PRIORITY": {
      const next = new Set(state.priorities);
      if (next.has(action.priority)) next.delete(action.priority);
      else next.add(action.priority);
      return { ...state, priorities: next };
    }
    case "TOGGLE_LABEL": {
      const next = new Set(state.labels);
      if (next.has(action.label)) next.delete(action.label);
      else next.add(action.label);
      return { ...state, labels: next };
    }
    case "TOGGLE_AGENT": {
      const next = new Set(state.agents);
      if (next.has(action.agent)) next.delete(action.agent);
      else next.add(action.agent);
      return { ...state, agents: next };
    }
    case "TOGGLE_STATUS": {
      const next = new Set(state.statuses);
      if (next.has(action.status)) next.delete(action.status);
      else next.add(action.status);
      return { ...state, statuses: next };
    }
    case "TOGGLE_EPIC": {
      const next = new Set(state.epics);
      if (next.has(action.epicId)) next.delete(action.epicId);
      else next.add(action.epicId);
      return { ...state, epics: next };
    }
    case "SET_SEARCH":
      return { ...state, searchQuery: action.text };
    case "TOGGLE_ARCHIVED":
      return { ...state, showArchived: !state.showArchived };
    case "CLEAR_ALL":
      return { ...initialFilterState };
  }
}

export function useDashboardFilters() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projectFilters = useAppStore((s) => s.projectFilters);
  const setProjectFilters = useAppStore((s) => s.setProjectFilters);

  const filters = activeProjectId
    ? (projectFilters[activeProjectId] ?? initialFilterState)
    : initialFilterState;

  const dispatchFilter = useCallback(
    (action: FilterAction) => {
      if (!activeProjectId) return;
      const current = useAppStore.getState().projectFilters[activeProjectId] ?? initialFilterState;
      const next = filterReducer(current, action);
      setProjectFilters(activeProjectId, next);
    },
    [activeProjectId, setProjectFilters],
  );

  const hasActiveFilters =
    filters.priorities.size > 0 ||
    filters.labels.size > 0 ||
    filters.agents.size > 0 ||
    filters.statuses.size > 0 ||
    filters.epics.size > 0 ||
    filters.searchQuery.length > 0;

  const matchesFilters = useCallback(
    (task: { id: string; title: string; status: TaskStatus; priority: Priority; labels: string[]; agent: string | null; epic_id?: string | null; task_type?: string }) => {
      if (filters.priorities.size > 0 && !filters.priorities.has(task.priority)) return false;
      if (filters.labels.size > 0 && !task.labels.some((l) => filters.labels.has(l))) return false;
      if (filters.agents.size > 0 && (!task.agent || !filters.agents.has(task.agent))) return false;
      if (filters.statuses.size > 0 && !filters.statuses.has(task.status)) return false;
      // Epic filter: show the epic itself + tasks belonging to selected epics
      if (filters.epics.size > 0) {
        const isSelectedEpic = task.task_type === "epic" && filters.epics.has(task.id);
        const belongsToSelectedEpic = task.epic_id != null && filters.epics.has(task.epic_id);
        if (!isSelectedEpic && !belongsToSelectedEpic) return false;
      }
      if (filters.searchQuery.length > 0) {
        const q = filters.searchQuery.toLowerCase();
        const inTitle = task.title.toLowerCase().includes(q);
        const inId = task.id.toLowerCase().includes(q);
        const inLabels = task.labels.some((l) => l.toLowerCase().includes(q));
        const inAgent = task.agent?.toLowerCase().includes(q) ?? false;
        if (!inTitle && !inId && !inLabels && !inAgent) return false;
      }
      return true;
    },
    [filters],
  );

  return { filters, dispatchFilter, hasActiveFilters, matchesFilters };
}
