import { AlertTriangle, Loader2 } from "lucide-react";
import { memo, useMemo } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { useAppStore } from "../../store/appStore";
import CommandPalette from "../CommandPalette/CommandPalette";
import DashboardView from "../Dashboard/DashboardView";
import GitHubView from "../GitHub/GitHubView";
import HelpView from "../Help/HelpView";
import ReviewView from "../Review/ReviewView";
import SessionsView from "../Sessions/SessionsView";
import SkillsRulesView from "../SkillsRules/SkillsRulesView";
import TaskDetailView from "../TaskDetail/TaskDetailView";
import UpdateNotification from "../Update/UpdateNotification";
import ApplicationBar from "./ApplicationBar";
import RightSidebar from "./RightSidebar";
import Sidebar from "./Sidebar";
import WelcomeScreen from "./WelcomeScreen";

import type { ReactNode } from "react";
import type { ViewId } from "../../types";

// ── View Router ──

const ViewRouter = memo(function ViewRouter({
  activeView,
}: {
  activeView: ViewId;
}) {
  // SessionsView is always mounted to preserve xterm.js terminal state
  // across view switches. It is hidden via CSS when not the active view.
  // Other views mount/unmount normally since they have no expensive state.

  let otherView: ReactNode = null;
  if (activeView === "dashboard") {
    otherView = <DashboardView />;
  } else if (activeView === "task-detail") {
    otherView = <TaskDetailView />;
  } else if (activeView === "review") {
    otherView = <ReviewView />;
  } else if (activeView === "github") {
    otherView = <GitHubView />;
  } else if (activeView === "skills-rules") {
    otherView = <SkillsRulesView />;
  } else if (activeView === "help") {
    otherView = <HelpView />;
  }

  return (
    <>
      {/* display:contents passes grid-area from SessionsView through;
          display:none hides the entire subtree while keeping it mounted */}
      <div className={activeView === "sessions" ? "contents" : "hidden"}>
        <SessionsView />
      </div>
      {otherView}
    </>
  );
});

// ── Floating Status Toast ──

function FloatingStatusToast() {
  const backgroundTasks = useAppStore((s) => s.backgroundTasks);
  const errorFlash = useAppStore((s) => s.errorFlash);
  const isBusy = backgroundTasks.length > 0;
  const currentTask = backgroundTasks[backgroundTasks.length - 1];
  const isVisible = isBusy || errorFlash;

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md ring-1 shadow-lg transition-all duration-300 ease-out ${
        errorFlash
          ? "bg-destructive/90 ring-destructive/50"
          : "bg-card/90 ring-border/50"
      } ${
        isVisible
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0 pointer-events-none"
      }`}
    >
      {errorFlash ? (
        <>
          <AlertTriangle
            size={14}
            className="text-destructive-foreground shrink-0"
          />
          <span className="text-xs text-destructive-foreground whitespace-nowrap">
            {errorFlash}
          </span>
        </>
      ) : (
        <>
          <Loader2 size={14} className="animate-spin text-primary shrink-0" />
          <span className="text-xs text-foreground whitespace-nowrap">
            {currentTask}
            {backgroundTasks.length > 1 && (
              <span className="ml-1.5 text-muted-foreground">
                +{backgroundTasks.length - 1} more
              </span>
            )}
          </span>
        </>
      )}
    </div>
  );
}

// ── App Shell ──

export default function AppShell() {
  const { isGlass } = useTheme();
  const openProjectIds = useAppStore((s) => s.openProjectIds);
  const activeView = useAppStore((s) => s.activeView);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen);
  const rightSidebarWidth = useAppStore((s) => s.rightSidebarWidth);

  // Memoize grid style to avoid re-creating the object on every render
  // (AppShell re-renders during sidebar drag due to sidebarWidth subscription)
  // NOTE: Must be declared before any early returns to satisfy Rules of Hooks.
  const rightCol = rightSidebarOpen ? `${rightSidebarWidth}px` : "0px";
  const gridStyle = useMemo(
    () => ({
      display: "grid" as const,
      gridTemplateRows: "auto 1fr",
      gridTemplateColumns: `${sidebarWidth}px 1fr ${rightCol}`,
      gridTemplateAreas: rightSidebarOpen
        ? `"sidebar topbar rightsidebar" "sidebar content rightsidebar"`
        : `"sidebar topbar ." "sidebar content ."`,
      height: "100vh",
      overflow: "hidden" as const,
    }),
    [sidebarWidth, rightCol, rightSidebarOpen],
  );

  // No open project tabs → show welcome prompt
  if (openProjectIds.length === 0) {
    return <WelcomeScreen />;
  }

  return (
    <>
      <div
        className={`grid h-screen overflow-hidden transition-[grid-template-columns] duration-200 ease-out ${isGlass ? "bg-transparent" : "bg-background"}`}
        style={gridStyle}
      >
        <ApplicationBar />
        <Sidebar />
        <ViewRouter activeView={activeView} />
        {rightSidebarOpen && <RightSidebar />}
      </div>

      <FloatingStatusToast />
      <UpdateNotification />
      <CommandPalette />
    </>
  );
}
