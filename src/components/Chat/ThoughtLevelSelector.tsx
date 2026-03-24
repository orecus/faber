import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, Zap } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { useAppStore } from "../../store/appStore";

// ── Component ──

interface ThoughtLevelSelectorProps {
  sessionId: string;
  disabled?: boolean;
}

export default React.memo(function ThoughtLevelSelector({
  sessionId,
  disabled,
}: ThoughtLevelSelectorProps) {
  const configOptions = useAppStore(
    (s) => s.acpConfigOptions[sessionId],
  );
  const [open, setOpen] = useState(false);

  // Find the thought_level config option
  const thoughtOption = useMemo(
    () => configOptions?.find((o) => o.category === "thought_level"),
    [configOptions],
  );

  // Flatten all available levels
  const allLevels = useMemo(() => {
    if (!thoughtOption) return [];
    const opts = thoughtOption.options ?? [];
    const grps = thoughtOption.groups ?? [];
    return opts.length > 0 ? opts : grps.flatMap((g) => g.options);
  }, [thoughtOption]);

  const activeValue = thoughtOption?.current_value ?? "";
  const activeLabel =
    allLevels.find((l) => l.value === activeValue)?.name ?? activeValue;

  const handleSelect = useCallback(
    async (value: string) => {
      if (!thoughtOption || value === activeValue) {
        setOpen(false);
        return;
      }
      setOpen(false);
      try {
        await invoke("set_acp_config_option", {
          sessionId,
          configId: thoughtOption.id,
          value,
        });
      } catch (e) {
        console.error("Failed to set thought level:", e);
      }
    },
    [sessionId, thoughtOption, activeValue],
  );

  // If no thought_level option from agent, don't render
  if (!thoughtOption) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex items-center gap-1 h-7 px-2 rounded text-[11px] font-medium text-dim-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50 cursor-pointer"
        disabled={disabled}
        title="Thinking level"
      >
        <Zap size={12} className="text-muted-foreground" />
        <span className="capitalize">{activeLabel}</span>
        <ChevronDown size={10} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-52 p-1 gap-0"
      >
        {thoughtOption.description && (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground border-b border-border/30 mb-1">
            {thoughtOption.description}
          </div>
        )}
        {allLevels.map((level) => {
          const isActive = level.value === activeValue;
          return (
            <button
              key={level.value}
              onClick={() => handleSelect(level.value)}
              title={level.description ?? level.name}
              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                isActive
                  ? "bg-accent text-foreground"
                  : "text-dim-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <div className="flex flex-col gap-0 min-w-0 flex-1">
                <span className="text-xs capitalize">{level.name}</span>
                {level.description && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {level.description}
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
        })}
      </PopoverContent>
    </Popover>
  );
});
