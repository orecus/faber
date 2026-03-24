import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, MessageSquare, Terminal, Ungroup, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { SessionTransport } from "../../types";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";

import { formatErrorWithHint } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
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
import { colorStyles, solidColorGradients } from "../ui/orecus.io/lib/color-utils";
import AgentCardGrid from "./AgentCardGrid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";

import type { Task } from "../../types";

interface LaunchBreakdownDialogProps {
  task: Task;
  projectId: string;
  onLaunched: () => void;
  onDismiss: () => void;
}

export default function LaunchBreakdownDialog({
  task,
  projectId,
  onLaunched,
  onDismiss,
}: LaunchBreakdownDialogProps) {
  const accentColor = useProjectAccentColor();
  const agents = useAppStore((s) => s.agents);
  const projectInfo = useAppStore((s) => s.projectInfo);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);
  const getSessionPrompt = useAppStore((s) => s.getSessionPrompt);

  // Resolve default prompt from template, with client-side {{task_id}} interpolation
  const defaultPrompt = useMemo(() => {
    const template = getSessionPrompt("breakdown");
    if (template) {
      return template.prompt.replace(/\{\{task_id\}\}/g, task.id);
    }
    return `Epic ${task.id} needs to be broken down into concrete child tasks. Start by using the \`get_task\` MCP tool to fetch the epic details. Analyze the epic's scope and body, then decompose it into smaller, actionable child tasks using the \`create_task\` MCP tool — make sure to set \`epic_id\` to "${task.id}" for each child task. Present the breakdown plan to the user before creating tasks.`;
  }, [getSessionPrompt, task.id]);

  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [defaultTransport, setDefaultTransport] = useState<SessionTransport>("pty");
  const [selectedTransport, setSelectedTransport] = useState<SessionTransport>("pty");
  const [userPrompt, setUserPrompt] = useState(defaultPrompt);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

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

  // Resolve default agent: task.agent -> project.default_agent -> first installed
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
      // Use project default if agent supports it, otherwise fall back to PTY
      setSelectedTransport(agent.acp_installed ? defaultTransport : "pty");
    },
    [agents, defaultTransport],
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
    const taskLabel = "Launching breakdown session";
    addBackgroundTask(taskLabel);
    try {
      await invoke("start_breakdown_session", {
        projectId,
        taskId: task.id,
        agentName: selectedAgentName,
        model: selectedModel || null,
        userPrompt: userPrompt.trim() || null,
        transport: selectedTransport,
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
    selectedTransport,
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
          <DialogTitle className="flex items-center gap-2">
            <Ungroup className="size-4 text-primary" />
            Breakdown Epic
          </DialogTitle>
          <DialogDescription className="truncate text-dim-foreground">
            {task.title}
          </DialogDescription>
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
            <p className="mt-1 text-[11px] text-muted-foreground">
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

        {/* Prompt */}
        <div>
          <label className="mb-1 block text-xs text-dim-foreground">
            Prompt
          </label>
          <Textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="How should this epic be broken down?"
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
            leftIcon={<Ungroup className="size-3.5" />}
            hoverEffect="scale-glow"
            clickEffect="scale"
          >
            Breakdown
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
