import { useMemo } from "react";
import {
  LayoutDashboard,
  TerminalSquare,
  Github,
  GitCompare,
  FolderOpen,
  FileText,
  Monitor,
  PanelRight,
  Blocks,
} from "lucide-react";
import { useAppStore } from "../../store/appStore";
import type { Command } from "./commandRegistry";

export function useCommands(onExecuted: () => void): Command[] {
  const projects = useAppStore((s) => s.projects);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const tasks = useAppStore((s) => s.tasks);
  const sessions = useAppStore((s) => s.sessions);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const openProject = useAppStore((s) => s.openProject);
  const setActiveTask = useAppStore((s) => s.setActiveTask);
  const setGridLayout = useAppStore((s) => s.setGridLayout);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);

  return useMemo(() => {
    const cmds: Command[] = [];

    // ── Navigation ──
    const nav = (id: string, label: string, icon: typeof LayoutDashboard, view: Parameters<typeof setActiveView>[0]) => {
      cmds.push({
        id: `nav:${id}`,
        label,
        group: "Navigation",
        icon,
        onSelect: () => { setActiveView(view); onExecuted(); },
      });
    };

    nav("dashboard", "Go to Dashboard", LayoutDashboard, "dashboard");
    nav("sessions", "Go to Sessions", TerminalSquare, "sessions");
    nav("github", "Go to GitHub", Github, "github");
    nav("skills-rules", "Go to Extensions", Blocks, "skills-rules");
    nav("review", "Go to Review", GitCompare, "review");

    // ── Projects ──
    for (const p of projects) {
      cmds.push({
        id: `project:${p.id}`,
        label: p.name,
        group: "Projects",
        icon: FolderOpen,
        onSelect: () => { openProject(p.id); onExecuted(); },
      });
    }

    // ── Tasks (non-archived in current project) ──
    const visibleTasks = tasks.filter((t) => t.project_id === activeProjectId && t.status !== "archived");
    for (const t of visibleTasks) {
      cmds.push({
        id: `task:${t.id}`,
        label: t.title,
        group: "Tasks",
        icon: FileText,
        onSelect: () => { setActiveTask(t.id); setActiveView("task-detail"); onExecuted(); },
      });
    }

    // ── Sessions ──
    const activeSessions = sessions.filter((s) =>
      s.status === "running" || s.status === "starting" || s.status === "paused"
    );
    for (const s of activeSessions) {
      cmds.push({
        id: `session:${s.id}`,
        label: s.name || `${s.agent} session`,
        group: "Sessions",
        icon: Monitor,
        onSelect: () => {
          setActiveView("sessions");
          setGridLayout({ focusedPaneId: s.id, maximizedPaneId: s.id });
          onExecuted();
        },
      });
    }

    // ── Actions ──
    cmds.push({
      id: "action:toggle-file-browser",
      label: "Toggle File Browser",
      group: "Actions",
      icon: PanelRight,
      shortcut: "⌘B",
      onSelect: () => { toggleRightSidebar(); onExecuted(); },
    });

    return cmds;
  }, [projects, activeProjectId, tasks, sessions, setActiveView, openProject, setActiveTask, setGridLayout, toggleRightSidebar, onExecuted]);
}
