import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, SearchIcon } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import {
  ModelSelectorLogo,
  ModelSelectorName,
} from "@/components/ai-elements/model-selector";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAppStore } from "../../store/appStore";

import type { AcpConfigSelectOption } from "../../types";

// ── Agent name → logo provider slug ──

const AGENT_LOGO_SLUG: Record<string, string> = {
  "claude-code": "anthropic",
  codex: "openai",
  copilot: "github-copilot",
  cursor: "cursor",
  gemini: "google",
  opencode: "opencode",
};

const AGENT_DISPLAY_NAME: Record<string, string> = {
  "claude-code": "Anthropic",
  codex: "OpenAI",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  gemini: "Google",
  opencode: "OpenCode",
};

// ── Component ──

interface ModelSelectorProps {
  sessionId: string;
  disabled?: boolean;
}

export default React.memo(function ModelSelector({
  sessionId,
  disabled,
}: ModelSelectorProps) {
  const configOptions = useAppStore((s) => s.acpConfigOptions[sessionId]);
  const currentModel = useAppStore((s) => s.acpModels[sessionId]);
  const setAcpModel = useAppStore((s) => s.setAcpModel);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Find the model config option (category === "model") from ACP
  const modelOption = useMemo(
    () => configOptions?.find((o) => o.category === "model"),
    [configOptions],
  );

  // Look up the session's agent for logo display
  const session = useAppStore(
    (s) => s.sessions.find((sess) => sess.id === sessionId),
  );
  const logoSlug = session?.agent ? AGENT_LOGO_SLUG[session.agent] : undefined;
  const agentDisplayName = session?.agent
    ? AGENT_DISPLAY_NAME[session.agent] ?? session.agent
    : "Models";

  // If no model option from agent, don't render
  if (!modelOption) return null;

  // Build display groups — always show at least one group
  const groups = modelOption.groups ?? [];
  const options = modelOption.options ?? [];
  const displayGroups =
    groups.length > 0
      ? groups
      : [{ name: agentDisplayName, options }];
  const allModels: AcpConfigSelectOption[] =
    displayGroups.flatMap((g) => g.options);

  const activeModel = currentModel ?? modelOption.current_value;
  const activeModelData = allModels.find((m) => m.value === activeModel);
  const activeModelLabel = activeModelData?.name ?? activeModel;

  // Filter models by search query
  const query = search.toLowerCase();
  const filteredGroups = displayGroups
    .map((g) => ({
      ...g,
      options: g.options.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.value.toLowerCase().includes(query) ||
          (m.description?.toLowerCase().includes(query) ?? false),
      ),
    }))
    .filter((g) => g.options.length > 0);

  const handleSelect = async (modelValue: string) => {
    if (modelValue === activeModel) {
      setOpen(false);
      return;
    }
    setAcpModel(sessionId, modelValue);
    setOpen(false);
    setSearch("");
    try {
      await invoke("set_acp_config_option", {
        sessionId,
        configId: modelOption.id,
        value: modelValue,
      });
    } catch (e) {
      console.error("Failed to set model:", e);
      setAcpModel(sessionId, activeModel);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs font-medium text-dim-foreground hover:text-foreground cursor-pointer"
            disabled={disabled}
          />
        }
      >
        {logoSlug && (
          <ModelSelectorLogo provider={logoSlug} className="size-3" />
        )}
        <ModelSelectorName className="max-w-[140px] text-xs">
          {activeModelLabel}
        </ModelSelectorName>
        <ChevronDown size={10} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-72 p-0 gap-0"
      >
        {/* Search input */}
        {allModels.length > 4 && (
          <div className="p-1.5 pb-0">
            <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-2 py-1">
              <SearchIcon size={13} className="text-muted-foreground shrink-0" />
              <input
                type="text"
                placeholder="Search models..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                autoFocus
              />
            </div>
          </div>
        )}

        {/* Model list */}
        <div className="p-1 max-h-[280px] overflow-y-auto">
          {filteredGroups.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              No models found.
            </div>
          ) : (
            filteredGroups.map((group) => (
              <div key={group.name}>
                <div className="px-2 py-1.5 text-2xs font-medium text-muted-foreground uppercase tracking-wider">
                  {group.name}
                </div>
                {group.options.map((model) => (
                  <ModelItem
                    key={model.value}
                    model={model}
                    activeModel={activeModel}
                    logoSlug={logoSlug}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});

// ── Model Item ──

interface ModelItemProps {
  model: AcpConfigSelectOption;
  activeModel: string;
  logoSlug?: string;
  onSelect: (value: string) => void;
}

const ModelItem = React.memo(function ModelItem({
  model,
  activeModel,
  logoSlug,
  onSelect,
}: ModelItemProps) {
  const handleSelect = useCallback(
    () => onSelect(model.value),
    [onSelect, model.value],
  );
  const isActive = model.value === activeModel;

  return (
    <button
      onClick={handleSelect}
      title={model.description ?? model.name}
      className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
        isActive
          ? "bg-accent text-foreground"
          : "text-dim-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      {logoSlug && (
        <ModelSelectorLogo provider={logoSlug} className="size-3.5 shrink-0" />
      )}
      <div className="flex flex-col gap-0 min-w-0 flex-1">
        <span className="text-xs truncate">{model.name}</span>
        {model.description && (
          <span className="text-2xs text-muted-foreground truncate">
            {model.description}
          </span>
        )}
      </div>
      {isActive ? (
        <Check size={14} className="text-primary shrink-0" />
      ) : (
        <div className="size-3.5 shrink-0" />
      )}
    </button>
  );
});
