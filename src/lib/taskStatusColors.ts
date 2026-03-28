import type { TaskStatus } from "../types";

/**
 * Canonical task-status → color mappings.
 *
 * Two flavours:
 *  - `TASK_STATUS_DOT_COLORS`  — Tailwind bg classes for small status dots / badges
 *  - `TASK_STATUS_CSS_COLORS`  — CSS custom-property values for inline `style={{ background }}`
 *
 * Both maps cover every TaskStatus value so they can be indexed directly.
 */

/** Tailwind `bg-*` classes for status indicator dots & small badges. */
export const TASK_STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  backlog: "bg-muted-foreground/40",
  ready: "bg-blue-500",
  "in-progress": "bg-amber-500",
  "in-review": "bg-purple-500",
  done: "bg-emerald-500",
  archived: "bg-muted-foreground/25",
};

/** CSS variable values for inline `style={{ background }}` usage. */
export const TASK_STATUS_CSS_COLORS: Record<TaskStatus, string> = {
  backlog: "var(--muted-foreground)",
  ready: "var(--primary)",
  "in-progress": "var(--warning)",
  "in-review": "var(--primary)",
  done: "var(--success)",
  archived: "var(--muted-foreground)",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  "in-progress": "In Progress",
  "in-review": "In Review",
  done: "Done",
  archived: "Archived",
};
