import { Check, ChevronDown } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { AgentIcon, getAgentColor } from "../../lib/agentIcons";
import { useAppStore } from "../../store/appStore";
import type { AgentInfo } from "../../types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { Button } from "../ui/button";
import {
  type ThemeColor,
  borderAccentColors,
} from "../ui/orecus.io/lib/color-utils";

/* ------------------------------------------------------------------ */

interface AgentModelPickerProps {
  selectedAgent: string;
  selectedModel: string; // "" = default
  onAgentChange: (name: string) => void;
  onModelChange: (model: string) => void;
  accentColor: ThemeColor;
  /** Optional filter for which agents to show (e.g. ACP-only for chat) */
  filter?: (agent: AgentInfo) => boolean;
  disabled?: boolean;
}

export default function AgentModelPicker({
  selectedAgent,
  selectedModel,
  onAgentChange,
  onModelChange,
  accentColor,
  filter,
  disabled,
}: AgentModelPickerProps) {
  const agents = useAppStore((s) => s.agents);

  const visibleAgents = useMemo(
    () => (filter ? agents.filter(filter) : agents),
    [agents, filter],
  );

  const currentAgent = agents.find((a) => a.name === selectedAgent);
  const hasModels =
    currentAgent && currentAgent.supported_models.length > 0;

  return (
    <div className="flex items-center gap-2 w-full">
      <AgentDropdown
        agents={visibleAgents}
        selectedAgent={selectedAgent}
        onSelect={onAgentChange}
        accentColor={accentColor}
        disabled={disabled}
      />
      {hasModels && (
        <ModelDropdown
          agent={currentAgent}
          selectedModel={selectedModel}
          onSelect={onModelChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent Dropdown                                                     */
/* ------------------------------------------------------------------ */

interface AgentDropdownProps {
  agents: AgentInfo[];
  selectedAgent: string;
  onSelect: (name: string) => void;
  accentColor: ThemeColor;
  disabled?: boolean;
}

function AgentDropdown({
  agents,
  selectedAgent,
  onSelect,
  accentColor,
  disabled,
}: AgentDropdownProps) {
  const [open, setOpen] = useState(false);

  const current = agents.find((a) => a.name === selectedAgent);
  const { installed, notInstalled } = useMemo(() => {
    const inst: AgentInfo[] = [];
    const notInst: AgentInfo[] = [];
    for (const a of agents) {
      if (a.installed) inst.push(a);
      else notInst.push(a);
    }
    return { installed: inst, notInstalled: notInst };
  }, [agents]);

  const handleSelect = useCallback(
    (name: string) => {
      onSelect(name);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={`h-8 gap-2 px-3 text-xs font-medium cursor-pointer flex-1 justify-start ${
              current
                ? `${borderAccentColors[accentColor]}`
                : ""
            }`}
            disabled={disabled}
          />
        }
      >
        {current && (
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded"
            style={{ background: `${getAgentColor(current.name)}20` }}
          >
            <AgentIcon agent={current.name} size={14} />
          </span>
        )}
        <span className="truncate">
          {current?.display_name ?? "Select agent"}
        </span>
        <span className="flex-1" />
        <ChevronDown size={12} className="text-muted-foreground shrink-0" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-56 p-1 gap-0"
      >
        {/* Installed group */}
        {installed.length > 0 && (
          <div>
            <div className="px-2 py-1.5 text-2xs font-medium text-muted-foreground uppercase tracking-wider">
              Installed
            </div>
            {installed.map((agent) => (
              <AgentRow
                key={agent.name}
                agent={agent}
                isSelected={agent.name === selectedAgent}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}

        {/* Not installed group */}
        {notInstalled.length > 0 && (
          <div>
            <div className="px-2 py-1.5 text-2xs font-medium text-muted-foreground uppercase tracking-wider">
              Not Installed
            </div>
            {notInstalled.map((agent) => (
              <AgentRow
                key={agent.name}
                agent={agent}
                isSelected={false}
                onSelect={handleSelect}
                disabled
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */

interface AgentRowProps {
  agent: AgentInfo;
  isSelected: boolean;
  onSelect: (name: string) => void;
  disabled?: boolean;
}

function AgentRow({ agent, isSelected, onSelect, disabled }: AgentRowProps) {
  const handleClick = useCallback(
    () => !disabled && onSelect(agent.name),
    [disabled, onSelect, agent.name],
  );

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors ${
        disabled
          ? "opacity-40 cursor-default"
          : isSelected
            ? "bg-accent text-foreground"
            : "text-dim-foreground hover:bg-accent/50 hover:text-foreground cursor-pointer"
      }`}
    >
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded"
        style={{ background: `${getAgentColor(agent.name)}20` }}
      >
        <AgentIcon agent={agent.name} size={14} />
      </span>
      <span className="text-xs truncate flex-1">{agent.display_name}</span>
      {agent.acp_installed && (
        <span className="text-2xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          ACP
        </span>
      )}
      {isSelected && <Check size={14} className="text-primary shrink-0" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Model Dropdown                                                     */
/* ------------------------------------------------------------------ */

interface ModelDropdownProps {
  agent: AgentInfo;
  selectedModel: string;
  onSelect: (model: string) => void;
  disabled?: boolean;
}

function ModelDropdown({
  agent,
  selectedModel,
  onSelect,
  disabled,
}: ModelDropdownProps) {
  const [open, setOpen] = useState(false);

  const displayLabel =
    !selectedModel || selectedModel === ""
      ? "Default"
      : selectedModel;

  const handleSelect = useCallback(
    (model: string) => {
      onSelect(model);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-3 text-xs font-medium cursor-pointer flex-1 justify-start"
            disabled={disabled}
          />
        }
      >
        <span className="truncate">{displayLabel}</span>
        <span className="flex-1" />
        <ChevronDown size={12} className="text-muted-foreground shrink-0" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-52 p-1 gap-0"
      >
        <div className="max-h-[240px] overflow-y-auto">
          {/* Default option */}
          <button
            onClick={() => handleSelect("")}
            className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
              selectedModel === ""
                ? "bg-accent text-foreground"
                : "text-dim-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            <span className="text-xs flex-1">Default</span>
            {selectedModel === "" && (
              <Check size={14} className="text-primary shrink-0" />
            )}
          </button>

          {/* Model list */}
          {agent.supported_models.map((m) => {
            const isDefault = m === agent.default_model;
            const isSelected = m === selectedModel;
            return (
              <button
                key={m}
                onClick={() => handleSelect(m)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-accent text-foreground"
                    : "text-dim-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <span className="text-xs truncate flex-1">
                  {m}
                  {isDefault && (
                    <span className="text-muted-foreground ml-1">(default)</span>
                  )}
                </span>
                {isSelected && (
                  <Check size={14} className="text-primary shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
