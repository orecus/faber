import type { LucideIcon } from "lucide-react";

// ── Command types ──

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: LucideIcon;
  shortcut?: string;
  onSelect: () => void;
}

// ── Recents (localStorage) ──

const RECENTS_KEY = "faber:command-palette-recents";
const MAX_RECENTS = 6;

export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function pushRecent(commandId: string) {
  const recents = getRecents().filter((id) => id !== commandId);
  recents.unshift(commandId);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
}
