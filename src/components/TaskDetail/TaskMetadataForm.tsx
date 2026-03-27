import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { TaskStatus, AgentInfo } from "../../types";
import { useAppStore } from "../../store/appStore";
import { DEFAULT_PRIORITIES, getPriorityLabel, getPriorityCssVar } from "../../lib/priorities";
import { TASK_STATUS_CSS_COLORS, TASK_STATUS_LABELS } from "../../lib/taskStatusColors";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] =
  (["backlog", "ready", "in-progress", "in-review", "done", "archived"] as TaskStatus[]).map(
    (v) => ({ value: v, label: TASK_STATUS_LABELS[v] }),
  );

export interface TaskFormData {
  title: string;
  status: TaskStatus;
  priority: string;
  agent: string;
  model: string;
  branch: string;
  github_issue: string;
  depends_on: string;
  labels: string;
}

interface TaskMetadataFormProps {
  data: TaskFormData;
  onChange: (data: TaskFormData) => void;
  editing: boolean;
  agents: AgentInfo[];
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function ReadonlyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="min-h-[32px] text-sm text-foreground">
        {children}
      </div>
    </div>
  );
}

export default function TaskMetadataForm({ data, onChange, editing, agents }: TaskMetadataFormProps) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const priorities = useAppStore((s) =>
    activeProjectId ? (s.projectPriorities[activeProjectId] ?? DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES
  );
  const update = <K extends keyof TaskFormData>(field: K, value: TaskFormData[K]) => {
    onChange({ ...data, [field]: value });
  };

  if (!editing) {
    const statusLabel = STATUS_OPTIONS.find((o) => o.value === data.status)?.label ?? data.status;
    return (
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-6 gap-y-3">
        <div className="col-span-3">
          <FieldLabel>Title</FieldLabel>
          <div className="text-sm font-medium text-foreground">{data.title}</div>
        </div>

        <ReadonlyField label="Status">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: TASK_STATUS_CSS_COLORS[data.status] }}
            />
            {statusLabel}
          </span>
        </ReadonlyField>

        <ReadonlyField label="Priority">
          <span style={{ color: getPriorityCssVar(data.priority, priorities) }}>{data.priority}</span>
        </ReadonlyField>

        <ReadonlyField label="Agent">
          {data.agent || <span className="text-muted-foreground">—</span>}
        </ReadonlyField>

        {data.model && <ReadonlyField label="Model">{data.model}</ReadonlyField>}

        {data.branch && <ReadonlyField label="Branch">
          <code className="rounded bg-popover px-1.5 py-0.5 text-xs">{data.branch}</code>
        </ReadonlyField>}

        {data.github_issue && <ReadonlyField label="GitHub Issue">
          <span className="text-primary">{data.github_issue}</span>
        </ReadonlyField>}
      </div>
    );
  }

  // ── Edit mode ──
  const installedAgents = agents.filter((a) => a.installed);

  return (
    <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-4 gap-y-3">
      {/* Title — full width */}
      <div className="col-span-3">
        <FieldLabel>Title</FieldLabel>
        <Input
          value={data.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="Task title"
          className="text-sm"
        />
      </div>

      {/* Status */}
      <div>
        <FieldLabel>Status</FieldLabel>
        <Select value={data.status} onValueChange={(v) => { if (v) update("status", v as TaskStatus); }} items={STATUS_OPTIONS}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Priority */}
      <div>
        <FieldLabel>Priority</FieldLabel>
        <Select value={data.priority} onValueChange={(v) => { if (v) update("priority", v); }} items={priorities.map((p) => ({ value: p.id, label: getPriorityLabel(p.id, priorities) }))}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {priorities.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {getPriorityLabel(p.id, priorities)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Agent */}
      <div>
        <FieldLabel>Agent</FieldLabel>
        <Select
          value={data.agent || "__none__"}
          onValueChange={(v) => {
            const newAgent = v === "__none__" || v === null ? "" : v;
            onChange({ ...data, agent: newAgent, model: "" });
          }}
          items={[
            { value: "__none__", label: "None" },
            ...installedAgents.map((a) => ({ value: a.name, label: a.display_name })),
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
      </div>

      {/* Model */}
      <div>
        <FieldLabel>Model</FieldLabel>
        {(() => {
          const currentAgent = installedAgents.find((a) => a.name === data.agent);
          const models = currentAgent?.supported_models ?? [];
          if (models.length > 0) {
            return (
              <Select
                value={data.model || "__none__"}
                onValueChange={(v) => update("model", !v || v === "__none__" ? "" : v)}
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
                    <SelectItem key={m} value={m}>{m}</SelectItem>
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
            />
          );
        })()}
      </div>

      {/* Branch */}
      <div>
        <FieldLabel>Branch</FieldLabel>
        <Input
          value={data.branch}
          onChange={(e) => update("branch", e.target.value)}
          placeholder="feat/..."
          className="font-mono text-xs"
        />
      </div>

      {/* GitHub Issue */}
      <div>
        <FieldLabel>GitHub Issue</FieldLabel>
        <Input
          value={data.github_issue}
          onChange={(e) => update("github_issue", e.target.value)}
          placeholder="#123"
        />
      </div>

      {/* Labels — 2/3 width */}
      <div className="col-span-2">
        <FieldLabel>Labels (comma-separated)</FieldLabel>
        <Input
          value={data.labels}
          onChange={(e) => update("labels", e.target.value)}
          placeholder="backend, api, core"
        />
      </div>

      {/* Depends On — 1/3 width */}
      <div>
        <FieldLabel>Depends On (task IDs)</FieldLabel>
        <Input
          value={data.depends_on}
          onChange={(e) => update("depends_on", e.target.value)}
          placeholder="T-001, T-002"
          className="font-mono text-xs"
        />
      </div>
    </div>
  );
}
