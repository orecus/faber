import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Bell,
  ChevronDown,
  FolderOpen,
  Loader2,
  Monitor,
  Palette,
  RefreshCw,
  Wrench,
} from "lucide-react";

import { type Theme, useTheme } from "../../contexts/ThemeContext";
import { usePersistedBoolean } from "../../hooks/usePersistedState";
import { updateNotificationSettings } from "../../lib/notifications";
import { useUpdateStore } from "../../store/updateStore";
import { Card, CardContent } from "../ui/orecus.io/cards/card";
import { Tabs } from "../ui/orecus.io/navigation/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { sectionHeadingClass, inputClass, ToggleRow } from "./shared";

type GeneralTabId = "appearance" | "notifications" | "updates" | "system";

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

const NOTIF_TOGGLES: {
  key: string;
  settingsKey: "on_complete" | "on_error" | "on_waiting";
  label: string;
  description: string;
}[] = [
  {
    key: "notifications_on_complete",
    settingsKey: "on_complete",
    label: "Session Complete",
    description: "Notify when an agent session finishes its task.",
  },
  {
    key: "notifications_on_error",
    settingsKey: "on_error",
    label: "Session Error",
    description: "Notify when an agent session encounters an error.",
  },
  {
    key: "notifications_on_waiting",
    settingsKey: "on_waiting",
    label: "Input Needed",
    description: "Notify when an agent is waiting for user input.",
  },
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

// ── Appearance Panel ──

function AppearancePanel() {
  const { theme, setTheme, isGlass } = useTheme();
  const colorMode = theme.startsWith("dark") ? "dark" : "light";

  const handleColorModeChange = (mode: "dark" | "light") => {
    setTheme(`${mode}-${isGlass ? "glass" : "flat"}` as Theme);
  };

  const handleGlassToggle = (enabled: boolean) => {
    setTheme(`${colorMode}-${enabled ? "glass" : "flat"}` as Theme);
  };

  const [showIcons, setShowIcons] = usePersistedBoolean(
    "show_project_icons",
    true,
  );

  return (
    <div className="flex flex-col gap-7">
      {/* Theme Picker */}
      <section>
        <div className={sectionHeadingClass}>Theme</div>
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
                    <div className="text-sm font-medium text-foreground">
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
          <ToggleRow
            label="Glass effect"
            description="Apply frosted glass blur to panels and sidebars."
            checked={isGlass}
            onChange={handleGlassToggle}
          />
        </div>
      </section>

      {/* Display */}
      <section>
        <div className={sectionHeadingClass}>Display</div>
        <ToggleRow
          label="Show project icons in tabs"
          description="Display auto-detected or custom SVG icons next to project names in the tab bar."
          checked={showIcons}
          onChange={setShowIcons}
        />
      </section>
    </div>
  );
}

// ── Notifications Panel ──

function NotificationsPanel() {
  const [enabled, setEnabled] = usePersistedBoolean(
    "notifications_enabled",
    true,
  );
  const [onComplete, setOnComplete] = usePersistedBoolean(
    "notifications_on_complete",
    true,
  );
  const [onError, setOnError] = usePersistedBoolean(
    "notifications_on_error",
    true,
  );
  const [onWaiting, setOnWaiting] = usePersistedBoolean(
    "notifications_on_waiting",
    true,
  );

  // Sync cached settings in the notification module whenever toggles change
  useEffect(() => {
    updateNotificationSettings({
      enabled,
      on_complete: onComplete,
      on_error: onError,
      on_waiting: onWaiting,
    });
  }, [enabled, onComplete, onError, onWaiting]);

  const toggles = [
    { value: onComplete, setter: setOnComplete, ...NOTIF_TOGGLES[0] },
    { value: onError, setter: setOnError, ...NOTIF_TOGGLES[1] },
    { value: onWaiting, setter: setOnWaiting, ...NOTIF_TOGGLES[2] },
  ];

  return (
    <div className="flex flex-col gap-7">
      {/* Master toggle */}
      <section>
        <div className={sectionHeadingClass}>Notifications</div>
        <ToggleRow
          label="Enable notifications"
          description="Send OS-native notifications for agent events. Notifications are suppressed when the app is focused on the relevant terminal."
          checked={enabled}
          onChange={setEnabled}
        />
      </section>

      {/* Per-event toggles */}
      <section>
        <div className={sectionHeadingClass}>Event Types</div>
        <div className="flex flex-col gap-1">
          {toggles.map((t) => (
            <ToggleRow
              key={t.key}
              label={t.label}
              description={t.description}
              checked={t.value}
              onChange={t.setter}
              disabled={!enabled}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ── ACP Auto-Check Toggle ──

function AcpAutoCheckToggle() {
  const [autoCheck, setAutoCheck] = usePersistedBoolean(
    "auto_check_acp_updates",
    true,
  );

  return (
    <ToggleRow
      label="Check for ACP adapter updates"
      description="Automatically check for newer versions of installed ACP adapters on app launch (at most once per hour)."
      checked={autoCheck}
      onChange={setAutoCheck}
    />
  );
}

// ── Updates Panel ──

function UpdatesPanel() {
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

  return (
    <div className="flex flex-col gap-3">
      {/* Version + Check button */}
      <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 ring-1 ring-border/30">
        <div>
          <div className="text-sm font-medium text-foreground">
            Current version
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {appVersion || "..."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-muted-foreground">
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
      <ToggleRow
        label="Automatically check for updates"
        description="Periodically check for new versions in the background."
        checked={autoCheckEnabled}
        onChange={setAutoCheckEnabled}
      />

      {/* Check interval */}
      {autoCheckEnabled && (
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 ring-1 ring-border/30">
          <div className="text-sm text-foreground">Check frequency</div>
          <Select
            value={String(checkIntervalHours)}
            onValueChange={(v) => v && setCheckIntervalHours(Number(v))}
            items={CHECK_INTERVALS.map((opt) => ({
              value: String(opt.value),
              label: opt.label,
            }))}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHECK_INTERVALS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ACP adapter update check */}
      <AcpAutoCheckToggle />

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
        <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-muted/20 ring-1 ring-border/30">
          <div className="text-xs text-muted-foreground">
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
              className="px-2 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── System Panel ──

function SystemPanel() {
  const handleOpenLogFolder = useCallback(async () => {
    try {
      await invoke("open_log_directory");
    } catch {
      // silently ignore if log directory is unavailable
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 ring-1 ring-border/30">
        <div>
          <div className="text-sm font-medium text-foreground">
            Log files
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
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
    </div>
  );
}

// ── Main GeneralTab ──

export function GeneralTab() {
  const [activeTab, setActiveTab] = useState<GeneralTabId>("appearance");

  return (
    <div className="flex flex-col gap-5">
      <Tabs<GeneralTabId>
        value={activeTab}
        onChange={setActiveTab}
        animation="slide"
        variant="none"
        indicatorVariant="color"
        size="sm"
        align="start"
        barRadius="md"
        tabRadius="md"
      >
        <Tabs.Tab value="appearance" icon={<Palette size={13} />}>
          Appearance
        </Tabs.Tab>
        <Tabs.Tab value="notifications" icon={<Bell size={13} />}>
          Notifications
        </Tabs.Tab>
        <Tabs.Tab value="updates" icon={<Monitor size={13} />}>
          Updates
        </Tabs.Tab>
        <Tabs.Tab value="system" icon={<Wrench size={13} />}>
          System
        </Tabs.Tab>
      </Tabs>

      <div className="min-h-[375px]">
        {activeTab === "appearance" && <AppearancePanel />}
        {activeTab === "notifications" && <NotificationsPanel />}
        {activeTab === "updates" && <UpdatesPanel />}
        {activeTab === "system" && <SystemPanel />}
      </div>
    </div>
  );
}
