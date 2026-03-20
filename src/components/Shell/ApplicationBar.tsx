import { memo } from "react";
import { Blocks, Github, LayoutDashboard, MessageCircle, PanelLeft, PanelRight, TerminalSquare } from "lucide-react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { handleDragRegionMouseDown, needsCustomWindowControls } from "../../lib/platform";
import { useAppStore } from "../../store/appStore";
import { Tabs } from "../ui/orecus.io/navigation/tabs";
import WindowControls from "./WindowControls";

import type { ViewId } from "../../types";

const VIEW_TABS: { id: ViewId; icon: React.ReactNode; label: string }[] = [
  { id: "dashboard", icon: <LayoutDashboard size={14} />, label: "Dashboard" },
  { id: "sessions", icon: <TerminalSquare size={14} />, label: "Sessions" },
  { id: "chat", icon: <MessageCircle size={14} />, label: "Chat" },
  { id: "github", icon: <Github size={14} />, label: "GitHub" },
  { id: "skills-rules", icon: <Blocks size={14} />, label: "Extensions" },
];

const ApplicationBar = memo(function ApplicationBar() {
  const accentColor = useProjectAccentColor();
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar);
  const acpUpdatesAvailable = useAppStore((s) => s.acpUpdatesAvailable);

  // Clamp detail views to dashboard tab for display; help has no tab highlight
  const displayedTab: ViewId =
    activeView === "task-detail" || activeView === "review"
      ? "dashboard"
      : activeView === "help"
        ? ("" as ViewId)
        : activeView;

  return (
    <div
      onMouseDown={handleDragRegionMouseDown}
      className="flex items-center border-b border-border select-none bg-card/60"
      style={{ gridArea: "topbar" }}
    >
      {/* Left sidebar toggle */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors hover:bg-accent ml-1 ${
          !sidebarCollapsed ? "text-primary" : "text-muted-foreground"
        }`}
        title="Toggle sidebar (Ctrl+Shift+B)"
      >
        <PanelLeft size={15} />
      </button>

      {/* Left spacer / drag region */}
      <div className="flex-1 min-w-0" />

      {/* Centered view tabs */}
      <Tabs
        value={displayedTab}
        onChange={(id) => setActiveView(id as ViewId)}
        animation="slide"
        variant="none"
        indicatorVariant="color"
        size="sm"
        color={accentColor}
        barRadius="none"
        tabRadius="sm"
        className="h-full shrink-0"
      >
        {VIEW_TABS.map((tab) => (
          <Tabs.Tab
            key={tab.id}
            value={tab.id}
            icon={tab.icon}
            badge={
              tab.id === "skills-rules" && acpUpdatesAvailable > 0 ? (
                <span className="ml-1 flex size-[16px] items-center justify-center rounded-full bg-warning/20 text-[9px] font-bold text-warning">
                  {acpUpdatesAvailable}
                </span>
              ) : undefined
            }
          >
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs>

      {/* Right spacer / drag region */}
      <div className="flex-1 min-w-0" />

      {/* Right sidebar toggle + separator */}
      <button
        onClick={toggleRightSidebar}
        className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors hover:bg-accent ${
          rightSidebarOpen ? "text-primary" : "text-muted-foreground"
        }`}
        title="Toggle file browser (Ctrl+B)"
      >
        <PanelRight size={15} />
      </button>
      {needsCustomWindowControls() && (
        <div className="h-5 border-l border-border mx-1" />
      )}

      <WindowControls />
    </div>
  );
});

export default ApplicationBar;
