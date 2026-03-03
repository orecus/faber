import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, FolderTree } from "lucide-react";
import { useCallback } from "react";

import { useAppStore } from "../../store/appStore";
import FileTree from "../Files/FileTree";
import RightSidebarResizeHandle from "./RightSidebarResizeHandle";

export default function RightSidebar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projects = useAppStore((s) => s.projects);

  const activeProject = activeProjectId
    ? projects.find((p) => p.id === activeProjectId)
    : null;

  const handleOpenFolder = useCallback(() => {
    if (activeProject?.path) {
      invoke("open_file_in_os", { path: activeProject.path });
    }
  }, [activeProject?.path]);

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

      {/* Footer — Open Folder button */}
      {activeProject && (
        <div className="shrink-0 border-t border-border px-2 py-1.5">
          <button
            type="button"
            onClick={handleOpenFolder}
            className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
          >
            <FolderOpen size={13} />
            <span>Open Folder</span>
          </button>
        </div>
      )}

      <RightSidebarResizeHandle />
    </div>
  );
}
