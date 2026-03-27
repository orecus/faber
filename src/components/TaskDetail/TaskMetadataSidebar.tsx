import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import {
  AlertTriangle,
  ArrowUpRight,
  CornerDownRight,
  ExternalLink,
  GitBranch,
  Github,
  Layers,
  Loader2,
  Plus,
  Tag,
} from "lucide-react";
import { useCallback, useMemo } from "react";

import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { TaskFormData } from "./TaskMetadataForm";

import { useAppStore } from "../../store/appStore";
import type { AgentInfo, Task, TaskStatus, TaskType } from "../../types";
import { DEFAULT_PRIORITIES, getPriorityLabel, getPriorityCssVar } from "../../lib/priorities";
import { TASK_STATUS_CSS_COLORS, TASK_STATUS_LABELS } from "../../lib/taskStatusColors";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] =
  (["backlog", "ready", "in-progress", "in-review", "done", "archived"] as TaskStatus[]).map(
    (v) => ({ value: v, label: TASK_STATUS_LABELS[v] }),
  );

interface TaskMetadataSidebarProps {
  data: TaskFormData;
  onChange: (data: TaskFormData) => void;
  agents: AgentInfo[];
  taskId: string;
  tasks: Task[];
  taskType: TaskType;
  epicId: string | null;
  onNavigateToTask: (taskId: string) => void;
  onCreateGitHubIssue?: () => void;
  creatingIssue?: boolean;
}

