import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { useAppStore } from "../../store/appStore";
import type { AgentRuleGroup, RuleFileInfo } from "../../types";
import { Skeleton } from "../ui/skeleton";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";
import SidePanel from "../ui/SidePanel";
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
      <div className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 flex ${glassStyles[isGlass ? "normal" : "solid"]}`}>
        {/* Left tree skeleton */}
        <div className="w-56 shrink-0 border-r border-border/40 p-3 space-y-3">
          {Array.from({ length: 3 }).map((_, gi) => (
            <div key={gi} className="space-y-2">
              <Skeleton className="h-3.5 w-24" />
              {Array.from({ length: 2 }).map((_, fi) => (
                <div key={fi} className="flex items-center gap-2 pl-3">
                  <Skeleton className="size-3 rounded-sm" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Right editor skeleton */}
        <div className="flex-1 p-4 space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 flex ${glassStyles[isGlass ? "normal" : "solid"]}`}
      >
        {/* Left: Tree panel */}
        <SidePanel side="left" width="narrow" className="bg-transparent backdrop-blur-none">
          <RulesTreePanel
            groups={filteredGroups}
            selectedPath={selectedRelPath}
            onSelect={handleSelect}
            onCreateClick={handleCreateClick}
          />
        </SidePanel>

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
