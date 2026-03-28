import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  ArrowRight,
  Flag,
  Bot,
  Tag,
  Layers,
  Archive,
  Trash2,
  ExternalLink,
  Play,
  Lightbulb,
  Ungroup,
  Pencil,
  ChevronRightIcon,
  CheckIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "../../store/appStore";
import type { Task, TaskStatus } from "../../types";
import { DEFAULT_PRIORITIES, getPriorityLabel, getPriorityBgClass } from "../../lib/priorities";
import ConfirmDialog from "../Review/ConfirmDialog";

// ── Constants ──

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "ready", label: "Ready" },
  { value: "in-progress", label: "In Progress" },
  { value: "in-review", label: "In Review" },
  { value: "done", label: "Done" },
];

// ── Shared menu item styles ──

const menuItemClass =
  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-hidden select-none cursor-default data-disabled:pointer-events-none data-disabled:opacity-50 focus:bg-accent focus:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0";

const destructiveItemClass =
  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-hidden select-none cursor-default text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0";

const subTriggerClass =
  "flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-hidden select-none cursor-default focus:bg-accent focus:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0";

const popupClass =
  "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 bg-popover text-popover-foreground min-w-[160px] rounded-md p-1 shadow-md ring-1 duration-100 z-50 max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto outline-none data-closed:overflow-hidden";

// ── Props ──

export interface TaskContextMenuRenderProps {
  onContextMenu: (e: React.MouseEvent) => void;
  isEditingTitle: boolean;
  onTitleSave: (newTitle: string) => void;
  onTitleEditCancel: () => void;
}

interface TaskCardContextMenuProps {
  task: Task;
  allLabels: string[];
  onTaskClick: (taskId: string) => void;
  onStartSession?: (taskId: string) => void;
  onResearchSession?: (taskId: string) => void;
  onBreakdownEpic?: (taskId: string) => void;
  onViewSession?: (sessionId: string) => void;
  children: (props: TaskContextMenuRenderProps) => React.ReactNode;
}

