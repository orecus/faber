import { invoke } from "@tauri-apps/api/core";
import { Check, Settings2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { useAppStore } from "../../store/appStore";

import type { AcpConfigOption, AcpConfigSelectOption } from "../../types";

// ── Component ──

interface ConfigOptionsPopoverProps {
  sessionId: string;
  disabled?: boolean;
}

export default React.memo(function ConfigOptionsPopover({
  sessionId,
  disabled,
}: ConfigOptionsPopoverProps) {
  const rawConfigOptions = useAppStore(
    (s) => s.acpConfigOptions[sessionId],
  );

  // Known categories with dedicated selectors
  const KNOWN_CATEGORIES = new Set(["mode", "model", "thought_level"]);

  // Filter out known categories — they have dedicated selectors
  const configOptions = useMemo(() => {
    const filtered = rawConfigOptions?.filter((o) => !KNOWN_CATEGORIES.has(o.category ?? ""));
    // Log unhandled categories for discovery
    if (filtered) {
      for (const o of filtered) {
        if (o.category) {
          console.info(`[ACP] Unhandled config option category: "${o.category}" (id: "${o.id}", name: "${o.name}")`);
        }
      }
    }
    return filtered;
  }, [rawConfigOptions]);

  // Don't render if no config options available after filtering
  if (!configOptions || configOptions.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger
        className="flex items-center justify-center size-7 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50 cursor-pointer"
        disabled={disabled}
        title="Agent configuration"
      >
        <Settings2 size={13} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-72 p-0 gap-0"
      >
        <div className="px-3 py-2 border-b border-border/30">
          <span className="text-xs font-medium text-foreground">
            Configuration
          </span>
        </div>
        <div className="p-1 space-y-1 max-h-[320px] overflow-y-auto">
          {configOptions.map((opt) => (
            <ConfigOptionSection
              key={opt.id}
              option={opt}
              sessionId={sessionId}
              disabled={disabled}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});

// ── Config Option Section ──

interface ConfigOptionSectionProps {
  option: AcpConfigOption;
  sessionId: string;
  disabled?: boolean;
}

function ConfigOptionSection({ option, sessionId, disabled }: ConfigOptionSectionProps) {
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  const handleChange = useCallback(
    async (value: string) => {
      if (value === option.current_value) return;
      setPendingValue(value);
      try {
        await invoke("set_acp_config_option", {
          sessionId,
          configId: option.id,
          value,
        });
      } catch (e) {
        console.error("Failed to set config option:", e);
      } finally {
        setPendingValue(null);
      }
    },
    [sessionId, option.id, option.current_value],
  );

  // Flatten groups into a single list
  const opts = option.options ?? [];
  const grps = option.groups ?? [];
  const allOptions: AcpConfigSelectOption[] =
    opts.length > 0
      ? opts
      : grps.flatMap((g) => g.options);

  const activeValue = pendingValue ?? option.current_value;

  return (
    <div>
      {/* Section header */}
      <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        {option.name}
      </div>
      {option.description && (
        <p className="px-2 pb-1 text-[10px] text-muted-foreground/70 leading-tight">
          {option.description}
        </p>
      )}

      {/* Options */}
      {grps.length > 0
        ? grps.map((group) => (
            <div key={group.name}>
              <div className="px-2 py-1 text-[10px] text-muted-foreground/60">
                {group.name}
              </div>
              {group.options.map((o) => (
                <OptionButton
                  key={o.value}
                  option={o}
                  isActive={o.value === activeValue}
                  disabled={disabled}
                  onSelect={handleChange}
                />
              ))}
            </div>
          ))
        : allOptions.map((o) => (
            <OptionButton
              key={o.value}
              option={o}
              isActive={o.value === activeValue}
              disabled={disabled}
              onSelect={handleChange}
            />
          ))}
    </div>
  );
}

// ── Option Button ──

interface OptionButtonProps {
  option: AcpConfigSelectOption;
  isActive: boolean;
  disabled?: boolean;
  onSelect: (value: string) => void;
}

function OptionButton({ option, isActive, disabled, onSelect }: OptionButtonProps) {
  return (
    <button
      onClick={() => onSelect(option.value)}
      disabled={disabled}
      title={option.description ?? option.name}
      className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
        isActive
          ? "bg-accent text-foreground"
          : "text-dim-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <div className="flex flex-col gap-0 min-w-0 flex-1">
        <span className="text-xs">{option.name}</span>
        {option.description && (
          <span className="text-[10px] text-muted-foreground truncate">
            {option.description}
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
}
