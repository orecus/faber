import {
  Bug,
  ChevronDown,
  GitCommit,
  type LucideIcon,
  MessageSquare,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useState } from "react";

import { useAppStore } from "../../store/appStore";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { Textarea } from "../ui/textarea";
import { sectionHeadingClass } from "./shared";

import type { PromptTemplate } from "../../types";

// ── Icon mapping ──

const ICON_MAP: Record<string, LucideIcon> = {
  play: Play,
  "rotate-cw": RotateCcw,
  search: Search,
  zap: Zap,
  "git-commit": GitCommit,
  bug: Bug,
  sparkles: Sparkles,
  send: Send,
  "message-square": MessageSquare,
};

const ICON_OPTIONS = [
  { value: "git-commit", label: "Git Commit" },
  { value: "bug", label: "Bug" },
  { value: "sparkles", label: "Sparkles" },
  { value: "send", label: "Send" },
  { value: "play", label: "Play" },
  { value: "search", label: "Search" },
  { value: "zap", label: "Zap" },
  { value: "message-square", label: "Message" },
];

// ── Icon Picker ──

function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {ICON_OPTIONS.map((opt) => {
        const Icon = getIcon(opt.value);
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.label}
            className={`flex items-center justify-center size-8 rounded-[var(--radius-element)] border transition-colors cursor-pointer ${
              isSelected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }`}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

function getIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? Send;
}

// ── Template variables reference ──

const SESSION_VARS: { name: string; description: string; modes?: string[] }[] = [
  { name: "task_id", description: "Task ID (e.g. T-037)" },
  { name: "task_title", description: "Task title from DB" },
  { name: "worktree_hint", description: "Worktree path instruction (or empty)", modes: ["task", "task-continue"] },
  { name: "mode", description: '"parallel" or "chained"', modes: ["queue"] },
  { name: "project_name", description: "Project name" },
  { name: "branch_name", description: "Current git branch" },
];

// ── Session Prompt Row ──

function SessionPromptRow({ template, onSave }: { template: PromptTemplate; onSave: (t: PromptTemplate) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(template.prompt);
  const [dirty, setDirty] = useState(false);

  const Icon = getIcon(template.icon);
  const relevantVars = SESSION_VARS.filter(
    (v) => !v.modes || v.modes.includes(template.session_mode ?? ""),
  );

  const handleSave = useCallback(() => {
    onSave({ ...template, prompt: editedPrompt });
    setDirty(false);
  }, [template, editedPrompt, onSave]);

  const handleReset = useCallback(() => {
    // Reset is handled at parent level — this just collapses
    setExpanded(false);
  }, []);

  return (
    <div className="rounded-lg bg-muted/20 ring-1 ring-border/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/40 transition-colors"
      >
        <Icon size={15} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">{template.label}</span>
        {template.session_mode && (
          <Badge variant="secondary" className="text-2xs">
            {template.session_mode}
          </Badge>
        )}
        <Badge variant="outline" className="text-2xs text-muted-foreground ml-auto mr-2">
          Protected
        </Badge>
        <ChevronDown
          size={14}
          className="text-muted-foreground transition-transform duration-150 shrink-0"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-3 flex flex-col gap-3">
          <Textarea
            value={editedPrompt}
            onChange={(e) => {
              setEditedPrompt(e.target.value);
              setDirty(true);
            }}
            rows={4}
            className="text-sm font-mono"
          />

          {/* Variable reference */}
          <div className="rounded-md bg-popover/60 ring-1 ring-border/30 px-3 py-2">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Available variables
            </div>
            <div className="flex flex-col gap-0.5">
              {relevantVars.map((v) => (
                <div key={v.name} className="flex items-baseline gap-2 text-xs">
                  <code className="text-primary font-mono">{`{{${v.name}}}`}</code>
                  <span className="text-muted-foreground">{v.description}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={!dirty}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick Action Row ──

function QuickActionRow({
  template,
  onSave,
  onDelete,
}: {
  template: PromptTemplate;
  onSave: (t: PromptTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editedLabel, setEditedLabel] = useState(template.label);
  const [editedPrompt, setEditedPrompt] = useState(template.prompt);
  const [editedIcon, setEditedIcon] = useState(template.icon);
  const [editedQuickAction, setEditedQuickAction] = useState(template.quick_action);
  const [dirty, setDirty] = useState(false);

  const Icon = getIcon(template.icon);

  const handleSave = useCallback(() => {
    onSave({
      ...template,
      label: editedLabel.trim() || template.label,
      prompt: editedPrompt,
      icon: editedIcon,
      quick_action: editedQuickAction,
    });
    setDirty(false);
    setExpanded(false);
  }, [template, editedLabel, editedPrompt, editedIcon, editedQuickAction, onSave]);

  return (
    <div className="rounded-lg bg-muted/20 ring-1 ring-border/30 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
        >
          <Icon size={15} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">
            {template.label}
          </span>
          {template.builtin && (
            <Badge variant="secondary" className="text-2xs shrink-0">
              Built-in
            </Badge>
          )}
          <span className="text-xs text-muted-foreground truncate flex-1 text-left">
            {template.prompt.length > 60
              ? template.prompt.slice(0, 60) + "..."
              : template.prompt}
          </span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title="Show as quick action button on session panes">
            <Checkbox
              checked={editedQuickAction}
              onCheckedChange={(checked) => {
                const val = checked === true;
                setEditedQuickAction(val);
                // Auto-save the toggle immediately
                onSave({ ...template, quick_action: val });
              }}
            />
            Quick
          </label>
          <Button
            variant="ghost"
            size="icon-xs"
            hoverEffect="none"
            clickEffect="none"
            onClick={() => onDelete(template.id)}
            title="Delete action"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={13} />
          </Button>
          <ChevronDown
            size={14}
            className="text-muted-foreground transition-transform duration-150 shrink-0 cursor-pointer"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
            onClick={() => setExpanded(!expanded)}
          />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 flex flex-col gap-3">
          {/* Label */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Label</label>
            <input
              value={editedLabel}
              onChange={(e) => { setEditedLabel(e.target.value); setDirty(true); }}
              className="w-full px-2.5 py-1.5 text-sm bg-transparent border border-border rounded-md text-foreground outline-none transition-[color,box-shadow] focus:ring-2 focus:ring-ring/50 focus:border-ring"
            />
          </div>

          {/* Icon */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Icon</label>
            <IconPicker value={editedIcon} onChange={(v) => { setEditedIcon(v); setDirty(true); }} />
          </div>

          {/* Prompt */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Prompt</label>
            <Textarea
              value={editedPrompt}
              onChange={(e) => { setEditedPrompt(e.target.value); setDirty(true); }}
              rows={3}
              className="text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={!dirty}
              onClick={handleSave}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add Action Form ──

function AddActionForm({ onAdd }: { onAdd: (t: Omit<PromptTemplate, "sort_order">) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("send");
  const [prompt, setPrompt] = useState("");
  const [quickAction, setQuickAction] = useState(true);

  const handleAdd = useCallback(() => {
    if (!label.trim() || !prompt.trim()) return;
    onAdd({
      id: `action-${Date.now()}`,
      label: label.trim(),
      icon,
      prompt: prompt.trim(),
      category: "action",
      quick_action: quickAction,
      builtin: false,
    });
    setLabel("");
    setIcon("send");
    setPrompt("");
    setQuickAction(true);
    setOpen(false);
  }, [label, icon, prompt, quickAction, onAdd]);

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        leftIcon={<Plus className="size-3.5" />}
      >
        Add Action
      </Button>
    );
  }

  return (
    <div className="rounded-lg bg-muted/20 ring-1 ring-border/30 p-3 flex flex-col gap-3">
      {/* Label */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Label</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g., Run Tests"
          className="w-full px-2.5 py-1.5 text-sm bg-transparent border border-border rounded-md text-foreground outline-none transition-[color,box-shadow] focus:ring-2 focus:ring-ring/50 focus:border-ring"
        />
      </div>

      {/* Icon */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Icon</label>
        <IconPicker value={icon} onChange={setIcon} />
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Prompt</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="The prompt text to send to the agent..."
          rows={3}
          className="text-sm"
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs text-dim-foreground cursor-pointer">
          <Checkbox
            checked={quickAction}
            onCheckedChange={(checked) => setQuickAction(checked === true)}
          />
          Show as quick action button
        </label>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={!label.trim() || !prompt.trim()}
            onClick={handleAdd}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main PromptsTab ──

export function PromptsTab() {
  const promptTemplates = useAppStore((s) => s.promptTemplates);
  const savePromptTemplates = useAppStore((s) => s.savePromptTemplates);
  const resetPromptTemplates = useAppStore((s) => s.resetPromptTemplates);

  const sessionTemplates = promptTemplates.filter((t) => t.category === "session");
  const actionTemplates = promptTemplates
    .filter((t) => t.category === "action")
    .sort((a, b) => a.sort_order - b.sort_order);

  const handleSaveTemplate = useCallback(
    (updated: PromptTemplate) => {
      const newList = promptTemplates.map((t) =>
        t.id === updated.id ? updated : t,
      );
      savePromptTemplates(newList);
    },
    [promptTemplates, savePromptTemplates],
  );

  const handleDeleteAction = useCallback(
    (id: string) => {
      const newList = promptTemplates.filter((t) => t.id !== id);
      savePromptTemplates(newList);
    },
    [promptTemplates, savePromptTemplates],
  );

  const handleAddAction = useCallback(
    (partial: Omit<PromptTemplate, "sort_order">) => {
      const maxOrder = Math.max(0, ...actionTemplates.map((t) => t.sort_order));
      const newTemplate: PromptTemplate = { ...partial, sort_order: maxOrder + 1 };
      savePromptTemplates([...promptTemplates, newTemplate]);
    },
    [promptTemplates, actionTemplates, savePromptTemplates],
  );

  const handleReset = useCallback(() => {
    resetPromptTemplates();
  }, [resetPromptTemplates]);

  return (
    <div className="flex flex-col gap-5 pb-1">
      {/* Session Prompts */}
      <section>
        <div className={sectionHeadingClass}>Session Prompts</div>
        <p className="text-xs text-muted-foreground mb-3 -mt-1">
          Default prompts used when launching task, research, and queue mode sessions.
          These cannot be deleted but can be customized.
        </p>
        <div className="flex flex-col gap-2">
          {sessionTemplates.map((t) => (
            <SessionPromptRow key={t.id} template={t} onSave={handleSaveTemplate} />
          ))}
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <div className={sectionHeadingClass}>Quick Actions</div>
        <p className="text-xs text-muted-foreground mb-3 -mt-1">
          Action buttons shown on active session panes. Click to send the prompt to the agent.
        </p>
        <div className="flex flex-col gap-2">
          {actionTemplates.map((t) => (
            <QuickActionRow
              key={t.id}
              template={t}
              onSave={handleSaveTemplate}
              onDelete={handleDeleteAction}
            />
          ))}
          <AddActionForm onAdd={handleAddAction} />
        </div>
      </section>

      {/* Reset all */}
      <div className="flex justify-end border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          leftIcon={<RotateCcw className="size-3.5" />}
        >
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}
