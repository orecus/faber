import { useAppStore } from "../store/appStore";
import type { ThemeColor } from "../components/ui/orecus.io/lib/color-utils";

/**
 * Returns the active project's ThemeColor accent, defaulting to "blue".
 * Uses narrow Zustand selectors so components only re-render on project changes.
 */
export function useProjectAccentColor(): ThemeColor {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projects = useAppStore((s) => s.projects);

  if (!activeProjectId) return "blue";

  const project = projects.find((p) => p.id === activeProjectId);
  return (project?.color as ThemeColor) || "blue";
}
