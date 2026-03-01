import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UpdateInfo, UpdateStatus } from "../types";

interface UpdateState {
  // Persisted settings
  autoCheckEnabled: boolean;
  checkIntervalHours: number;
  dismissedVersion: string | null;
  customEndpoint: string | null;

  // Transient state
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: number;
  error: string | null;
  lastCheckedAt: number | null;

  // Actions
  initialize: () => () => void;
  checkForUpdates: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismissUpdate: () => void;
  setAutoCheckEnabled: (enabled: boolean) => void;
  setCheckIntervalHours: (hours: number) => void;
  setCustomEndpoint: (endpoint: string | null) => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let unlisteners: UnlistenFn[] = [];

  return {
    // Defaults
    autoCheckEnabled: true,
    checkIntervalHours: 4,
    dismissedVersion: null,
    customEndpoint: null,

    status: "idle",
    updateInfo: null,
    downloadProgress: 0,
    error: null,
    lastCheckedAt: null,

    initialize: () => {
      // Load all update settings in a single IPC call
      invoke<{ key: string; value: string }[]>("get_all_settings")
        .then((settings) => {
          const map = new Map(settings.map((s) => [s.key, s.value]));
          const patch: Partial<Pick<UpdateState, "autoCheckEnabled" | "checkIntervalHours" | "dismissedVersion" | "customEndpoint">> = {};
          const ac = map.get("update_auto_check");
          if (ac != null) patch.autoCheckEnabled = ac === "true";
          const ci = map.get("update_check_interval");
          if (ci != null) { const n = Number(ci); if (!isNaN(n)) patch.checkIntervalHours = n; }
          const dv = map.get("update_dismissed_version");
          if (dv != null) patch.dismissedVersion = dv;
          const ce = map.get("update_custom_endpoint");
          if (ce != null && ce !== "") patch.customEndpoint = ce;
          if (Object.keys(patch).length > 0) set(patch);
        })
        .catch(() => {});

      // Set up event listeners
      listen<{ progress: number; total: number | null }>("update-download-progress", (event) => {
        set({ downloadProgress: Math.round(event.payload.progress) });
      }).then((u) => unlisteners.push(u));

      listen("update-installing", () => {
        set({ status: "installing" });
      }).then((u) => unlisteners.push(u));

      // Auto-check on startup after a short delay
      setTimeout(() => {
        const state = get();
        if (state.autoCheckEnabled) {
          state.checkForUpdates();
        }
      }, 5000);

      // Set up periodic check
      const setupInterval = () => {
        if (intervalId) clearInterval(intervalId);
        const state = get();
        if (state.autoCheckEnabled) {
          intervalId = setInterval(() => {
            get().checkForUpdates();
          }, state.checkIntervalHours * 3600000);
        }
      };
      setupInterval();

      // Cleanup function
      return () => {
        if (intervalId) clearInterval(intervalId);
        for (const u of unlisteners) u();
        unlisteners = [];
      };
    },

    checkForUpdates: async () => {
      set({ status: "checking", error: null });
      try {
        const { customEndpoint } = get();
        const info = await invoke<UpdateInfo>("check_for_updates", {
          customEndpoint,
        });
        set({
          updateInfo: info,
          status: info.available ? "available" : "idle",
          lastCheckedAt: Date.now(),
        });
      } catch (e) {
        set({ status: "error", error: String(e) });
      }
    },

    downloadAndInstall: async () => {
      set({ status: "downloading", downloadProgress: 0, error: null });
      try {
        const { customEndpoint } = get();
        await invoke("download_and_install_update", { customEndpoint });
        // App will restart, so we won't reach here normally
      } catch (e) {
        set({ status: "error", error: String(e) });
      }
    },

    dismissUpdate: () => {
      const info = get().updateInfo;
      if (info?.available) {
        const version = info.latest_version;
        set({ dismissedVersion: version, status: "idle", error: null });
        invoke("set_setting", { key: "update_dismissed_version", value: version }).catch(() => {});
      } else {
        set({ status: "idle", error: null });
      }
    },

    setAutoCheckEnabled: (enabled) => {
      set({ autoCheckEnabled: enabled });
      invoke("set_setting", { key: "update_auto_check", value: String(enabled) }).catch(() => {});
      // Reset interval
      if (intervalId) clearInterval(intervalId);
      if (enabled) {
        const state = get();
        intervalId = setInterval(() => {
          get().checkForUpdates();
        }, state.checkIntervalHours * 3600000);
      }
    },

    setCheckIntervalHours: (hours) => {
      set({ checkIntervalHours: hours });
      invoke("set_setting", { key: "update_check_interval", value: String(hours) }).catch(() => {});
      // Reset interval
      if (intervalId) clearInterval(intervalId);
      const state = get();
      if (state.autoCheckEnabled) {
        intervalId = setInterval(() => {
          get().checkForUpdates();
        }, hours * 3600000);
      }
    },

    setCustomEndpoint: (endpoint) => {
      set({ customEndpoint: endpoint });
      invoke("set_setting", {
        key: "update_custom_endpoint",
        value: endpoint ?? "",
      }).catch(() => {});
    },
  };
});
