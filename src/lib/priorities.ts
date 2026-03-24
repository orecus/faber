import type { PriorityLevel } from "../types";
import type { ThemeColor } from "../components/ui/orecus.io/lib/color-utils";
import {
  textColors,
  bgColors,
  gradientHexColors,
} from "../components/ui/orecus.io/lib/color-utils";

// ── Default priorities (matches Rust defaults) ──

export const DEFAULT_PRIORITIES: PriorityLevel[] = [
  { id: "P0", label: "Critical", color: "red", order: 0 },
  { id: "P1", label: "High", color: "amber", order: 1 },
  { id: "P2", label: "Normal", color: "gray", order: 2 },
];

/** Colors available for priority levels — same palette as project accent colors. */
export const PRIORITY_COLORS: { value: ThemeColor; label: string }[] = [
  { value: "red", label: "Red" },
  { value: "rose", label: "Rose" },
  { value: "orange", label: "Orange" },
  { value: "amber", label: "Amber" },
  { value: "yellow", label: "Yellow" },
  { value: "lime", label: "Lime" },
  { value: "green", label: "Green" },
  { value: "emerald", label: "Emerald" },
  { value: "teal", label: "Teal" },
  { value: "cyan", label: "Cyan" },
  { value: "blue", label: "Blue" },
  { value: "indigo", label: "Indigo" },
  { value: "violet", label: "Violet" },
  { value: "purple", label: "Purple" },
  { value: "fuchsia", label: "Fuchsia" },
  { value: "pink", label: "Pink" },
  { value: "gray", label: "Gray" },
];

// ── Color helpers ──

/** Resolve a priority color string to a ThemeColor, falling back to "gray". */
function resolveColor(color: string | undefined): ThemeColor {
  return (color ?? "gray") as ThemeColor;
}

/** Get the hex start color for a priority color (for inline styles). */
export function getPriorityHex(id: string, priorities: PriorityLevel[]): string {
  const p = findPriority(id, priorities);
  const tc = resolveColor(p?.color);
  return gradientHexColors[tc]?.start ?? gradientHexColors.gray.start;
}

// ── Lookup helpers ──

function findPriority(id: string, priorities: PriorityLevel[]): PriorityLevel | undefined {
  return priorities.find((p) => p.id === id);
}

/** Get display label for a priority ID (e.g. "P0 — Critical"). Falls back to the raw ID. */
export function getPriorityLabel(id: string, priorities: PriorityLevel[]): string {
  const p = findPriority(id, priorities);
  return p ? `${p.id} — ${p.label}` : id;
}

/** Get short label (just the human name, e.g. "Critical"). Falls back to the raw ID. */
export function getPriorityShortLabel(id: string, priorities: PriorityLevel[]): string {
  const p = findPriority(id, priorities);
  return p ? p.label : id;
}

/** Get Tailwind text color class for a priority ID. */
export function getPriorityTextClass(id: string, priorities: PriorityLevel[]): string {
  const p = findPriority(id, priorities);
  const tc = resolveColor(p?.color);
  return textColors[tc] ?? textColors.gray;
}

/** Get Tailwind bg color class for a priority ID (e.g. for compact indicator dots). */
export function getPriorityBgClass(id: string, priorities: PriorityLevel[]): string {
  const p = findPriority(id, priorities);
  const tc = resolveColor(p?.color);
  return bgColors[tc] ?? bgColors.gray;
}

/** Get Tailwind badge classes for a priority ID (bg + text). */
export function getPriorityBadgeClass(id: string, priorities: PriorityLevel[]): string {
  const p = findPriority(id, priorities);
  const tc = resolveColor(p?.color);
  const bg = bgColors[tc] ?? bgColors.gray;
  const text = textColors[tc] ?? textColors.gray;
  // Use bg at 20% opacity + text color for badge styling
  return `${bg}/20 ${text}`;
}

/** Get CSS hex color for a priority ID (for inline styles). */
export function getPriorityCssVar(id: string, priorities: PriorityLevel[]): string {
  return getPriorityHex(id, priorities);
}

/** Get sort order for a priority ID. Unknown priorities sort last. */
export function getPriorityOrder(id: string, priorities: PriorityLevel[]): number {
  const p = findPriority(id, priorities);
  return p?.order ?? 999;
}

/** Get the default priority ID (highest order number = lowest priority). */
export function getDefaultPriorityId(priorities: PriorityLevel[]): string {
  if (priorities.length === 0) return "P2";
  const sorted = [...priorities].sort((a, b) => b.order - a.order);
  return sorted[0].id;
}

/** Build a priority order map for sorting. */
export function buildPriorityOrderMap(priorities: PriorityLevel[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const p of priorities) {
    map[p.id] = p.order;
  }
  return map;
}
