import { invoke } from "@tauri-apps/api/core";
import { FileText, Loader2, Plus, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { AgentIcon } from "../../lib/agentIcons";
import { formatError } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import type { AgentRuleGroup } from "../../types";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";
import { useTheme } from "../../contexts/ThemeContext";

/** Maps agent names to the default nested rule directories. */
const AGENT_RULE_DIRS: Record<string, { label: string; dir: string; ext: string }[]> = {
  "claude-code": [
    { label: ".claude/rules/", dir: ".claude/rules", ext: ".md" },
    { label: "~/.claude/rules/ (global)", dir: "~/.claude/rules", ext: ".md" },
  ],
  "cursor-agent": [
    { label: ".cursor/rules/", dir: ".cursor/rules", ext: ".mdc" },
  ],
};

interface Props {
  open: boolean;
  onClose: () => void;
  groups: AgentRuleGroup[];
  projectId: string;
  initialAgent?: string;
  onCreated: () => void;
}

export default function CreateRuleDialog({
  open,
  onClose,
  groups,
  projectId,
  initialAgent,
  onCreated,
}: Props) {
  const { isGlass } = useTheme();
  const [agentName, setAgentName] = useState(initialAgent ?? "");
  const [filename, setFilename] = useState("");
  const [dirIndex, setDirIndex] = useState(0);
  const [creating, setCreating] = useState(false);

  // Available agents that support nested rules
  const availableAgents = useMemo(
    () => groups.filter((g) => g.installed && AGENT_RULE_DIRS[g.agentName]),
    [groups],
  );

  // Directories for selected agent
  const dirs = useMemo(
    () => AGENT_RULE_DIRS[agentName] ?? [],
    [agentName],
  );

  const selectedDir = dirs[dirIndex];

  // Auto-add extension if not present
  const resolvedFilename = useMemo(() => {
    if (!filename.trim() || !selectedDir) return "";
    const name = filename.trim();
    if (name.endsWith(selectedDir.ext)) return name;
    return `${name}${selectedDir.ext}`;
  }, [filename, selectedDir]);

  const handleCreate = useCallback(async () => {
    if (!agentName || !resolvedFilename || !selectedDir) return;

    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Creating rule file");
    setCreating(true);
    try {
      await invoke("create_rule_file", {
        projectId,
        agentName,
        filename: resolvedFilename,
        directory: selectedDir.dir,
        content: null,
      });
      onCreated();
      onClose();
      // Reset form
      setFilename("");
      setDirIndex(0);
    } catch (e) {
      console.error("Failed to create rule file:", e);
      useAppStore.getState().flashError(`Failed to create: ${formatError(e)}`);
    } finally {
      setCreating(false);
      removeBackgroundTask("Creating rule file");
    }
  }, [agentName, resolvedFilename, selectedDir, projectId, onCreated, onClose]);

  // Reset agent when initialAgent changes
  if (initialAgent && initialAgent !== agentName) {
    setAgentName(initialAgent);
    setDirIndex(0);
    setFilename("");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className={`relative w-[420px] rounded-xl ring-1 ring-border/60 shadow-2xl ${glassStyles[isGlass ? "normal" : "solid"]}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Plus size={14} className="text-primary" />
            <span className="text-sm font-medium text-foreground">
              New Rule File
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Agent selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Agent
            </label>
            <div className="flex flex-wrap gap-1.5">
              {availableAgents.map((g) => (
                <button
                  key={g.agentName}
                  onClick={() => {
                    setAgentName(g.agentName);
                    setDirIndex(0);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    agentName === g.agentName
                      ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                      : "bg-accent/40 text-foreground hover:bg-accent/60"
                  }`}
                >
                  <AgentIcon agent={g.agentName} size={12} />
                  {g.displayName}
                </button>
              ))}
              {availableAgents.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No installed agents support nested rule directories.
                </p>
              )}
            </div>
          </div>

          {/* Directory selector */}
          {dirs.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Directory
              </label>
              <div className="flex flex-wrap gap-1.5">
                {dirs.map((d, i) => (
                  <button
                    key={d.dir}
                    onClick={() => setDirIndex(i)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors ${
                      dirIndex === i
                        ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                        : "bg-accent/40 text-foreground hover:bg-accent/60"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filename input */}
          {selectedDir && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Filename
              </label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent/30 ring-1 ring-border/30 focus-within:ring-primary/50 transition-colors">
                <FileText size={12} className="text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder={`my-rule${selectedDir.ext}`}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none font-mono"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && resolvedFilename) handleCreate();
                    if (e.key === "Escape") onClose();
                  }}
                />
              </div>
              {resolvedFilename && (
                <p className="text-[10px] text-muted-foreground font-mono">
                  {selectedDir.dir}/{resolvedFilename}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/40">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            hoverEffect="scale"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleCreate}
            disabled={!resolvedFilename || !agentName || creating}
            leftIcon={
              creating ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Plus size={13} />
              )
            }
            hoverEffect="scale"
            clickEffect="scale"
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
