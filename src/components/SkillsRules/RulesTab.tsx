import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { useAppStore } from "../../store/appStore";
import type { AgentRuleGroup, RuleFileInfo } from "../../types";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";
import CreateRuleDialog from "./CreateRuleDialog";
import RuleEditor from "./RuleEditor";
import RulesTreePanel from "./RulesTreePanel";

interface Props {
  projectId: string;
}

export default function RulesTab({ projectId }: Props) {
  const { isGlass } = useTheme();
  const agents = useAppStore((s) => s.agents);

  const [groups, setGroups] = useState<AgentRuleGroup[]>([]);
  const [selectedRelPath, setSelectedRelPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogAgent, setCreateDialogAgent] = useState<string | undefined>();

  // Use a ref for auto-select so loadRuleFiles doesn't depend on selectedRelPath
  const selectedRelPathRef = useRef(selectedRelPath);
  selectedRelPathRef.current = selectedRelPath;

  // Filter to installed agents only
  const installedAgentNames = useMemo(
    () => new Set(agents.filter((a) => a.installed).map((a) => a.name)),
    [agents],
  );

  const filteredGroups = useMemo(
    () => groups.filter((g) => installedAgentNames.has(g.agentName)),
    [groups, installedAgentNames],
  );

  // Load rule files — only depends on projectId and installedAgentNames,
  // NOT on selectedRelPath (uses ref to avoid re-triggering on selection)
  const loadRuleFiles = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const result = await invoke<AgentRuleGroup[]>("list_rule_files", {
        projectId,
      });
      setGroups(result);

      // Auto-select first existing file if nothing selected
      if (!selectedRelPathRef.current) {
        for (const group of result) {
          if (!installedAgentNames.has(group.agentName)) continue;
          const firstExisting = [
            ...group.projectRules,
            ...group.globalRules,
          ].find((r) => r.exists);
          if (firstExisting) {
            setSelectedRelPath(firstExisting.relativePath);
            break;
          }
        }
      }
    } catch (e) {
      console.error("Failed to list rule files:", e);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [projectId, installedAgentNames]);

  // Initial load with spinner
  useEffect(() => {
    loadRuleFiles(true);
  }, [loadRuleFiles]);

  // Find currently selected file across all groups
  const selectedFile = useMemo(() => {
    if (!selectedRelPath) return null;
    for (const group of filteredGroups) {
      for (const file of [...group.projectRules, ...group.globalRules]) {
        if (file.relativePath === selectedRelPath) return file;
      }
    }
    return null;
  }, [selectedRelPath, filteredGroups]);

  const handleSelect = useCallback(
    (file: RuleFileInfo) => {
      setSelectedRelPath(file.relativePath);
    },
    [],
  );

  const handleCreateClick = useCallback((agentName: string) => {
    setCreateDialogAgent(agentName);
    setCreateDialogOpen(true);
  }, []);

  const handleCreated = useCallback(() => {
    loadRuleFiles(false);
  }, [loadRuleFiles]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div
        className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 flex ${glassStyles[isGlass ? "normal" : "solid"]}`}
      >
        {/* Left: Tree panel */}
        <div className="w-56 shrink-0 border-r border-border/40 overflow-hidden flex flex-col">
          <RulesTreePanel
            groups={filteredGroups}
            selectedPath={selectedRelPath}
            onSelect={handleSelect}
            onCreateClick={handleCreateClick}
          />
        </div>

        {/* Right: Editor panel */}
        <div className="flex-1 min-w-0 flex flex-col">
          <RuleEditor
            file={selectedFile}
            projectId={projectId}
            onFileCreated={handleCreated}
          />
        </div>
      </div>

      {/* Create rule dialog */}
      <CreateRuleDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        groups={filteredGroups}
        projectId={projectId}
        initialAgent={createDialogAgent}
        onCreated={handleCreated}
      />
    </>
  );
}
