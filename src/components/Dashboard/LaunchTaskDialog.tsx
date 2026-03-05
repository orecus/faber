import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { AGENT_DESCRIPTIONS } from "../../lib/agentDescriptions";
import { AgentIcon, getAgentColor } from "../../lib/agentIcons";
import { formatErrorWithHint } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { borderAccentColors } from "../ui/orecus.io/lib/color-utils";
import BranchSelect from "../ui/BranchSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";

import type { Task } from "../../types";

interface LaunchTaskDialogProps {
  task: Task;
  projectId: string;
  onLaunched: () => void;
  onDismiss: () => void;
}

export default function LaunchTaskDialog({
  task,
  projectId,
  onLaunched,
  onDismiss,
}: LaunchTaskDialogProps) {
  const accentColor = useProjectAccentColor();
  const agents = useAppStore((s) => s.agents);
  const projectInfo = useAppStore((s) => s.projectInfo);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [baseBranch, setBaseBranch] = useState<string>("");
  const [createWorktree, setCreateWorktree] = useState(true);
  const [userPrompt, setUserPrompt] = useState(
    `Let's start working on task ${task.id}. Use the \`get_task\` MCP tool to fetch the task details, then return a short summary and ask the user if they are ready to start.`,
  );
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // Resolve default agent: task.agent → project.default_agent → first installed
  useEffect(() => {
    if (agents.length === 0 || selectedAgentName) return;

    const defaultAgentName =
      task.agent ?? projectInfo?.project.default_agent ?? null;

    const target = defaultAgentName
      ? agents.find((a) => a.name === defaultAgentName && a.installed)
      : null;
    const resolved = target ?? agents.find((a) => a.installed) ?? agents[0];

    if (resolved) {
      setSelectedAgentName(resolved.name);

      // If the task already has a model set, use it; otherwise default to "" (no --model flag)
      const taskModel = task.model ?? "";
      const validModel =
        taskModel && resolved.supported_models.includes(taskModel)
          ? taskModel
          : "";
      setSelectedModel(validModel);
    }
  }, [agents, selectedAgentName, task.agent, task.model, projectInfo]);

  const currentAgent = agents.find((a) => a.name === selectedAgentName);

  const handleAgentSelect = useCallback(
    (name: string) => {
      const agent = agents.find((a) => a.name === name);
      if (!agent || !agent.installed) return;
      setSelectedAgentName(name);
      setError(null);
      setSelectedModel("");
    },
    [agents],
  );

  const canLaunch = useMemo(() => {
    if (launching) return false;
    if (!selectedAgentName) return false;
    return true;
  }, [launching, selectedAgentName]);

  const handleLaunch = useCallback(async () => {
    if (!canLaunch) return;
    setError(null);
    setLaunching(true);
    const taskLabel = "Creating worktree & launching agent";
    addBackgroundTask(taskLabel);
    try {
      await invoke("start_task_session", {
        projectId,
        taskId: task.id,
        agentName: selectedAgentName,
        model: selectedModel || null,
        createWorktree,
        baseBranch: baseBranch || null,
        userPrompt: userPrompt.trim() || null,
      });
      onLaunched();
    } catch (err) {
      setError(formatErrorWithHint(err, "agent-launch"));
    } finally {
      setLaunching(false);
      removeBackgroundTask(taskLabel);
    }
  }, [
    canLaunch,
    projectId,
    task.id,
    selectedAgentName,
    selectedModel,
    createWorktree,
    baseBranch,
    userPrompt,
    onLaunched,
    addBackgroundTask,
    removeBackgroundTask,
  ]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="min-w-[560px] max-w-[720px]"
      >
        <DialogHeader>
          <DialogTitle>Launch Task</DialogTitle>
          <DialogDescription className="truncate text-dim-foreground">
            {task.title}
          </DialogDescription>
        </DialogHeader>

        {/* Agent Cards */}
        <div>
          <label className="mb-1.5 block text-xs text-dim-foreground">
            Agent
          </label>
          <div className="grid grid-cols-3 gap-2">
            {agents.map((agent) => {
              const isSelected = selectedAgentName === agent.name;
              const color = getAgentColor(agent.name);
              const disabled = !agent.installed;
              return (
                <button
                  key={agent.name}
                  onClick={() => handleAgentSelect(agent.name)}
                  disabled={disabled}
                  className={`flex flex-col gap-1.5 rounded-[var(--radius-element)] px-3 py-2.5 text-left transition-all duration-150 border ${isSelected ? `${borderAccentColors[accentColor]} bg-accent` : "border-border bg-popover"} ${disabled ? "opacity-40 cursor-default" : "cursor-pointer"}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{ background: `${color}20` }}
                    >
                      <AgentIcon agent={agent.name} size={18} />
                    </span>
                    <span
                      className={`text-xs ${isSelected ? "font-medium" : "font-normal"} ${disabled ? "text-muted-foreground" : "text-foreground"}`}
                    >
                      {agent.display_name}
                    </span>
                  </div>
                  <div className="text-[11px] leading-snug text-muted-foreground">
                    {AGENT_DESCRIPTIONS[agent.name] ?? "AI coding agent"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Model */}
        {currentAgent && currentAgent.supported_models.length > 0 && (
          <div>
            <label className="mb-1 block text-xs text-dim-foreground">
              Model
            </label>
            <Select
              value={selectedModel || "__none__"}
              onValueChange={(v) =>
                setSelectedModel(!v || v === "__none__" ? "" : v)
              }
              items={[
                { value: "__none__", label: "Default" },
                ...currentAgent.supported_models.map((m) => ({
                  value: m,
                  label: `${m}${m === currentAgent.default_model ? " (default)" : ""}`,
                })),
              ]}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Default</SelectItem>
                {currentAgent.supported_models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                    {m === currentAgent.default_model ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Worktree toggle */}
        <div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-dim-foreground">
            <Checkbox
              checked={createWorktree}
              onCheckedChange={(checked) => setCreateWorktree(checked === true)}
            />
            Create worktree
          </label>
          <p className="mt-1 ml-6 text-[11px] text-muted-foreground">
            Isolates work in a separate git worktree with its own branch
          </p>
        </div>

        {/* Base branch (only when worktree enabled) */}
        {createWorktree && (
          <div>
            <label className="mb-1 block text-xs text-dim-foreground">
              Base branch
            </label>
            <BranchSelect
              projectId={projectId}
              currentBranch={null}
              mode="select"
              value={baseBranch}
              onChange={setBaseBranch}
              triggerVariant="select"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              The worktree branch will be created from this branch
            </p>
          </div>
        )}

        {/* Prompt */}
        <div>
          <label className="mb-1 block text-xs text-dim-foreground">
            Prompt
          </label>
          <Textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="Instructions for the agent..."
            rows={4}
            className="text-[13px]"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 ring-1 ring-destructive/20 px-3 py-2.5">
            <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive whitespace-pre-line">{error}</p>
          </div>
        )}

        {/* Actions */}
        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="outline"
                size="sm"
                leftIcon={<X className="size-3.5" />}
                hoverEffect="scale"
                clickEffect="scale"
              />
            }
          >
            Cancel
          </DialogClose>
          <Button
            variant="color"
            color={accentColor}
            size="sm"
            disabled={!canLaunch}
            loading={launching}
            onClick={handleLaunch}
            leftIcon={<Play className="size-3.5" />}
            hoverEffect="scale-glow"
            clickEffect="scale"
          >
            Launch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
