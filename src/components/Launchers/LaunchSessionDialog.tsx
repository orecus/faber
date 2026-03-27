import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, MessageSquare, Play, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { SessionTransport } from "../../types";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { formatErrorWithHint } from "../../lib/errorMessages";
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
import { colorStyles, solidColorGradients } from "../ui/orecus.io/lib/color-utils";
import BranchSelect from "../ui/BranchSelect";
import AgentCardGrid from "./AgentCardGrid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";


interface LaunchSessionDialogProps {
  projectId: string;
  onSessionStarted: () => void;
  onDismiss: () => void;
}

export default function LaunchSessionDialog({
  projectId,
  onSessionStarted,
  onDismiss,
}: LaunchSessionDialogProps) {
  const accentColor = useProjectAccentColor();
  const agents = useAppStore((s) => s.agents);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);
  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [defaultTransport, setDefaultTransport] = useState<SessionTransport>("pty");
  const [selectedTransport, setSelectedTransport] = useState<SessionTransport>("pty");
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [createWorktree, setCreateWorktree] = useState(false);
  const [userPrompt, setUserPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Load default transport from project settings
  useEffect(() => {
    invoke<string | null>("get_project_setting", {
      projectId,
      key: "default_transport",
    })
      .then((val) => {
        const t = (val as SessionTransport) || "pty";
        setDefaultTransport(t);
        setSelectedTransport(t);
      })
      .catch(() => {});
  }, [projectId]);

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

  const currentAgent = agents.find((a) => a.name === selectedAgentName);

  const handleAgentSelect = useCallback(
    (name: string) => {
      const agent = agents.find((a) => a.name === name);
      if (!agent || !agent.installed) return;
      setSelectedAgentName(name);
      setError(null);
      setSelectedModel("");
      // Use project default if agent supports it, otherwise fall back to PTY
      setSelectedTransport(agent.acp_installed ? defaultTransport : "pty");
    },
    [agents, defaultTransport],
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
        transport: selectedTransport,
      });
      onSessionStarted();
    } catch (err) {
      setError(formatErrorWithHint(err, "agent-launch"));
    } finally {
      setStarting(false);
      removeBackgroundTask(taskLabel);
    }
  }, [
    canStart,
    projectId,
    selectedAgentName,
    selectedModel,
    selectedTransport,
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

        {/* Transport toggle — only when agent supports ACP */}
        {currentAgent?.acp_installed && (
          <div>
            <label className="mb-1.5 block text-xs text-dim-foreground">
              Transport
            </label>
            <div className="flex rounded-[var(--radius-element)] bg-muted/50 p-0.5 ring-1 ring-border/40">
              <button
                type="button"
                onClick={() => setSelectedTransport("pty")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-element)-2px)] px-3 py-1.5 text-xs transition-all duration-150 ${
                  selectedTransport === "pty"
                    ? `bg-linear-to-r ${solidColorGradients[accentColor]} ${colorStyles[accentColor].text} shadow-sm font-medium`
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Terminal size={13} />
                Terminal
              </button>
              <button
                type="button"
                onClick={() => setSelectedTransport("acp")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-element)-2px)] px-3 py-1.5 text-xs transition-all duration-150 ${
                  selectedTransport === "acp"
                    ? `bg-linear-to-r ${solidColorGradients[accentColor]} ${colorStyles[accentColor].text} shadow-sm font-medium`
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MessageSquare size={13} />
                Chat
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedTransport === "acp"
                ? "Structured chat UI with tool calls and permission management"
                : "Classic terminal session with PTY output"}
            </p>
          </div>
        )}

        {/* Agent Cards */}
        <div>
          <label className="mb-1.5 block text-xs text-dim-foreground">
            Agent
          </label>
          <AgentCardGrid
            selectedAgentName={selectedAgentName}
            onSelect={handleAgentSelect}
            accentColor={accentColor}
          />
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
          <label className="flex cursor-pointer items-center gap-2 text-sm text-dim-foreground">
            <Checkbox
              checked={createWorktree}
              onCheckedChange={(checked) => setCreateWorktree(checked === true)}
            />
            Create worktree
          </label>
          <p className="mt-1 ml-6 text-xs text-muted-foreground">
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
              value={selectedBranch}
              onChange={setSelectedBranch}
              triggerVariant="select"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The worktree branch will be created from this branch
            </p>
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
            className="text-sm"
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
