import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Info,
  MessageSquare,
  Network,
  Play,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";

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
import { borderAccentColors, colorStyles, solidColorGradients } from "../ui/orecus.io/lib/color-utils";
import AgentCardGrid from "./AgentCardGrid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

import type { BranchingStrategy, SessionTransport, Task } from "../../types";

interface LaunchQueueDialogProps {
  projectId: string;
  readyTasks: Task[];
  onStarted: () => void;
  onDismiss: () => void;
  /** Pre-select tasks belonging to this epic */
  epicId?: string | null;
}

import { DEFAULT_PRIORITIES, getPriorityBadgeClass } from "../../lib/priorities";

export default function LaunchQueueDialog({
  projectId,
  readyTasks,
  onStarted,
  onDismiss,
  epicId,
}: LaunchQueueDialogProps) {
  const accentColor = useProjectAccentColor();
  const priorities = useAppStore((s) =>
    projectId ? (s.projectPriorities[projectId] ?? DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES
  );
  const agents = useAppStore((s) => s.agents);
  const projectInfo = useAppStore((s) => s.projectInfo);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

  // Task queue state: ordered list of task IDs with selection
  // When epicId is provided, pre-select only tasks belonging to that epic
  const [orderedTasks, setOrderedTasks] = useState<
    { task: Task; selected: boolean }[]
  >(() => readyTasks.map((t) => ({
    task: t,
    selected: epicId ? t.epic_id === epicId : true,
  })));

  const [strategy, setStrategy] = useState<BranchingStrategy>("independent");
  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [defaultTransport, setDefaultTransport] = useState<SessionTransport>("pty");
  const [selectedTransport, setSelectedTransport] = useState<SessionTransport>("pty");
  const [baseBranch, setBaseBranch] = useState<string>("");
  const [branches, setBranches] = useState<string[]>([]);
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

  // Resolve default agent
  useEffect(() => {
    if (agents.length === 0 || selectedAgentName) return;
    const defaultAgentName = projectInfo?.project.default_agent ?? null;
    const target = defaultAgentName
      ? agents.find((a) => a.name === defaultAgentName && a.installed)
      : null;
    const resolved = target ?? agents.find((a) => a.installed) ?? agents[0];
    if (resolved) {
      setSelectedAgentName(resolved.name);
      setSelectedModel("");
    }
  }, [agents, selectedAgentName, projectInfo]);

  useEffect(() => {
    invoke<string[]>("list_branches", { projectId })
      .then(setBranches)
      .catch(() => {});
  }, [projectId]);

  const currentAgent = agents.find((a) => a.name === selectedAgentName);

  const selectedTaskIds = useMemo(
    () => orderedTasks.filter((t) => t.selected).map((t) => t.task.id),
    [orderedTasks],
  );

  // ── Dependency validation via backend ──
  interface DepAnalysis {
    sortedIds: string[];
    hasDeps: boolean;
    depCount: number;
    isChain: boolean;
    suggestion: BranchingStrategy | null;
    reason: string;
  }
  const [depAnalysis, setDepAnalysis] = useState<DepAnalysis | null>(null);
  const [depError, setDepError] = useState<string | null>(null);

  // Call backend validation whenever the selected task set changes
  useEffect(() => {
    if (selectedTaskIds.length < 2) {
      setDepAnalysis(null);
      setDepError(null);
      return;
    }
    let cancelled = false;
    invoke<DepAnalysis>("validate_queue_deps", {
      projectId,
      taskIds: selectedTaskIds,
    })
      .then((result) => {
        if (cancelled) return;
        setDepAnalysis(result);
        setDepError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDepAnalysis(null);
        setDepError(typeof err === "string" ? err : String(err));
      });
    return () => { cancelled = true; };
  }, [projectId, selectedTaskIds]);

  // Auto-apply suggestion on first valid result
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  useEffect(() => {
    if (suggestionApplied || !depAnalysis?.hasDeps) return;
    if (depAnalysis.suggestion) {
      setStrategy(depAnalysis.suggestion);
    }
    // Reorder tasks to match dependency-sorted order
    setOrderedTasks((prev) => {
      const idToItem = new Map(prev.map((item) => [item.task.id, item]));
      const reordered: typeof prev = [];
      for (const id of depAnalysis.sortedIds) {
        const item = idToItem.get(id);
        if (item) reordered.push(item);
      }
      // Append unselected tasks not in the sorted list
      for (const item of prev) {
        if (!depAnalysis.sortedIds.includes(item.task.id)) {
          reordered.push(item);
        }
      }
      return reordered;
    });
    setSuggestionApplied(true);
  }, [depAnalysis, suggestionApplied]);

  const handleAgentSelect = useCallback(
    (name: string) => {
      const agent = agents.find((a) => a.name === name);
      if (!agent || !agent.installed) return;
      setSelectedAgentName(name);
      setError(null);
      setSelectedModel("");
      setSelectedTransport(agent.acp_installed ? defaultTransport : "pty");
    },
    [agents, defaultTransport],
  );

  const handleToggleTask = useCallback((index: number) => {
    setOrderedTasks((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, selected: !item.selected } : item,
      ),
    );
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setOrderedTasks((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setOrderedTasks((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  // ── Compute DAG execution phases ──
  const dagPhases = useMemo(() => {
    if (strategy !== "dag" || selectedTaskIds.length < 2) return null;
    const selectedSet = new Set(selectedTaskIds);
    const taskMap = new Map(orderedTasks.map((item) => [item.task.id, item.task]));

    // Build in-queue dependency map
    const inDeps = new Map<string, string[]>();
    for (const id of selectedTaskIds) {
      const task = taskMap.get(id);
      if (!task) continue;
      inDeps.set(id, task.depends_on.filter((d) => selectedSet.has(d)));
    }

    // Kahn's algorithm for phase grouping
    const phases: string[][] = [];
    const remaining = new Set(selectedTaskIds);
    const completed = new Set<string>();

    while (remaining.size > 0) {
      const phase: string[] = [];
      for (const id of remaining) {
        const deps = inDeps.get(id) ?? [];
        if (deps.every((d) => completed.has(d))) {
          phase.push(id);
        }
      }
      if (phase.length === 0) break; // cycle — shouldn't happen with validated deps
      for (const id of phase) {
        remaining.delete(id);
        completed.add(id);
      }
      phases.push(phase);
    }
    return phases;
  }, [strategy, selectedTaskIds, orderedTasks]);

  const canStart = useMemo(() => {
    if (starting) return false;
    if (!selectedAgentName) return false;
    if (selectedTaskIds.length < 2) return false;
    if (depError) return false;
    return true;
  }, [starting, selectedAgentName, selectedTaskIds.length, depError]);

  const handleStart = useCallback(async () => {
    if (!canStart) return;
    setError(null);
    setStarting(true);
    const taskLabel = "Starting queue mode";
    addBackgroundTask(taskLabel);
    try {
      await invoke("start_queue_mode", {
        projectId,
        taskIds: selectedTaskIds,
        strategy,
        baseBranch: baseBranch || null,
        agentName: selectedAgentName || null,
        model: selectedModel || null,
        transport: selectedTransport,
      });
      onStarted();
    } catch (err) {
      setError(formatErrorWithHint(err, "agent-launch"));
    } finally {
      setStarting(false);
      removeBackgroundTask(taskLabel);
    }
  }, [
    canStart,
    projectId,
    selectedTaskIds,
    strategy,
    baseBranch,
    selectedAgentName,
    selectedModel,
    selectedTransport,
    onStarted,
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
        className="min-w-[1080px] max-w-[1280px]"
      >
        <DialogHeader>
          <DialogTitle>Queue Mode</DialogTitle>
          <DialogDescription className="text-dim-foreground">
            Launch tasks in parallel or with dependency-aware orchestration
          </DialogDescription>
        </DialogHeader>

        {/* ── Two-column layout ── */}
        <div className="grid grid-cols-[1fr_340px] gap-5 min-h-0">

          {/* ── Left column: Strategy & Task Queue ── */}
          <div className="flex flex-col gap-3 min-h-0 overflow-y-auto max-h-[525px] pr-1">
            {/* Branching Strategy */}
            <div>
              <label className="mb-1.5 block text-xs text-dim-foreground">
                Strategy
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setStrategy("independent")}
                  className={`flex items-start gap-2 rounded-[var(--radius-element)] px-2.5 py-2 text-left transition-all duration-150 border ${
                    strategy === "independent"
                      ? `${borderAccentColors[accentColor]} bg-accent`
                      : "border-border bg-popover"
                  } cursor-pointer`}
                >
                  <GitBranch className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                  <div>
                    <span
                      className={`text-xs ${strategy === "independent" ? "font-medium text-foreground" : "text-foreground"}`}
                    >
                      Independent
                    </span>
                    <div className="text-2xs leading-snug text-muted-foreground mt-0.5">
                      All parallel from base. No auto-merge.
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setStrategy("dag")}
                  className={`flex items-start gap-2 rounded-[var(--radius-element)] px-2.5 py-2 text-left transition-all duration-150 border ${
                    strategy === "dag"
                      ? `${borderAccentColors[accentColor]} bg-accent`
                      : "border-border bg-popover"
                  } cursor-pointer`}
                >
                  <Network className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                  <div>
                    <span
                      className={`text-xs ${strategy === "dag" ? "font-medium text-foreground" : "text-foreground"}`}
                    >
                      Orchestrated
                    </span>
                    <div className="text-2xs leading-snug text-muted-foreground mt-0.5">
                      Dependency-aware with auto-merge
                    </div>
                  </div>
                </button>
              </div>
              {depError && (
                <div className="mt-1.5 flex items-start gap-1.5 text-xs">
                  <AlertTriangle className="size-3 shrink-0 mt-0.5 text-destructive" />
                  <span className="text-destructive">{depError}</span>
                </div>
              )}
              {depAnalysis?.hasDeps && !depError && (
                <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="size-3 shrink-0 mt-0.5 text-primary" />
                  <span>
                    {depAnalysis.reason}
                    {depAnalysis.suggestion &&
                      strategy !== depAnalysis.suggestion && (
                        <>
                          {" — "}
                          <button
                            onClick={() => setStrategy(depAnalysis.suggestion!)}
                            className="text-primary hover:underline"
                          >
                            Use {depAnalysis.suggestion === "dag" ? "orchestrated" : depAnalysis.suggestion}?
                          </button>
                        </>
                      )}
                    {strategy === "dag" && (
                      <span className="text-success"> (auto-sorted by dependencies)</span>
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* Unified Task Queue / Execution Plan */}
            <div className="flex-1 min-h-0">
              <label className="mb-1.5 block text-xs text-dim-foreground">
                {strategy === "dag" && dagPhases && dagPhases.length > 1
                  ? `Execution Plan — ${dagPhases.length} phases (${selectedTaskIds.length} tasks)`
                  : `Task Queue (${selectedTaskIds.length} selected)`
                }
              </label>
              <div className="flex flex-col gap-0 rounded-[var(--radius-element)] border border-border bg-popover p-1.5 max-h-[380px] overflow-y-auto">
                {strategy === "dag" && dagPhases && dagPhases.length > 0 ? (
                  /* ── Orchestrated: vertical phases ── */
                  dagPhases.map((phase, phaseIdx) => {
                    const taskMap = new Map(orderedTasks.map((item) => [item.task.id, item]));
                    return (
                      <div key={phaseIdx}>
                        {/* Phase header */}
                        <div className={`flex items-center gap-1.5 px-2 py-1.5 ${phaseIdx > 0 ? "mt-1 border-t border-border/50" : ""}`}>
                          <span className={`flex items-center justify-center size-5 rounded-full text-2xs font-bold shrink-0 ${
                            phaseIdx === 0 ? "bg-primary text-primary-foreground" : "bg-accent text-dim-foreground"
                          }`}>
                            {phaseIdx + 1}
                          </span>
                          <span className="text-xs font-medium text-foreground">
                            Phase {phaseIdx + 1}
                          </span>
                          {phase.length > 1 && (
                            <span className="text-2xs text-primary font-medium">
                              {phase.length} parallel
                            </span>
                          )}
                        </div>
                        {/* Phase tasks */}
                        <div className="flex flex-col gap-0.5 ml-[9px] pl-2.5 border-l-2 border-border pb-1">
                          {phase.map((id) => {
                            const entry = taskMap.get(id);
                            if (!entry) return null;
                            const item = entry;
                            const globalIndex = orderedTasks.findIndex((t) => t.task.id === id);
                            return (
                              <div
                                key={id}
                                className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                                  item.selected ? "bg-accent/50" : "opacity-50"
                                }`}
                              >
                                <Checkbox
                                  checked={item.selected}
                                  onCheckedChange={() => handleToggleTask(globalIndex)}
                                />
                                <span className="text-xs text-foreground truncate flex-1">
                                  {item.task.title}
                                  {item.task.depends_on.length > 0 && (
                                    <span
                                      className="ml-1 text-2xs text-muted-foreground"
                                      title={`Depends on: ${item.task.depends_on.join(", ")}`}
                                    >
                                      (deps: {item.task.depends_on.filter((d) => orderedTasks.some((t) => t.task.id === d)).length})
                                    </span>
                                  )}
                                </span>
                                {item.task.agent && item.task.agent !== selectedAgentName && (
                                  <span
                                    className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium bg-primary/15 text-primary"
                                    title={`This task will use ${item.task.agent} instead of ${selectedAgentName}`}
                                  >
                                    {item.task.agent}
                                  </span>
                                )}
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium ${getPriorityBadgeClass(item.task.priority, priorities)}`}
                                >
                                  {item.task.priority}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  /* ── Independent: flat reorderable list ── */
                  <div className="flex flex-col gap-0.5">
                    {orderedTasks.map((item, index) => {
                      const selectedIndex = orderedTasks
                        .slice(0, index + 1)
                        .filter((t) => t.selected).length;
                      return (
                        <div
                          key={item.task.id}
                          className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                            item.selected ? "bg-accent/50" : "opacity-50"
                          }`}
                        >
                          <Checkbox
                            checked={item.selected}
                            onCheckedChange={() => handleToggleTask(index)}
                          />
                          <span className="text-xs tabular-nums text-muted-foreground w-4 text-center shrink-0">
                            {item.selected ? selectedIndex : "-"}
                          </span>
                          <span className="text-xs text-foreground truncate flex-1">
                            {item.task.title}
                            {item.task.depends_on.length > 0 && (
                              <span
                                className="ml-1 text-2xs text-muted-foreground"
                                title={`Depends on: ${item.task.depends_on.join(", ")}`}
                              >
                                (deps: {item.task.depends_on.filter((d) => orderedTasks.some((t) => t.task.id === d)).length})
                              </span>
                            )}
                          </span>
                          {item.task.agent && item.task.agent !== selectedAgentName && (
                            <span
                              className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium bg-primary/15 text-primary"
                              title={`This task will use ${item.task.agent} instead of ${selectedAgentName}`}
                            >
                              {item.task.agent}
                            </span>
                          )}
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium ${getPriorityBadgeClass(item.task.priority, priorities)}`}
                          >
                            {item.task.priority}
                          </span>
                          <div className="flex shrink-0">
                            <button
                              onClick={() => handleMoveUp(index)}
                              disabled={index === 0}
                              title="Move up"
                              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
                            >
                              <ChevronUp className="size-3" />
                            </button>
                            <button
                              onClick={() => handleMoveDown(index)}
                              disabled={index === orderedTasks.length - 1}
                              title="Move down"
                              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default"
                            >
                              <ChevronDown className="size-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {selectedTaskIds.length < 2 && (
                <p className="mt-1 text-xs text-warning">
                  Select at least 2 tasks to start queue mode
                </p>
              )}
            </div>
          </div>

          {/* ── Right column: Configuration ── */}
          <div className="flex flex-col gap-3 min-h-0 overflow-y-auto max-h-[525px] border-l border-border pl-5">
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
              <p className="mt-1.5 text-2xs text-muted-foreground">
                Per-task agents override this selection.
              </p>
            </div>

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
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-element)-2px)] px-2.5 py-1.5 text-xs transition-all duration-150 ${
                      selectedTransport === "pty"
                        ? `bg-linear-to-r ${solidColorGradients[accentColor]} ${colorStyles[accentColor].text} shadow-sm font-medium`
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Terminal size={12} />
                    Terminal
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedTransport("acp")}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-element)-2px)] px-2.5 py-1.5 text-xs transition-all duration-150 ${
                      selectedTransport === "acp"
                        ? `bg-linear-to-r ${solidColorGradients[accentColor]} ${colorStyles[accentColor].text} shadow-sm font-medium`
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <MessageSquare size={12} />
                    Chat
                  </button>
                </div>
              </div>
            )}

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

            {/* Base branch */}
            {branches.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-dim-foreground">
                  Base branch
                </label>
                <Select
                  value={baseBranch}
                  onValueChange={(v) => setBaseBranch(v as string)}
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
          </div>
        </div>

        {/* Error — full width below columns */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 ring-1 ring-destructive/20 px-3 py-2.5">
            <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive whitespace-pre-line">{error}</p>
          </div>
        )}

        {/* Actions — full width */}
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
            Start ({selectedTaskIds.length} tasks)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