function SidebarSection({
  label,
  children,
  icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

export default function TaskMetadataSidebar({
  data,
  onChange,
  agents,
  taskId,
  tasks,
  taskType,
  epicId,
  onNavigateToTask,
  onCreateGitHubIssue,
  creatingIssue,
}: TaskMetadataSidebarProps) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const priorities = useAppStore((s) =>
    activeProjectId ? (s.projectPriorities[activeProjectId] ?? DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES
  );
  const setTasks = useAppStore((s) => s.setTasks);

  const update = <K extends keyof TaskFormData>(
    field: K,
    value: TaskFormData[K],
  ) => {
    onChange({ ...data, [field]: value });
  };

  const installedAgents = agents.filter((a) => a.installed);

  // Available epics for the selector (exclude self)
  const epicList = useMemo(
    () => tasks.filter((t) => t.task_type === "epic" && t.id !== taskId),
    [tasks, taskId],
  );

  const handleEpicChange = useCallback(
    async (newEpicId: string | null) => {
      if (!activeProjectId) return;
      try {
        await invoke("set_task_type", {
          projectId: activeProjectId,
          taskId,
          taskType: taskType || "task",
          epicId: newEpicId,
        });
        const freshTasks = await invoke<Task[]>("list_tasks", {
          projectId: activeProjectId,
        });
        setTasks(freshTasks);
      } catch (err) {
        console.warn("Failed to set epic:", err);
      }
    },
    [activeProjectId, taskId, taskType, setTasks],
  );

  const handleOpenIssue = useCallback(() => {
    if (!data.github_issue) return;
    const [slug, num] = data.github_issue.split("#");
    if (slug && num) {
      open(`https://github.com/${slug}/issues/${num}`);
    }
  }, [data.github_issue]);

  // Parse labels and deps for display
  const labelBadges = data.labels
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const depBadges = data.depends_on
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Find sub-tasks (tasks that depend on this task)
  const subTasks = useMemo(
    () => tasks.filter((t) => t.depends_on.includes(taskId)),
    [tasks, taskId],
  );

  // Resolve parent tasks (tasks this one depends on) for display
  const parentTasks = useMemo(
    () =>
      depBadges
        .map((id) => tasks.find((t) => t.id === id))
        .filter(Boolean) as Task[],
    [depBadges, tasks],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Status */}
      <SidebarSection label="Status">
        <Select
          value={data.status}
          onValueChange={(v) => {
            if (v) update("status", v as TaskStatus);
          }}
          items={STATUS_OPTIONS}
        >
          <SelectTrigger className="w-full">
            <span className="flex items-center gap-2">
              <span
                className="inline-block size-2 rounded-full shrink-0"
                style={{ background: TASK_STATUS_CSS_COLORS[data.status] }}
              />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: TASK_STATUS_CSS_COLORS[opt.value] }}
                  />
                  {opt.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {taskType === "epic" && (
          <p className="text-2xs text-muted-foreground mt-0.5">
            Auto-derived from children
          </p>
        )}
      </SidebarSection>

      {/* Priority */}
      <SidebarSection
        label="Priority"
        icon={<AlertTriangle size={10} className="opacity-60" />}
      >
        <Select
          value={data.priority}
          onValueChange={(v) => {
            if (v) update("priority", v);
          }}
          items={priorities.map((p) => ({ value: p.id, label: getPriorityLabel(p.id, priorities) }))}
        >
          <SelectTrigger className="w-full">
            <span className="flex items-center gap-2">
              <span
                className="inline-block size-2 rounded-full shrink-0"
                style={{ background: getPriorityCssVar(data.priority, priorities) }}
              />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            {priorities.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: getPriorityCssVar(p.id, priorities) }}
                  />
                  {getPriorityLabel(p.id, priorities)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SidebarSection>

      {/* Epic — only for non-epic tasks when epics exist */}
      {taskType !== "epic" && epicList.length > 0 && (
        <SidebarSection
          label="Epic"
          icon={<Layers size={10} className="opacity-60" />}
        >
          <Select
            value={epicId || "__none__"}
            onValueChange={(v) => {
              handleEpicChange(!v || v === "__none__" ? null : v);
            }}
            items={[
              { value: "__none__", label: "None" },
              ...epicList.map((e) => ({
                value: e.id,
                label: `${e.id} — ${e.title}`,
              })),
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {epicList.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  <span className="flex items-center gap-1.5">
                    <Layers size={10} className="shrink-0 text-muted-foreground" />
                    <span className="font-mono text-2xs text-muted-foreground">
                      {e.id}
                    </span>
                    <span className="truncate">{e.title}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SidebarSection>
      )}

      {/* Agent — hidden for epics */}
      {taskType !== "epic" && (
        <SidebarSection label="Agent">
          <Select
            value={data.agent || "__none__"}
            onValueChange={(v) => {
              const newAgent = v === "__none__" || v === null ? "" : v;
              onChange({ ...data, agent: newAgent, model: "" });
            }}
            items={[
              { value: "__none__", label: "None" },
              ...installedAgents.map((a) => ({
                value: a.name,
                label: a.display_name,
              })),
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {installedAgents.map((a) => (
                <SelectItem key={a.name} value={a.name}>
                  {a.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SidebarSection>
      )}

      {/* Model — hidden for epics */}
      {taskType !== "epic" && (
        <SidebarSection label="Model">
          {(() => {
            const currentAgent = installedAgents.find(
              (a) => a.name === data.agent,
            );
            const models = currentAgent?.supported_models ?? [];
            if (models.length > 0) {
              return (
                <Select
                  value={data.model || "__none__"}
                  onValueChange={(v) =>
                    update("model", !v || v === "__none__" ? "" : v)
                  }
                  items={[
                    { value: "__none__", label: "Default" },
                    ...models.map((m) => ({ value: m, label: m })),
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Default</SelectItem>
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            }
            return (
              <Input
                value={data.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="e.g. provider/model"
                className="text-xs"
              />
            );
          })()}
        </SidebarSection>
      )}

      {/* Divider */}
      <div className="border-t border-border/60" />

      {/* Branch */}
      <SidebarSection
        label="Branch"
        icon={<GitBranch size={10} className="opacity-60" />}
      >
        <Input
          value={data.branch}
          onChange={(e) => update("branch", e.target.value)}
          placeholder="feat/..."
          className="font-mono text-xs"
        />
      </SidebarSection>

      {/* GitHub Issue */}
      <SidebarSection
        label="GitHub Issue"
        icon={<Github size={10} className="opacity-60" />}
      >
        <div className="flex items-center gap-1.5">
          <Input
            value={data.github_issue}
            onChange={(e) => update("github_issue", e.target.value)}
            placeholder="owner/repo#123"
            className="flex-1 text-xs"
          />
          {data.github_issue ? (
            <button
              onClick={handleOpenIssue}
              className="cursor-pointer flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Open on GitHub"
            >
              <ExternalLink size={13} />
            </button>
          ) : onCreateGitHubIssue ? (
            <button
              onClick={onCreateGitHubIssue}
              disabled={creatingIssue}
              className="cursor-pointer flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              title="Create GitHub issue from this task"
            >
              {creatingIssue ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Plus size={13} />
              )}
            </button>
          ) : null}
        </div>
      </SidebarSection>

      {/* Divider */}
      <div className="border-t border-border/60" />

      {/* Labels */}
      <SidebarSection
        label="Labels"
        icon={<Tag size={10} className="opacity-60" />}
      >
        {labelBadges.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1">
            {labelBadges.map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="text-2xs px-1.5 py-0"
              >
                {label}
              </Badge>
            ))}
          </div>
        )}
        <Input
          value={data.labels}
          onChange={(e) => update("labels", e.target.value)}
          placeholder="backend, api, core"
          className="text-xs"
        />
      </SidebarSection>

      {/* Dependencies (parents) */}
      <SidebarSection
        label="Depends on"
        icon={<ArrowUpRight size={10} className="opacity-60" />}
      >
        {parentTasks.length > 0 && (
          <div className="flex flex-col gap-0.5 pb-1">
            {parentTasks.map((t) => (
              <button
                key={t.id}
                onClick={() => onNavigateToTask(t.id)}
                className="cursor-pointer flex items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left text-xs leading-none transition-colors hover:bg-accent group/dep"
              >
                <span
                  className="inline-block size-1.5 rounded-full shrink-0 translate-y-[-0.5px]"
                  style={{ background: TASK_STATUS_CSS_COLORS[t.status] }}
                />
                <span className="font-mono text-2xs text-muted-foreground shrink-0">
                  {t.id}
                </span>
                <span className="truncate text-foreground/80 group-hover/dep:text-foreground">
                  {t.title}
                </span>
              </button>
            ))}
          </div>
        )}
        {/* Show orphan IDs that don't resolve to a task */}
        {depBadges.filter((id) => !tasks.find((t) => t.id === id)).length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1">
            {depBadges
              .filter((id) => !tasks.find((t) => t.id === id))
              .map((dep) => (
                <Badge
                  key={dep}
                  variant="outline"
                  className="font-mono text-2xs px-1.5 py-0"
                >
                  {dep}
                </Badge>
              ))}
          </div>
        )}
        <Input
          value={data.depends_on}
          onChange={(e) => update("depends_on", e.target.value)}
          placeholder="T-001, T-002"
          className="font-mono text-xs"
        />
      </SidebarSection>

      {/* Sub-tasks (children that depend on this task) */}
      {subTasks.length > 0 && (
        <SidebarSection
          label="Sub-tasks"
          icon={<CornerDownRight size={10} className="opacity-60" />}
        >
          <div className="flex flex-col gap-0.5">
            {subTasks.map((t) => (
              <button
                key={t.id}
                onClick={() => onNavigateToTask(t.id)}
                className="cursor-pointer flex items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left text-xs leading-none transition-colors hover:bg-accent group/sub"
              >
                <span
                  className="inline-block size-1.5 rounded-full shrink-0 translate-y-[-0.5px]"
                  style={{ background: TASK_STATUS_CSS_COLORS[t.status] }}
                />
                <span className="font-mono text-2xs text-muted-foreground shrink-0">
                  {t.id}
                </span>
                <span className="truncate text-foreground/80 group-hover/sub:text-foreground">
                  {t.title}
                </span>
              </button>
            ))}
          </div>
        </SidebarSection>
      )}
    </div>
  );
}
