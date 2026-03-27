import { invoke } from "@tauri-apps/api/core";
import { formatError } from "../../lib/errorMessages";
import {
  Eye,
  EyeOff,
  FolderCode,
  Trash2,
} from "lucide-react";
import { useCallback, useState } from "react";

import { useProjectIcon } from "../../hooks/useProjectIcon";
import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { gradientHexColors } from "../ui/orecus.io/lib/color-utils";

import type { Project } from "../../types";
import type { ThemeColor } from "../ui/orecus.io/lib/color-utils";

// ── Small icon preview ──

function ProjectIcon({
  project,
  accentHex,
}: {
  project: Project;
  accentHex: string;
}) {
  const svgMarkup = useProjectIcon(project.id, project.path, project.icon_path);

  if (svgMarkup) {
    return (
      <span
        className="size-4 inline-flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    );
  }
  return (
    <FolderCode
      size={14}
      strokeWidth={1.5}
      style={{ color: accentHex }}
    />
  );
}

// ── Project row ──

function ProjectRow({
  project,
  isVisible,
  onShow,
  onHide,
  onDelete,
}: {
  project: Project;
  isVisible: boolean;
  onShow: () => void;
  onHide: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const themeColor = (project.color as ThemeColor) || "primary";
  const accentHex =
    gradientHexColors[themeColor]?.start ?? gradientHexColors.primary.start;

  return (
    <div
      className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
        isVisible ? "bg-accent/30" : "opacity-60"
      }`}
    >
      {/* Color dot + icon */}
      <div
        className="flex items-center justify-center size-7 rounded-md shrink-0"
        style={{ backgroundColor: `${accentHex}18` }}
      >
        <ProjectIcon project={project} accentHex={accentHex} />
      </div>

      {/* Name + path */}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground truncate">
          {project.name}
        </span>
        <span className="text-xs text-muted-foreground truncate">
          {project.path}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isVisible ? (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Hide from sidebar"
            onClick={onHide}
          >
            <EyeOff size={14} className="text-muted-foreground" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Show in sidebar"
            onClick={onShow}
          >
            <Eye size={14} className="text-muted-foreground" />
          </Button>
        )}
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete project"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} className="text-muted-foreground" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Manage Projects Tab ──

export function ManageProjectsTab() {
  const projects = useAppStore((s) => s.projects);
  const openProjectIds = useAppStore((s) => s.openProjectIds);
  const openProject = useAppStore((s) => s.openProject);
  const closeProject = useAppStore((s) => s.closeProject);
  const removeProjectFromStore = useAppStore((s) => s.removeProject);

  const handleShow = useCallback(
    (id: string) => {
      openProject(id);
    },
    [openProject],
  );

  const handleHide = useCallback(
    (id: string) => {
      closeProject(id);
    },
    [closeProject],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await invoke("remove_project", { id });
        removeProjectFromStore(id);
      } catch (e) {
        console.error("Failed to remove project:", e);
        useAppStore
          .getState()
          .flashError(`Failed to remove project: ${formatError(e)}`);
      }
    },
    [removeProjectFromStore],
  );

  // Sort: visible projects first, then hidden
  const sorted = [...projects].sort((a, b) => {
    const aOpen = openProjectIds.includes(a.id) ? 0 : 1;
    const bOpen = openProjectIds.includes(b.id) ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-muted-foreground">
        Show or hide projects in the sidebar. Use the{" "}
        <span className="text-dim-foreground font-medium">...</span> menu on
        each project in the sidebar to access its settings.
      </div>

      {sorted.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          No projects added yet. Add a project from the sidebar to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {sorted.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              isVisible={openProjectIds.includes(project.id)}
              onShow={() => handleShow(project.id)}
              onHide={() => handleHide(project.id)}
              onDelete={() => handleDelete(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
