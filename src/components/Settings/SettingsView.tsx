import {
  Bot,
  FolderCode,
  GitBranch,
  Github,
  MessageSquare,
  Palette,
  Shield,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";

import { useAppStore } from "../../store/appStore";
import { AcpPermissionsTab } from "./AcpPermissionsTab";
import { AgentsTab } from "./AgentsTab";
import { GeneralTab } from "./GeneralTab";
import { GitHubTab } from "./GitHubTab";
import { GitWorktreesTab } from "./GitWorktreesTab";
import { ProjectTab } from "./ProjectTab";
import { PromptsTab } from "./PromptsTab";
import { TerminalTab } from "./TerminalTab";

import type { LucideIcon } from "lucide-react";

// ── Tab definitions ──

export type SettingsTabId =
  | "general"
  | "terminal"
  | "agents"
  | "prompts"
  | "project"
  | "git-worktrees"
  | "acp-permissions"
  | "github";

interface SettingsTabDef {
  id: SettingsTabId;
  label: string;
  icon: LucideIcon;
  group: "app" | "project";
}

const SETTINGS_TABS: SettingsTabDef[] = [
  { id: "general", label: "General", icon: SlidersHorizontal, group: "app" },
  { id: "terminal", label: "Terminal", icon: TerminalSquare, group: "app" },
  { id: "agents", label: "Agents", icon: Bot, group: "app" },
  { id: "prompts", label: "Prompts", icon: MessageSquare, group: "app" },
  { id: "project", label: "Project", icon: FolderCode, group: "project" },
  { id: "git-worktrees", label: "Git & Worktrees", icon: GitBranch, group: "project" },
  { id: "acp-permissions", label: "ACP Permissions", icon: Shield, group: "project" },
  { id: "github", label: "GitHub", icon: Github, group: "project" },
];

const APP_TABS = SETTINGS_TABS.filter((t) => t.group === "app");
const PROJECT_TABS = SETTINGS_TABS.filter((t) => t.group === "project");

// ── Settings Nav ──

function SettingsNav({
  activeTab,
  onTabChange,
  hasProject,
}: {
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  hasProject: boolean;
}) {
  return (
    <nav className="flex flex-col w-[180px] shrink-0 border-r border-border/60 py-3 pr-2 overflow-y-auto">
      {/* App section */}
      <div className="px-3 pb-1.5 text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70">
        App
      </div>
      {APP_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2.5 px-3 py-1.5 text-sm rounded-r-md transition-colors duration-100 text-left ${
              isActive
                ? "bg-accent/60 text-foreground font-medium border-l-2 border-primary"
                : "text-dim-foreground hover:text-foreground hover:bg-accent/30 border-l-2 border-transparent"
            }`}
          >
            <Icon size={14} className={isActive ? "text-primary" : "text-muted-foreground"} />
            {tab.label}
          </button>
        );
      })}

      {/* Project section */}
      <div className="px-3 pt-4 pb-1.5 text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70">
        Project
      </div>
      {PROJECT_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const isDisabled = !hasProject;
        return (
          <button
            key={tab.id}
            onClick={() => !isDisabled && onTabChange(tab.id)}
            disabled={isDisabled}
            className={`flex items-center gap-2.5 px-3 py-1.5 text-sm rounded-r-md transition-colors duration-100 text-left ${
              isDisabled
                ? "text-muted-foreground/40 cursor-not-allowed border-l-2 border-transparent"
                : isActive
                  ? "bg-accent/60 text-foreground font-medium border-l-2 border-primary"
                  : "text-dim-foreground hover:text-foreground hover:bg-accent/30 border-l-2 border-transparent"
            }`}
          >
            <Icon
              size={14}
              className={
                isDisabled
                  ? "text-muted-foreground/30"
                  : isActive
                    ? "text-primary"
                    : "text-muted-foreground"
              }
            />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

// ── Settings Content ──

function SettingsContent({
  activeTab,
}: {
  activeTab: SettingsTabId;
}) {
  const agents = useAppStore((s) => s.agents);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
      <div className="max-w-2xl">
        {activeTab === "general" && <GeneralTab />}
        {activeTab === "terminal" && <TerminalTab />}
        {activeTab === "agents" && <AgentsTab agents={agents} />}
        {activeTab === "prompts" && <PromptsTab />}
        {activeTab === "project" && <ProjectTab />}
        {activeTab === "git-worktrees" && <GitWorktreesTab />}
        {activeTab === "acp-permissions" && <AcpPermissionsTab />}
        {activeTab === "github" && <GitHubTab />}
      </div>
    </div>
  );
}

// ── Settings View ──

export default memo(function SettingsView() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const previousView = useAppStore((s) => s.previousView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  const hasProject = !!activeProjectId;

  // If on a project tab but no project is active, fall back to general
  useEffect(() => {
    const projectTabs: SettingsTabId[] = ["project", "git-worktrees", "acp-permissions", "github"];
    if (!hasProject && projectTabs.includes(activeTab)) {
      setActiveTab("general");
    }
  }, [hasProject, activeTab]);

  // Escape to go back
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setActiveView(previousView ?? "dashboard");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previousView, setActiveView]);

  const handleTabChange = useCallback((tab: SettingsTabId) => {
    setActiveTab(tab);
  }, []);

  return (
    <div
      className="flex flex-col min-h-0 overflow-hidden bg-card/80"
      style={{ gridArea: "content" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-2.5 shrink-0 border-b border-border/40">
        <Palette size={16} className="text-primary" />
        <h1 className="text-sm font-semibold text-foreground">Settings</h1>
        <kbd className="ml-auto px-1.5 py-0.5 rounded bg-accent/60 font-mono text-2xs text-muted-foreground">
          Esc
        </kbd>
      </div>

      {/* Master-detail layout */}
      <div className="flex flex-1 min-h-0">
        <SettingsNav
          activeTab={activeTab}
          onTabChange={handleTabChange}
          hasProject={hasProject}
        />
        <SettingsContent activeTab={activeTab} />
      </div>
    </div>
  );
});
