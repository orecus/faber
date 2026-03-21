import { useReducer, useCallback } from "react";
import type { Priority } from "../types";

export interface FilterState {
  priorities: Set<Priority>;
  labels: Set<string>;
  agents: Set<string>;
  searchQuery: string;
}

export type FilterAction =
  | { type: "TOGGLE_PRIORITY"; priority: Priority }
  | { type: "TOGGLE_LABEL"; label: string }
  | { type: "TOGGLE_AGENT"; agent: string }
  | { type: "SET_SEARCH"; text: string }
  | { type: "CLEAR_ALL" };

function reducer(state: FilterState, action: FilterAction): FilterState {
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
    case "SET_SEARCH":
      return { ...state, searchQuery: action.text };
    case "CLEAR_ALL":
      return { priorities: new Set(), labels: new Set(), agents: new Set(), searchQuery: "" };
  }
}

const initialState: FilterState = {
  priorities: new Set(),
  labels: new Set(),
  agents: new Set(),
  searchQuery: "",
};

export function useDashboardFilters() {
  const [filters, dispatchFilter] = useReducer(reducer, initialState);

  const hasActiveFilters =
    filters.priorities.size > 0 ||
    filters.labels.size > 0 ||
    filters.agents.size > 0 ||
    filters.searchQuery.length > 0;

  const matchesFilters = useCallback(
    (task: { id: string; title: string; priority: Priority; labels: string[]; agent: string | null }) => {
      if (filters.priorities.size > 0 && !filters.priorities.has(task.priority)) return false;
      if (filters.labels.size > 0 && !task.labels.some((l) => filters.labels.has(l))) return false;
      if (filters.agents.size > 0 && (!task.agent || !filters.agents.has(task.agent))) return false;
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
