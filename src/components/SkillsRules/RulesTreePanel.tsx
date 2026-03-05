import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Globe,
  Plus,
} from "lucide-react";
import React, { useCallback, useState } from "react";

import { AgentIcon } from "../../lib/agentIcons";
import type { AgentRuleGroup, RuleFileInfo } from "../../types";

interface Props {
  groups: AgentRuleGroup[];
  selectedPath: string | null;
  onSelect: (file: RuleFileInfo) => void;
  onCreateClick: (agentName: string) => void;
}

function RuleFileItem({
  file,
  isSelected,
  onSelect,
}: {
  file: RuleFileInfo;
  isSelected: boolean;
  onSelect: (file: RuleFileInfo) => void;
}) {
  return (
    <button
      onClick={() => onSelect(file)}
      className={`group flex items-center gap-1.5 w-full text-left px-2 py-1 rounded-md text-xs transition-colors ${
        isSelected
          ? "bg-primary/15 text-primary"
          : file.exists
            ? "text-foreground hover:bg-accent/60"
            : "text-muted-foreground hover:bg-accent/40"
      }`}
      title={file.relativePath}
    >
      <FileText size={12} className="shrink-0 opacity-60" />
      <span className="truncate flex-1">{file.displayName}</span>

      {/* Status indicators */}
      {file.deprecated && (
        <span title={file.deprecationHint ?? "Deprecated"}>
          <AlertTriangle size={11} className="shrink-0 text-warning" />
        </span>
      )}
      {file.scope === "global" && (
        <span title="Global rule file">
          <Globe size={10} className="shrink-0 text-muted-foreground opacity-60" />
        </span>
      )}
      {file.exists ? (
        <span className="size-1.5 rounded-full bg-success shrink-0" />
      ) : (
        <span className="size-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
      )}
    </button>
  );
}

function DirectoryGroup({
  label,
  files,
  selectedPath,
  onSelect,
}: {
  label: string;
  files: RuleFileInfo[];
  selectedPath: string | null;
  onSelect: (file: RuleFileInfo) => void;
}) {
  if (files.length === 0) return null;

  return (
    <div className="mt-0.5">
      <div className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        <FolderOpen size={10} className="opacity-50" />
        {label}
      </div>
      <div className="ml-1">
        {files.map((file) => (
          <RuleFileItem
            key={file.relativePath}
            file={file}
            isSelected={selectedPath === file.relativePath}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function AgentGroup({
  group,
  selectedPath,
  onSelect,
  onCreateClick,
  defaultExpanded,
}: {
  group: AgentRuleGroup;
  selectedPath: string | null;
  onSelect: (file: RuleFileInfo) => void;
  onCreateClick: (agentName: string) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const totalRules =
    group.projectRules.filter((r) => r.exists).length +
    group.globalRules.filter((r) => r.exists).length;

  // Split project rules into primary/flat files and nested directory files
  const projectPrimary = group.projectRules.filter(
    (r) => r.category !== "nested",
  );
  const projectNested = group.projectRules.filter(
    (r) => r.category === "nested",
  );

  // Split global rules similarly
  const globalPrimary = group.globalRules.filter(
    (r) => r.category !== "nested",
  );
  const globalNested = group.globalRules.filter(
    (r) => r.category === "nested",
  );

  const handleToggle = useCallback(() => setExpanded((e) => !e), []);

  return (
    <div className="border-b border-border/20 last:border-b-0">
      {/* Agent header */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 w-full px-2.5 py-2 text-left hover:bg-accent/40 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-muted-foreground shrink-0" />
        )}
        <AgentIcon agent={group.agentName} size={14} />
        <span className="text-xs font-medium text-foreground flex-1 truncate">
          {group.displayName}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {totalRules}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="pb-1.5 px-1">
          {/* Project primary files */}
          <div className="ml-3">
            {projectPrimary.map((file) => (
              <RuleFileItem
                key={file.relativePath}
                file={file}
                isSelected={selectedPath === file.relativePath}
                onSelect={onSelect}
              />
            ))}
          </div>

          {/* Project nested files */}
          {projectNested.length > 0 && (
            <div className="ml-3">
              <DirectoryGroup
                label={
                  projectNested[0]?.relativePath
                    .split("/")
                    .slice(0, -1)
                    .join("/") ?? "rules"
                }
                files={projectNested}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            </div>
          )}

          {/* Global section */}
          {(globalPrimary.length > 0 || globalNested.length > 0) && (
            <div className="ml-3 mt-1">
              <div className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <Globe size={10} className="opacity-50" />
                Global
              </div>
              <div className="ml-1">
                {globalPrimary.map((file) => (
                  <RuleFileItem
                    key={file.relativePath}
                    file={file}
                    isSelected={selectedPath === file.relativePath}
                    onSelect={onSelect}
                  />
                ))}
              </div>
              {globalNested.length > 0 && (
                <DirectoryGroup
                  label="rules"
                  files={globalNested}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                />
              )}
            </div>
          )}

          {/* Add rule button */}
          <button
            onClick={() => onCreateClick(group.agentName)}
            className="flex items-center gap-1.5 ml-3 px-2 py-1 mt-0.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          >
            <Plus size={11} />
            Add rule
          </button>
        </div>
      )}
    </div>
  );
}

function RulesTreePanel({ groups, selectedPath, onSelect, onCreateClick }: Props) {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {groups.map((group) => (
        <AgentGroup
          key={group.agentName}
          group={group}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onCreateClick={onCreateClick}
          defaultExpanded={
            group.projectRules.some((r) => r.exists) ||
            group.globalRules.some((r) => r.exists)
          }
        />
      ))}

      {groups.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">
            No agents installed.
            <br />
            Install an agent to manage rule files.
          </p>
        </div>
      )}
    </div>
  );
}

export default React.memo(RulesTreePanel);
