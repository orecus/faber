import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  ChevronRightIcon,
  Copy,
  ExternalLink,
  FileCode2,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";

import type { ChangedFile } from "../../types";
import type { FileSection } from "./useDiffData";
import ConfirmDialog from "./ConfirmDialog";

// ── Shared menu styles (same as other context menus) ──

const menuItemClass =
  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-hidden select-none cursor-default data-disabled:pointer-events-none data-disabled:opacity-50 focus:bg-accent focus:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0";

const subTriggerClass =
  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-hidden select-none cursor-default focus:bg-accent focus:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0";

const popupClass =
  "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 bg-popover text-popover-foreground min-w-[160px] rounded-md p-1 shadow-md ring-1 duration-100 z-50 max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto outline-none data-closed:overflow-hidden";

// ── Types ──

interface EditorInfo {
  id: string;
  label: string;
  command: string;
}

interface FileChangesContextMenuProps {
  file: ChangedFile;
  section: FileSection;
  worktreePath: string;
  projectId: string;
  onToggleStage?: () => void;
  onRefresh: () => void;
  children: (props: { onContextMenu: (e: React.MouseEvent) => void }) => React.ReactNode;
}

export default function FileChangesContextMenu({
  file,
  section,
  worktreePath,
  projectId,
  onToggleStage,
  onRefresh,
  children,
}: FileChangesContextMenuProps) {
  const [open, setOpen] = useState(false);
  const positionRef = useRef({ x: 0, y: 0 });
  const [editors, setEditors] = useState<EditorInfo[]>([]);
  const editorsLoaded = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const isChanges = section === "changes";
  const fullPath = `${worktreePath}/${file.path}`;

  // Load available editors once
  useEffect(() => {
    if (editorsLoaded.current) return;
    editorsLoaded.current = true;
    invoke<EditorInfo[]>("detect_editors")
      .then(setEditors)
      .catch(() => setEditors([]));
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    positionRef.current = { x: e.clientX, y: e.clientY };
    setOpen(true);
  }, []);

  // Close on scroll
  useEffect(() => {
    if (!open) return;
    const handleScroll = () => setOpen(false);
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  const handleCopyRelPath = useCallback(() => {
    navigator.clipboard.writeText(file.path);
    setOpen(false);
  }, [file.path]);

  const handleCopyAbsPath = useCallback(() => {
    navigator.clipboard.writeText(fullPath);
    setOpen(false);
  }, [fullPath]);

  const handleRevealInExplorer = useCallback(() => {
    invoke("open_file_in_os", { path: fullPath });
    setOpen(false);
  }, [fullPath]);

  const handleOpenInEditor = useCallback(
    (editorId: string) => {
      invoke("open_in_editor", { path: fullPath, editorId });
      setOpen(false);
    },
    [fullPath],
  );

  const handleStageUnstage = useCallback(() => {
    onToggleStage?.();
    setOpen(false);
  }, [onToggleStage]);

  const handleDiscardChanges = useCallback(async () => {
    setConfirmDiscard(false);
    try {
      await invoke("discard_file", { projectId, worktreePath, filePath: file.path });
      onRefresh();
    } catch {
      // Error is non-fatal; user can retry
    }
  }, [projectId, worktreePath, file.path, onRefresh]);

  return (
    <>
      <MenuPrimitive.Root open={open} onOpenChange={setOpen}>
        <MenuPrimitive.Trigger
          className="hidden"
          style={{ position: "fixed", left: 0, top: 0 }}
        />

        {children({ onContextMenu: handleContextMenu })}

        <MenuPrimitive.Portal>
          <MenuPrimitive.Positioner
            side="bottom"
            align="start"
            sideOffset={0}
            anchor={{
              getBoundingClientRect: () => ({
                x: positionRef.current.x,
                y: positionRef.current.y,
                width: 0,
                height: 0,
                top: positionRef.current.y,
                right: positionRef.current.x,
                bottom: positionRef.current.y,
                left: positionRef.current.x,
                toJSON: () => {},
              }),
            }}
          >
            <MenuPrimitive.Popup className={popupClass}>
              {/* Stage / Unstage (changes section only) */}
              {isChanges && (
                <>
                  <MenuPrimitive.Item
                    className={menuItemClass}
                    onClick={handleStageUnstage}
                  >
                    {file.staged ? (
                      <Minus size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    {file.staged ? "Unstage" : "Stage"}
                  </MenuPrimitive.Item>

                  {/* Discard Changes */}
                  <MenuPrimitive.Item
                    className={`${menuItemClass} text-destructive focus:text-destructive`}
                    onClick={() => {
                      setOpen(false);
                      setConfirmDiscard(true);
                    }}
                  >
                    <Trash2 size={14} />
                    Discard Changes
                  </MenuPrimitive.Item>

                  <MenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />
                </>
              )}

              {/* Open in Editor */}
              {editors.length === 1 && (
                <MenuPrimitive.Item
                  className={menuItemClass}
                  onClick={() => handleOpenInEditor(editors[0].id)}
                >
                  <FileCode2 size={14} />
                  Open in {editors[0].label}
                </MenuPrimitive.Item>
              )}
              {editors.length > 1 && (
                <MenuPrimitive.SubmenuRoot>
                  <MenuPrimitive.SubmenuTrigger className={subTriggerClass}>
                    <FileCode2 size={14} />
                    Open in Editor
                    <ChevronRightIcon className="ml-auto size-3.5" />
                  </MenuPrimitive.SubmenuTrigger>
                  <MenuPrimitive.Portal>
                    <MenuPrimitive.Positioner
                      className="isolate z-50 outline-none"
                      side="right"
                      align="start"
                      sideOffset={2}
                    >
                      <MenuPrimitive.Popup className={popupClass}>
                        {editors.map((editor) => (
                          <MenuPrimitive.Item
                            key={editor.id}
                            className={menuItemClass}
                            onClick={() => handleOpenInEditor(editor.id)}
                          >
                            {editor.label}
                          </MenuPrimitive.Item>
                        ))}
                      </MenuPrimitive.Popup>
                    </MenuPrimitive.Positioner>
                  </MenuPrimitive.Portal>
                </MenuPrimitive.SubmenuRoot>
              )}

              {/* Reveal in File Manager */}
              <MenuPrimitive.Item
                className={menuItemClass}
                onClick={handleRevealInExplorer}
              >
                <ExternalLink size={14} />
                Reveal in File Manager
              </MenuPrimitive.Item>

              <MenuPrimitive.Separator className="my-1 h-px bg-border" />

              {/* Copy path options */}
              <MenuPrimitive.Item
                className={menuItemClass}
                onClick={handleCopyRelPath}
              >
                <Copy size={14} />
                Copy Relative Path
              </MenuPrimitive.Item>

              <MenuPrimitive.Item
                className={menuItemClass}
                onClick={handleCopyAbsPath}
              >
                <Copy size={14} />
                Copy Absolute Path
              </MenuPrimitive.Item>
            </MenuPrimitive.Popup>
          </MenuPrimitive.Positioner>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Root>

      {/* Discard confirmation dialog */}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard Changes"
          message={`Are you sure you want to discard all changes to "${file.path}"? This cannot be undone.`}
          variant="danger"
          confirmLabel="Discard"
          onConfirm={handleDiscardChanges}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}
