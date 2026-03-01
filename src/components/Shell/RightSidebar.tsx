import { FolderTree } from "lucide-react";

import { useAppStore } from "../../store/appStore";
import FileTree from "../Files/FileTree";
import RightSidebarResizeHandle from "./RightSidebarResizeHandle";

export default function RightSidebar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projects = useAppStore((s) => s.projects);

  const activeProject = activeProjectId
    ? projects.find((p) => p.id === activeProjectId)
    : null;

  return (
    <div
      className="relative flex flex-col overflow-hidden select-none border-l border-border bg-card/60"
      style={{ gridArea: "rightsidebar" }}
    >
      {/* Header — matches ApplicationBar height */}
      <div className="flex items-center gap-1.5 px-3 h-[33px] shrink-0 border-b border-border">
        <FolderTree size={13} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Files
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeProject ? (
          <FileTree
            projectPath={activeProject.path}
            projectId={activeProject.id}
          />
        ) : (
          <div className="flex items-center justify-center h-full px-4">
            <p className="text-xs text-muted-foreground text-center">
              Select a project to browse files
            </p>
          </div>
        )}
      </div>

      <RightSidebarResizeHandle />
    </div>
  );
}
