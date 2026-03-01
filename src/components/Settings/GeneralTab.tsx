import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, ChevronDown, FolderOpen } from "lucide-react";

import { type Theme, useTheme } from "../../contexts/ThemeContext";
import { usePersistedBoolean } from "../../hooks/usePersistedState";

import { useUpdateStore } from "../../store/updateStore";
import { Checkbox } from "../ui/checkbox";
import { Card, CardContent } from "../ui/orecus.io/cards/card";
import { sectionHeadingClass, inputClass } from "./shared";

const COLOR_MODES: { value: "dark" | "light"; label: string; gradient: string }[] = [
  {
    value: "dark",
    label: "Dark",
    gradient: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
  },
  {
    value: "light",
    label: "Light",
    gradient: "linear-gradient(135deg, #e8e8f0 0%, #f5f5fa 100%)",
  },
];

const CHECK_INTERVALS = [
  { value: 1, label: "Every hour" },
  { value: 2, label: "Every 2 hours" },
  { value: 4, label: "Every 4 hours" },
  { value: 6, label: "Every 6 hours" },
  { value: 12, label: "Every 12 hours" },
  { value: 24, label: "Every 24 hours" },
];

function formatLastChecked(timestamp: number | null): string {
  if (!timestamp) return "Never";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function GeneralTab() {
  const { theme, setTheme, isGlass } = useTheme();

  const colorMode = theme.startsWith("dark") ? "dark" : "light";

  const handleColorModeChange = (mode: "dark" | "light") => {
    setTheme(`${mode}-${isGlass ? "glass" : "flat"}` as Theme);
  };

  const handleGlassToggle = (enabled: boolean) => {
    setTheme(`${colorMode}-${enabled ? "glass" : "flat"}` as Theme);
  };

  // Display settings
  const [showIcons, setShowIcons] = usePersistedBoolean(
    "show_project_icons",
    true,
  );

  // Update settings
  const [appVersion, setAppVersion] = useState("");
  const updateStatus = useUpdateStore((s) => s.status);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const autoCheckEnabled = useUpdateStore((s) => s.autoCheckEnabled);
  const checkIntervalHours = useUpdateStore((s) => s.checkIntervalHours);
  const customEndpoint = useUpdateStore((s) => s.customEndpoint);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const setAutoCheckEnabled = useUpdateStore((s) => s.setAutoCheckEnabled);
  const setCheckIntervalHours = useUpdateStore((s) => s.setCheckIntervalHours);
  const setCustomEndpoint = useUpdateStore((s) => s.setCustomEndpoint);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [endpointInput, setEndpointInput] = useState(customEndpoint ?? "");

  useEffect(() => {
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    setEndpointInput(customEndpoint ?? "");
  }, [customEndpoint]);

  const handleCheckNow = useCallback(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  const handleEndpointSave = useCallback(() => {
    const trimmed = endpointInput.trim();
    setCustomEndpoint(trimmed || null);
  }, [endpointInput, setCustomEndpoint]);

  const handleEndpointReset = useCallback(() => {
    setEndpointInput("");
    setCustomEndpoint(null);
  }, [setCustomEndpoint]);

  const handleOpenLogFolder = useCallback(async () => {
    try {
      await invoke("open_log_directory");
    } catch {
      // silently ignore if log directory is unavailable
    }
  }, []);

  return (
    <div className="flex flex-col gap-7">
      {/* Theme Picker */}
      <section>
        <div className={sectionHeadingClass}>Appearance</div>
        <div className="flex flex-col gap-4">
          {/* Color mode cards */}
          <div className="grid grid-cols-2 gap-2.5">
            {COLOR_MODES.map((m) => {
              const active = colorMode === m.value;
              return (
                <Card
                  key={m.value}
                  type="subtle"
                  radius="md"
                  border
                  hoverEffect="lift"
                  clickEffect="scale"
                  className={`cursor-pointer text-left ${active ? "!ring-2 !ring-primary" : ""}`}
                  onClick={() => handleColorModeChange(m.value)}
                >
                  <CardContent className="relative flex flex-col items-start gap-1.5 px-4 py-3.5">
                    <div
                      className="w-full h-8 rounded-[var(--radius-element)] border border-border"
                      style={{ background: m.gradient }}
                    />
                    <div className="text-[13px] font-medium text-foreground">
                      {m.label}
                    </div>
                    {active && (
                      <div className="absolute top-2 right-2 size-2 rounded-full bg-primary" />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Glass effect toggle */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-[var(--radius-element)] bg-background border border-border cursor-pointer">
            <Checkbox
              checked={isGlass}
              onCheckedChange={(checked) => handleGlassToggle(checked === true)}
              className="mt-0.5"
            />
            <div>
              <div className="text-[13px] font-medium text-foreground">
                Glass effect
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-[1.4]">
                Apply frosted glass blur to panels and sidebars.
              </div>
            </div>
          </label>
        </div>
      </section>

      {/* Display */}
      <section>
        <div className={sectionHeadingClass}>Display</div>
        <label className="flex items-start gap-2.5 p-2.5 rounded-[var(--radius-element)] bg-background border border-border cursor-pointer">
          <Checkbox
            checked={showIcons}
            onCheckedChange={(checked) => setShowIcons(checked === true)}
            className="mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-foreground">
              Show project icons in tabs
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 leading-[1.4]">
              Display auto-detected or custom SVG icons next to project names in
              the tab bar.
            </div>
          </div>
        </label>
      </section>

      {/* Updates */}
      <section>
        <div className={sectionHeadingClass}>Updates</div>
        <div className="flex flex-col gap-3">
          {/* Version + Check button */}
          <div className="flex items-center justify-between p-2.5 rounded-[var(--radius-element)] bg-background border border-border">
            <div>
              <div className="text-[13px] font-medium text-foreground">
                Current version
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {appVersion || "..."}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {formatLastChecked(lastCheckedAt)}
              </span>
              <button
                onClick={handleCheckNow}
                disabled={updateStatus === "checking"}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/50 text-xs text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                {updateStatus === "checking" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                Check now
              </button>
            </div>
          </div>

          {/* Auto-check toggle */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-[var(--radius-element)] bg-background border border-border cursor-pointer">
            <Checkbox
              checked={autoCheckEnabled}
              onCheckedChange={(checked) => setAutoCheckEnabled(checked === true)}
              className="mt-0.5"
            />
            <div>
              <div className="text-[13px] font-medium text-foreground">
                Automatically check for updates
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-[1.4]">
                Periodically check for new versions in the background.
              </div>
            </div>
          </label>

          {/* Check interval */}
          {autoCheckEnabled && (
            <div className="flex items-center justify-between p-2.5 rounded-[var(--radius-element)] bg-background border border-border">
              <div className="text-[13px] text-foreground">Check frequency</div>
              <select
                value={checkIntervalHours}
                onChange={(e) => setCheckIntervalHours(Number(e.target.value))}
                className={`${inputClass} w-40`}
              >
                {CHECK_INTERVALS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Advanced section */}
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              size={12}
              className={`transition-transform duration-200 ${advancedOpen ? "rotate-0" : "-rotate-90"}`}
            />
            Advanced
          </button>

          {advancedOpen && (
            <div className="flex flex-col gap-2 p-2.5 rounded-[var(--radius-element)] bg-background border border-border">
              <div className="text-[11px] text-muted-foreground">
                Custom update endpoint URL
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={endpointInput}
                  onChange={(e) => setEndpointInput(e.target.value)}
                  onBlur={handleEndpointSave}
                  placeholder="https://..."
                  className={`${inputClass} flex-1`}
                />
                <button
                  onClick={handleEndpointReset}
                  className="px-2 py-1 text-[11px] rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Diagnostics */}
      <section>
        <div className={sectionHeadingClass}>Diagnostics</div>
        <div className="flex items-center justify-between p-2.5 rounded-[var(--radius-element)] bg-background border border-border">
          <div>
            <div className="text-[13px] font-medium text-foreground">
              Log files
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Open the folder containing backend log files for debugging.
            </div>
          </div>
          <button
            onClick={handleOpenLogFolder}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/50 text-xs text-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <FolderOpen size={12} />
            Open Log Folder
          </button>
        </div>
      </section>
    </div>
  );
}
