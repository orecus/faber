import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Info,
  Link,
  Play,
  X,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

import type { BranchingStrategy, Task } from "../../types";

interface ContinuousModeDialogProps {
  projectId: string;
  readyTasks: Task[];
  onStarted: () => void;
  onDismiss: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-destructive/20 text-destructive",
  P1: "bg-warning/20 text-warning",
  P2: "bg-muted text-muted-foreground",
};

export default function ContinuousModeDialog({
  projectId,
  readyTasks,
  onStarted,
  onDismiss,
}: ContinuousModeDialogProps) {
  const accentColor = useProjectAccentColor();
  const agents = useAppStore((s) => s.agents);
  const projectInfo = useAppStore((s) => s.projectInfo);
  const addBackgroundTask = useAppStore((s) => s.addBackgroundTask);
  const removeBackgroundTask = useAppStore((s) => s.removeBackgroundTask);

  // Task queue state: ordered list of task IDs with selection
  const [orderedTasks, setOrderedTasks] = useState<
    { task: Task; selected: boolean }[]
  >(() => readyTasks.map((t) => ({ task: t, selected: true })));

  const [strategy, setStrategy] = useState<BranchingStrategy>("independent");
  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [baseBranch, setBaseBranch] = useState<string>("");
  const [branches, setBranches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

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

  // ── Dependency analysis for smart strategy suggestion ──
  const dependencyAnalysis = useMemo(() => {
    const selectedTasks = orderedTasks
      .filter((t) => t.selected)
      .map((t) => t.task);
    const selectedIds = new Set(selectedTasks.map((t) => t.id));

    // Build edges: task → tasks it depends on (within the selected set)
    const edges = new Map<string, string[]>();
    let totalDeps = 0;
    for (const task of selectedTasks) {
      const deps = task.depends_on.filter((d) => selectedIds.has(d));
      if (deps.length > 0) {
        edges.set(task.id, deps);
        totalDeps += deps.length;
      }
    }

    if (totalDeps === 0) {
      return { suggestion: null as BranchingStrategy | null, reason: "", hasDeps: false, sortedIds: null as string[] | null };
    }

    // Check if it forms a linear chain (each task depends on at most 1 other)
    const isLinear = [...edges.values()].every((deps) => deps.length <= 1);
    // Check that no task is depended on by more than one task
    const depCount = new Map<string, number>();
    for (const deps of edges.values()) {
      for (const d of deps) {
        depCount.set(d, (depCount.get(d) ?? 0) + 1);
      }
    }
    const isChain = isLinear && [...depCount.values()].every((c) => c <= 1);

    // Topological sort for dependency order
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    let hasCycle = false;

    const visit = (id: string) => {
      if (hasCycle || visited.has(id)) return;
      if (visiting.has(id)) { hasCycle = true; return; }
      visiting.add(id);
      for (const dep of edges.get(id) ?? []) {
        visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
      sorted.push(id);
    };

    for (const task of selectedTasks) {
      visit(task.id);
    }

    if (hasCycle) {
      return { suggestion: "independent" as BranchingStrategy, reason: "Circular dependencies detected", hasDeps: true, sortedIds: null };
    }

    if (isChain && totalDeps > 0) {
      return {
        suggestion: "chained" as BranchingStrategy,
        reason: `${totalDeps} dependency link${totalDeps > 1 ? "s" : ""} found — tasks build on each other`,
        hasDeps: true,
        sortedIds: sorted,
      };
    }

    return {
      suggestion: "chained" as BranchingStrategy,
      reason: `${totalDeps} dependency link${totalDeps > 1 ? "s" : ""} detected between selected tasks`,
      hasDeps: true,
      sortedIds: sorted,
    };
  }, [orderedTasks]);

  // Auto-apply suggestion on first render when dependencies exist
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  useEffect(() => {
    if (suggestionApplied || !dependencyAnalysis.hasDeps) return;
    if (dependencyAnalysis.suggestion) {
      setStrategy(dependencyAnalysis.suggestion);
    }
    if (dependencyAnalysis.sortedIds) {
      // Reorder tasks to match dependency order
      setOrderedTasks((prev) => {
        const idToItem = new Map(prev.map((item) => [item.task.id, item]));
        const sorted = dependencyAnalysis.sortedIds!;
        const reordered: typeof prev = [];
        for (const id of sorted) {
          const item = idToItem.get(id);
          if (item) reordered.push(item);
        }
        // Append any remaining tasks not in the sorted list
        for (const item of prev) {
          if (!sorted.includes(item.task.id)) {
            reordered.push(item);
          }
        }
        return reordered;
      });
    }
    setSuggestionApplied(true);
  }, [dependencyAnalysis, suggestionApplied]);

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

  const canStart = useMemo(() => {
    if (starting) return false;
    if (!selectedAgentName) return false;
    if (selectedTaskIds.length < 2) return false;
    return true;
  }, [starting, selectedAgentName, selectedTaskIds.length]);

  const handleStart = useCallback(async () => {
    if (!canStart) return;
    setError(null);
    setStarting(true);
    const taskLabel = "Starting continuous mode";
    addBackgroundTask(taskLabel);
    try {
      await invoke("start_continuous_mode", {
        projectId,
        taskIds: selectedTaskIds,
        strategy,
        baseBranch: baseBranch || null,
        agentName: selectedAgentName || null,
        model: selectedModel || null,
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
        className="min-w-[620px] max-w-[780px]"
      >
        <DialogHeader>
          <DialogTitle>Continuous Mode</DialogTitle>
          <DialogDescription className="text-dim-foreground">
            Queue tasks to run sequentially with automatic handoff
          </DialogDescription>
        </DialogHeader>

        {/* Task Queue */}
        <div>
          <label className="mb-1.5 block text-xs text-dim-foreground">
            Task Queue ({selectedTaskIds.length} selected)
          </label>
          <div className="flex flex-col gap-1 rounded-[var(--radius-element)] border border-border bg-popover p-1.5 max-h-[200px] overflow-y-auto">
            {orderedTasks.map((item, index) => {
              const selectedIndex = orderedTasks
                .slice(0, index + 1)
                .filter((t) => t.selected).length;
              return (
                <div
                  key={item.task.id}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                    item.selected
                      ? "bg-accent/50"
                      : "opacity-50"
                  }`}
                >
                  <Checkbox
                    checked={item.selected}
                    onCheckedChange={() => handleToggleTask(index)}
                  />
                  <span className="text-[11px] tabular-nums text-muted-foreground w-4 text-center shrink-0">
                    {item.selected ? selectedIndex : "-"}
                  </span>
                  <span className="text-xs text-foreground truncate flex-1">
                    {item.task.title}
                    {item.task.depends_on.length > 0 && (
                      <span
                        className="ml-1 text-[10px] text-muted-foreground"
                        title={`Depends on: ${item.task.depends_on.join(", ")}`}
                      >
                        (deps: {item.task.depends_on.filter((d) => orderedTasks.some((t) => t.task.id === d)).length})
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_COLORS[item.task.priority] ?? "bg-muted text-muted-foreground"}`}
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
          {selectedTaskIds.length < 2 && (
            <p className="mt-1 text-[11px] text-warning">
              Select at least 2 tasks to start continuous mode
            </p>
          )}
        </div>

        {/* Branching Strategy */}
        <div>
          <label className="mb-1.5 block text-xs text-dim-foreground">
            Branching Strategy
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setStrategy("independent")}
              className={`flex items-start gap-2.5 rounded-[var(--radius-element)] px-3 py-2.5 text-left transition-all duration-150 border ${
                strategy === "independent"
                  ? `${borderAccentColors[accentColor]} bg-accent`
                  : "border-border bg-popover"
              } cursor-pointer`}
            >
              <GitBranch className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
              <div>
                <span
                  className={`text-xs ${strategy === "independent" ? "font-medium text-foreground" : "text-foreground"}`}
                >
                  Independent
                </span>
                <div className="text-[11px] leading-snug text-muted-foreground mt-0.5">
                  Each task branches from base
                </div>
              </div>
            </button>
            <button
              onClick={() => setStrategy("chained")}
              className={`flex items-start gap-2.5 rounded-[var(--radius-element)] px-3 py-2.5 text-left transition-all duration-150 border ${
                strategy === "chained"
                  ? `${borderAccentColors[accentColor]} bg-accent`
                  : "border-border bg-popover"
              } cursor-pointer`}
            >
              <Link className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
              <div>
                <span
                  className={`text-xs ${strategy === "chained" ? "font-medium text-foreground" : "text-foreground"}`}
                >
                  Chained
                </span>
                <div className="text-[11px] leading-snug text-muted-foreground mt-0.5">
                  Each branches from the previous
                </div>
              </div>
            </button>
          </div>
          {dependencyAnalysis.hasDeps && (
            <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="size-3 shrink-0 mt-0.5 text-primary" />
              <span>
                {dependencyAnalysis.reason}
                {dependencyAnalysis.suggestion &&
                  strategy !== dependencyAnalysis.suggestion && (
                    <>
                      {" — "}
                      <button
                        onClick={() => setStrategy(dependencyAnalysis.suggestion!)}
                        className="text-primary hover:underline"
                      >
                        Use {dependencyAnalysis.suggestion}?
                      </button>
                    </>
                  )}
                {dependencyAnalysis.sortedIds &&
                  strategy === "chained" && (
                    <span className="text-success"> (auto-sorted by dependencies)</span>
                  )}
              </span>
            </div>
          )}
        </div>

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
            Start ({selectedTaskIds.length} tasks)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
