import { invoke } from "@tauri-apps/api/core";
import { Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { AgentIcon, getAgentColor } from "../../lib/agentIcons";
import { useAppStore } from "../../store/appStore";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { borderAccentColors } from "../ui/orecus.io/lib/color-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";
import { AGENT_DESCRIPTIONS } from "../../lib/agentDescriptions";

interface SessionLauncherProps {
  projectId: string;
  onSessionStarted: () => void;
  onDismiss: () => void;
}

export default function SessionLauncher({
  projectId,
  onSessionStarted,
  onDismiss,
}: SessionLauncherProps) {
  const accentColor = useProjectAccentColor();
  const agents = useAppStore((s) => s.agents);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);
  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [branches, setBranches] = useState<string[]>([]);
  const [createWorktree, setCreateWorktree] = useState(false);
  const [userPrompt, setUserPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Select first installed agent when agents load from context
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentName) {
      const first = agents.find((a) => a.installed) ?? agents[0];
      if (first) {
        setSelectedAgentName(first.name);
        setSelectedModel("");
      }
    }
  }, [agents, selectedAgentName]);

  useEffect(() => {
    invoke<string[]>("list_branches", { projectId })
      .then(setBranches)
      .catch(() => {});
  }, [projectId]);

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

  const canStart = useMemo(() => {
    if (starting) return false;
    if (!selectedAgentName) return false;
    return true;
  }, [starting, selectedAgentName]);

  const handleStart = useCallback(async () => {
    if (!canStart) return;
    setError(null);
    setStarting(true);
    const taskLabel = "Launching agent session";
    addBackgroundTask(taskLabel);
    try {
      await invoke("start_vibe_session", {
        projectId,
        agentName: selectedAgentName,
        model: selectedModel || null,
        createWorktree,
        baseBranch: selectedBranch || null,
        userPrompt: userPrompt.trim() || null,
      });
      onSessionStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
      removeBackgroundTask(taskLabel);
    }
  }, [
    canStart,
    projectId,
    selectedAgentName,
    selectedModel,
    createWorktree,
    selectedBranch,
    userPrompt,
    onSessionStarted,
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
        className="min-w-[480px] max-w-[620px]"
      >
        <DialogHeader>
          <DialogTitle>New Agent</DialogTitle>
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
        {createWorktree && branches.length > 0 && (
          <div>
            <label className="mb-1 block text-xs text-dim-foreground">
              Base branch
            </label>
            <Select
              value={selectedBranch}
              onValueChange={(v) => setSelectedBranch(v as string)}
              items={[
                { value: "", label: "Current HEAD" },
                ...branches.map((b) => ({ value: b, label: b })),
              ]}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Current HEAD" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Current HEAD</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Prompt */}
        <div>
          <label className="mb-1 block text-xs text-dim-foreground">
            Prompt (optional)
          </label>
          <Textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="What should the agent work on..."
            rows={3}
            className="text-[13px]"
          />
        </div>

        {/* Error */}
        {error && <p className="text-xs text-destructive">{error}</p>}

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
            disabled={!canStart}
            loading={starting}
            onClick={handleStart}
            leftIcon={<Play className="size-3.5" />}
            hoverEffect="scale-glow"
            clickEffect="scale"
          >
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
