import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, FolderTree, Search, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { useAppStore } from "../../store/appStore";
import FileTree from "../Files/FileTree";
import RightSidebarResizeHandle from "./RightSidebarResizeHandle";

export default function RightSidebar() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projects = useAppStore((s) => s.projects);
  const [filterText, setFilterText] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);

  const activeProject = activeProjectId
    ? projects.find((p) => p.id === activeProjectId)
    : null;

  const handleRevealInExplorer = useCallback(() => {
    if (activeProject?.path) {
      invoke("open_file_in_os", { path: activeProject.path });
    }
  }, [activeProject?.path]);

  const handleClearFilter = useCallback(() => {
    setFilterText("");
    filterInputRef.current?.focus();
  }, []);

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

      {/* Search/filter input */}
      {activeProject && (
        <div className="shrink-0 px-2 py-1.5 border-b border-border">
          <div className="relative flex items-center">
            <Search
              size={12}
              className="absolute left-2 text-muted-foreground pointer-events-none"
            />
            <input
              ref={filterInputRef}
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter files..."
              className="w-full h-6 pl-6 pr-6 rounded bg-muted/50 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {filterText && (
              <button
                type="button"
                onClick={handleClearFilter}
                className="absolute right-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeProject ? (
          <FileTree
            projectPath={activeProject.path}
            projectId={activeProject.id}
            filterText={filterText}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <FolderTree className="mb-3 size-10 opacity-30 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              No project open
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a project to browse its files
            </p>
          </div>
        )}
      </div>

      {/* Footer — Reveal in Explorer button */}
      {activeProject && (
        <div className="shrink-0 border-t border-border px-2 py-1.5">
          <button
            type="button"
            onClick={handleRevealInExplorer}
            className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
            title="Open the project folder in your system file manager"
          >
            <ExternalLink size={13} />
            <span>Reveal in File Manager</span>
          </button>
        </div>
      )}

      <RightSidebarResizeHandle />
    </div>
  );
}