export default function TaskCardContextMenu({
  task,
  allLabels,
  onTaskClick,
  onStartSession,
  onResearchSession,
  onBreakdownEpic,
  children,
}: TaskCardContextMenuProps) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const priorities = useAppStore((s) =>
    activeProjectId ? (s.projectPriorities[activeProjectId] ?? DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES
  );
  const agents = useAppStore((s) => s.agents);
  const updateTask = useAppStore((s) => s.updateTask);
  const setTasks = useAppStore((s) => s.setTasks);

  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  // Virtual anchor positioned at right-click coordinates
  const cursorPos = useRef({ x: 0, y: 0 });
  const getAnchor = useCallback(() => ({
    getBoundingClientRect: () => new DOMRect(cursorPos.current.x, cursorPos.current.y, 0, 0),
  }), []);

  // Prevent context menu when editing title
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isEditingTitle) return;
    e.preventDefault();
    e.stopPropagation();
    // Update cursor position for virtual anchor
    cursorPos.current = { x: e.clientX, y: e.clientY };
    setMenuOpen(true);
  }, [isEditingTitle]);

  // Close menu on scroll (context menus should dismiss)
  useEffect(() => {
    if (!menuOpen) return;
    const handleScroll = () => setMenuOpen(false);
    window.addEventListener("scroll", handleScroll, { capture: true });
    return () => window.removeEventListener("scroll", handleScroll, { capture: true });
  }, [menuOpen]);

  // ── Save helpers ──

  const saveTaskField = useCallback(
    async (updates: Partial<Task>) => {
      if (!activeProjectId) return;
      const merged = { ...task, ...updates };

      // Optimistic update
      updateTask(merged);

      try {
        const updated = await invoke<Task>("save_task_content", {
          projectId: activeProjectId,
          taskId: task.id,
          title: merged.title,
          status: merged.status,
          priority: merged.priority,
          agent: merged.agent || null,
          model: merged.model || null,
          branch: merged.branch || null,
          githubIssue: merged.github_issue || null,
          dependsOn: merged.depends_on,
          labels: merged.labels,
          body: merged.body,
        });
        updateTask(updated);
      } catch {
        // Revert
        updateTask(task);
        useAppStore.getState().flashError("Failed to update task");
      }
    },
    [activeProjectId, task, updateTask],
  );

  const handleStatusChange = useCallback(
    async (newStatus: TaskStatus) => {
      if (!activeProjectId) return;
      setMenuOpen(false);

      // Optimistic
      const currentTasks = useAppStore.getState().tasks;
      const optimistic = currentTasks.map((t) =>
        t.id === task.id ? { ...t, status: newStatus } : t,
      );
      setTasks(optimistic);

      try {
        const updated = await invoke<Task>("update_task_status", {
          projectId: activeProjectId,
          taskId: task.id,
          status: newStatus,
        });
        updateTask(updated);
      } catch {
        setTasks(currentTasks);
        useAppStore.getState().flashError("Failed to update task status");
      }
    },
    [activeProjectId, task.id, updateTask, setTasks],
  );

  const handlePriorityChange = useCallback(
    (priority: string) => {
      setMenuOpen(false);
      saveTaskField({ priority });
    },
    [saveTaskField],
  );

  const handleAgentChange = useCallback(
    (agent: string | null) => {
      setMenuOpen(false);
      saveTaskField({ agent });
    },
    [saveTaskField],
  );

  const handleLabelToggle = useCallback(
    (label: string) => {
      const newLabels = task.labels.includes(label)
        ? task.labels.filter((l) => l !== label)
        : [...task.labels, label];
      saveTaskField({ labels: newLabels });
    },
    [task.labels, saveTaskField],
  );

  const handleArchive = useCallback(() => {
    setMenuOpen(false);
    handleStatusChange("archived");
  }, [handleStatusChange]);

  const handleDelete = useCallback(async () => {
    if (!activeProjectId) return;
    setShowDeleteConfirm(false);
    try {
      await invoke("delete_task", {
        projectId: activeProjectId,
        taskId: task.id,
      });
      const freshTasks = await invoke<Task[]>("list_tasks", {
        projectId: activeProjectId,
      });
      setTasks(freshTasks);
    } catch {
      useAppStore.getState().flashError("Failed to delete task");
    }
  }, [activeProjectId, task.id, setTasks]);

  const handleTitleSave = useCallback(
    (newTitle: string) => {
      setIsEditingTitle(false);
      if (newTitle.trim() && newTitle.trim() !== task.title) {
        saveTaskField({ title: newTitle.trim() });
      }
    },
    [task.title, saveTaskField],
  );

  const handleTitleEditCancel = useCallback(() => {
    setIsEditingTitle(false);
  }, []);

  // Agent list for submenu
  const agentList = useMemo(
    () => agents.map((a) => a.name),
    [agents],
  );

  // Epic list for submenu (only show for non-epic tasks)
  const tasks = useAppStore((s) => s.tasks);
  const epicList = useMemo(
    () => tasks.filter((t) => t.task_type === "epic" && t.id !== task.id),
    [tasks, task.id],
  );

  const handleEpicChange = useCallback(
    async (epicId: string | null) => {
      if (!activeProjectId) return;
      try {
        await invoke("set_task_type", {
          projectId: activeProjectId,
          taskId: task.id,
          taskType: task.task_type || "task",
          epicId,
        });
        const freshTasks = await invoke<Task[]>("list_tasks", { projectId: activeProjectId });
        setTasks(freshTasks);
      } catch (err) {
        console.warn("Failed to set epic:", err);
      }
    },
    [activeProjectId, task.id, task.task_type, setTasks],
  );

  // Combined labels: task's labels + project-wide labels
  const combinedLabels = useMemo(() => {
    const set = new Set([...allLabels, ...task.labels]);
    return [...set].sort();
  }, [allLabels, task.labels]);

  const renderProps: TaskContextMenuRenderProps = {
    onContextMenu: handleContextMenu,
    isEditingTitle,
    onTitleSave: handleTitleSave,
    onTitleEditCancel: handleTitleEditCancel,
  };

  return (
    <>
      {children(renderProps)}

      {/* Context menu */}
      <MenuPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
        {/* Hidden trigger — required by Base UI for submenu focus tracking */}
        <MenuPrimitive.Trigger
          render={<span />}
          tabIndex={-1}
          style={{ position: "fixed", left: 0, top: 0, width: 0, height: 0, pointerEvents: "none", opacity: 0 }}
        />
        <MenuPrimitive.Portal>
          <MenuPrimitive.Positioner
            className="isolate z-50 outline-none"
            anchor={getAnchor}
            side="bottom"
            align="start"
            sideOffset={4}
          >
            <MenuPrimitive.Popup className={popupClass}>
              {/* Edit title */}
              <MenuPrimitive.Item
                className={menuItemClass}
                onClick={() => {
                  setMenuOpen(false);
                  setIsEditingTitle(true);
                }}
              >
                <Pencil className="size-3.5" />
                Edit title
              </MenuPrimitive.Item>

              <MenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />

              {/* Priority submenu */}
              <MenuPrimitive.SubmenuRoot>
                <MenuPrimitive.SubmenuTrigger className={subTriggerClass}>
                  <Flag className="size-3.5" />
                  Priority
                  <ChevronRightIcon className="size-3.5 ml-auto" />
                </MenuPrimitive.SubmenuTrigger>
                <MenuPrimitive.Portal>
                  <MenuPrimitive.Positioner className="isolate z-50 outline-none" side="right" align="start" sideOffset={2}>
                    <MenuPrimitive.Popup className={cn(popupClass, "min-w-[140px]")}>
                      {priorities.map((p) => (
                        <MenuPrimitive.Item
                          key={p.id}
                          className={menuItemClass}
                          onClick={() => handlePriorityChange(p.id)}
                        >
                          <span className={cn("size-2 rounded-full shrink-0", getPriorityBgClass(p.id, priorities))} />
                          {getPriorityLabel(p.id, priorities)}
                          {task.priority === p.id && <CheckIcon className="size-3.5 ml-auto text-primary" />}
                        </MenuPrimitive.Item>
                      ))}
                    </MenuPrimitive.Popup>
                  </MenuPrimitive.Positioner>
                </MenuPrimitive.Portal>
              </MenuPrimitive.SubmenuRoot>

              {/* Status submenu */}
              <MenuPrimitive.SubmenuRoot>
                <MenuPrimitive.SubmenuTrigger className={subTriggerClass}>
                  <ArrowRight className="size-3.5" />
                  Move to
                  <ChevronRightIcon className="size-3.5 ml-auto" />
                </MenuPrimitive.SubmenuTrigger>
                <MenuPrimitive.Portal>
                  <MenuPrimitive.Positioner className="isolate z-50 outline-none" side="right" align="start" sideOffset={2}>
                    <MenuPrimitive.Popup className={cn(popupClass, "min-w-[140px]")}>
                      {STATUSES.map((s) => (
                        <MenuPrimitive.Item
                          key={s.value}
                          className={menuItemClass}
                          disabled={task.status === s.value}
                          onClick={() => handleStatusChange(s.value)}
                        >
                          {s.label}
                          {task.status === s.value && <CheckIcon className="size-3.5 ml-auto text-primary" />}
                        </MenuPrimitive.Item>
                      ))}
                    </MenuPrimitive.Popup>
                  </MenuPrimitive.Positioner>
                </MenuPrimitive.Portal>
              </MenuPrimitive.SubmenuRoot>

              {/* Agent submenu */}
              <MenuPrimitive.SubmenuRoot>
                <MenuPrimitive.SubmenuTrigger className={subTriggerClass}>
                  <Bot className="size-3.5" />
                  Agent
                  <ChevronRightIcon className="size-3.5 ml-auto" />
                </MenuPrimitive.SubmenuTrigger>
                <MenuPrimitive.Portal>
                  <MenuPrimitive.Positioner className="isolate z-50 outline-none" side="right" align="start" sideOffset={2}>
                    <MenuPrimitive.Popup className={cn(popupClass, "min-w-[140px]")}>
                      <MenuPrimitive.Item
                        className={menuItemClass}
                        onClick={() => handleAgentChange(null)}
                      >
                        <span className="text-muted-foreground">None</span>
                        {!task.agent && <CheckIcon className="size-3.5 ml-auto text-primary" />}
                      </MenuPrimitive.Item>
                      {agentList.map((agent) => (
                        <MenuPrimitive.Item
                          key={agent}
                          className={menuItemClass}
                          onClick={() => handleAgentChange(agent)}
                        >
                          {agent}
                          {task.agent === agent && <CheckIcon className="size-3.5 ml-auto text-primary" />}
                        </MenuPrimitive.Item>
                      ))}
                    </MenuPrimitive.Popup>
                  </MenuPrimitive.Positioner>
                </MenuPrimitive.Portal>
              </MenuPrimitive.SubmenuRoot>

              {/* Labels submenu */}
              {combinedLabels.length > 0 && (
                <MenuPrimitive.SubmenuRoot>
                  <MenuPrimitive.SubmenuTrigger className={subTriggerClass}>
                    <Tag className="size-3.5" />
                    Labels
                    <ChevronRightIcon className="size-3.5 ml-auto" />
                  </MenuPrimitive.SubmenuTrigger>
                  <MenuPrimitive.Portal>
                    <MenuPrimitive.Positioner className="isolate z-50 outline-none" side="right" align="start" sideOffset={2}>
                      <MenuPrimitive.Popup className={cn(popupClass, "min-w-[160px] max-h-[240px]")}>
                        {combinedLabels.map((label) => (
                          <MenuPrimitive.Item
                            key={label}
                            className={menuItemClass}
                            closeOnClick={false}
                            onClick={() => handleLabelToggle(label)}
                          >
                            <span className={cn(
                              "size-3.5 rounded-sm border flex items-center justify-center shrink-0",
                              task.labels.includes(label) ? "bg-primary border-primary" : "border-border",
                            )}>
                              {task.labels.includes(label) && <CheckIcon className="size-2.5 text-primary-foreground" />}
                            </span>
                            <span className="truncate">{label}</span>
                          </MenuPrimitive.Item>
                        ))}
                      </MenuPrimitive.Popup>
                    </MenuPrimitive.Positioner>
                  </MenuPrimitive.Portal>
                </MenuPrimitive.SubmenuRoot>
              )}

              {/* Epic submenu — only for non-epic tasks */}
              {task.task_type !== "epic" && epicList.length > 0 && (
                <MenuPrimitive.SubmenuRoot>
                  <MenuPrimitive.SubmenuTrigger className={subTriggerClass}>
                    <Layers className="size-3.5" />
                    Set Epic
                    <ChevronRightIcon className="size-3.5 ml-auto" />
                  </MenuPrimitive.SubmenuTrigger>
                  <MenuPrimitive.Portal>
                    <MenuPrimitive.Positioner className="isolate z-50 outline-none" side="right" align="start" sideOffset={2}>
                      <MenuPrimitive.Popup className={cn(popupClass, "min-w-[160px]")}>
                        <MenuPrimitive.Item
                          className={menuItemClass}
                          onClick={() => handleEpicChange(null)}
                        >
                          <span className="text-muted-foreground">None</span>
                          {!task.epic_id && <CheckIcon className="size-3.5 ml-auto text-primary" />}
                        </MenuPrimitive.Item>
                        {epicList.map((epic) => (
                          <MenuPrimitive.Item
                            key={epic.id}
                            className={menuItemClass}
                            onClick={() => handleEpicChange(epic.id)}
                          >
                            <span className="truncate">{epic.id} {epic.title}</span>
                            {task.epic_id === epic.id && <CheckIcon className="size-3.5 ml-auto text-primary" />}
                          </MenuPrimitive.Item>
                        ))}
                      </MenuPrimitive.Popup>
                    </MenuPrimitive.Positioner>
                  </MenuPrimitive.Portal>
                </MenuPrimitive.SubmenuRoot>
              )}

              <MenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />

              {/* Session actions */}
              {onStartSession && task.task_type !== "epic" && task.status !== "done" && task.status !== "in-review" && (
                <MenuPrimitive.Item
                  className={menuItemClass}
                  onClick={() => {
                    setMenuOpen(false);
                    onStartSession(task.id);
                  }}
                >
                  <Play className="size-3.5" />
                  Start session
                </MenuPrimitive.Item>
              )}
              {onResearchSession && task.task_type !== "epic" && (task.status === "backlog" || task.status === "ready") && (
                <MenuPrimitive.Item
                  className={menuItemClass}
                  onClick={() => {
                    setMenuOpen(false);
                    onResearchSession(task.id);
                  }}
                >
                  <Lightbulb className="size-3.5 text-warning" />
                  Research task
                </MenuPrimitive.Item>
              )}
              {onBreakdownEpic && task.task_type === "epic" && (task.status === "backlog" || task.status === "ready") && (
                <MenuPrimitive.Item
                  className={menuItemClass}
                  onClick={() => {
                    setMenuOpen(false);
                    onBreakdownEpic(task.id);
                  }}
                >
                  <Ungroup className="size-3.5 text-primary" />
                  Breakdown epic
                </MenuPrimitive.Item>
              )}

              {/* Open in detail view */}
              <MenuPrimitive.Item
                className={menuItemClass}
                onClick={() => {
                  setMenuOpen(false);
                  onTaskClick(task.id);
                }}
              >
                <ExternalLink className="size-3.5" />
                Open detail view
              </MenuPrimitive.Item>

              <MenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />

              {/* Archive */}
              {task.status !== "archived" && (
                <MenuPrimitive.Item
                  className={menuItemClass}
                  onClick={handleArchive}
                >
                  <Archive className="size-3.5" />
                  Archive
                </MenuPrimitive.Item>
              )}

              {/* Delete */}
              <MenuPrimitive.Item
                className={destructiveItemClass}
                onClick={() => {
                  setMenuOpen(false);
                  setShowDeleteConfirm(true);
                }}
              >
                <Trash2 className="size-3.5" />
                Delete
              </MenuPrimitive.Item>
            </MenuPrimitive.Popup>
          </MenuPrimitive.Positioner>
        </MenuPrimitive.Portal>
      </MenuPrimitive.Root>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete task"
          message={`Permanently delete "${task.title}" (${task.id})? This action cannot be undone.`}
          variant="danger"
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}
