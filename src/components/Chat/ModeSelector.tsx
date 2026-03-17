import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { useAppStore } from "../../store/appStore";

// ── Component ──

interface ModeSelectorProps {
  sessionId: string;
  disabled?: boolean;
}

export default React.memo(function ModeSelector({
  sessionId,
  disabled,
}: ModeSelectorProps) {
  const configOptions = useAppStore(
    (s) => s.acpConfigOptions[sessionId],
  );
  const currentMode = useAppStore(
    (s) => s.acpModes[sessionId],
  );
  const setAcpMode = useAppStore((s) => s.setAcpMode);
  const [open, setOpen] = useState(false);

  // Find the mode config option (category === "mode")
  const modeOption = useMemo(
    () => configOptions?.find((o) => o.category === "mode"),
    [configOptions],
  );

  // Flatten all available modes
  const allModes = useMemo(() => {
    if (!modeOption) return [];
    const opts = modeOption.options ?? [];
    const grps = modeOption.groups ?? [];
    return opts.length > 0 ? opts : grps.flatMap((g) => g.options);
  }, [modeOption]);

  // Determine displayed mode
  const activeMode = currentMode ?? modeOption?.current_value ?? "";
  const activeModeLabel =
    allModes.find((m) => m.value === activeMode)?.name ?? activeMode;

  const handleSelectMode = useCallback(
    async (modeId: string) => {
      if (!modeOption || modeId === activeMode) {
        setOpen(false);
        return;
      }
      setAcpMode(sessionId, modeId);
      setOpen(false);
      try {
        await invoke("set_acp_config_option", {
          sessionId,
          configId: modeOption.id,
          value: modeId,
        });
      } catch (e) {
        console.error("Failed to set mode:", e);
        setAcpMode(sessionId, activeMode);
      }
    },
    [sessionId, modeOption, activeMode, setAcpMode],
  );

  // If no mode option from agent, don't render
  if (!modeOption) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex items-center gap-1 h-7 px-2 rounded text-[11px] font-medium text-dim-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50 cursor-pointer"
        disabled={disabled}
        title="Switch agent mode"
      >
        <span className="capitalize">{activeModeLabel}</span>
        <ChevronDown size={10} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-52 p-1 gap-0"
      >
        {modeOption.description && (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground border-b border-border/30 mb-1">
            {modeOption.description}
          </div>
        )}
        {allModes.map((mode) => {
          const isActive = mode.value === activeMode;
          return (
            <button
              key={mode.value}
              onClick={() => handleSelectMode(mode.value)}
              title={mode.description ?? mode.name}
              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                isActive
                  ? "bg-accent text-foreground"
                  : "text-dim-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <div className="flex flex-col gap-0 min-w-0 flex-1">
                <span className="text-xs capitalize">{mode.name}</span>
                {mode.description && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {mode.description}
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
