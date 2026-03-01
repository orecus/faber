import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

// ── Types ──

type NotificationType = "complete" | "error" | "waiting";

interface NotificationSettings {
  enabled: boolean;
  on_complete: boolean;
  on_error: boolean;
  on_waiting: boolean;
}

// ── Module state ──

let windowFocused = true;
let settings: NotificationSettings = {
  enabled: true,
  on_complete: true,
  on_error: true,
  on_waiting: true,
};

// Click-to-navigate: store pending target session, navigate on next focus
let pendingTarget: { sessionId: string; timestamp: number } | null = null;
let navigateFn: ((sessionId: string) => void) | null = null;

// ── Public API ──

/**
 * Initialize notification subsystem. Call once during store init.
 * Sets up focus/blur tracking and requests permission.
 */
export function initNotifications(
  navigateToSession: (sessionId: string) => void,
): () => void {
  navigateFn = navigateToSession;
  const cleanups: (() => void)[] = [];

  const appWindow = getCurrentWindow();

  // Track window focus state
  const unlistenFocus = appWindow.onFocusChanged(({ payload: focused }) => {
    windowFocused = focused;

    // If user focused the window within 10s of a notification, navigate
    if (focused && pendingTarget) {
      const age = Date.now() - pendingTarget.timestamp;
      if (age < 10_000 && navigateFn) {
        navigateFn(pendingTarget.sessionId);
      }
      pendingTarget = null;
    }
  });

  cleanups.push(() => {
    unlistenFocus.then((fn) => fn());
  });

  // Request permission (non-blocking)
  isPermissionGranted().then((granted) => {
    if (!granted) {
      requestPermission();
    }
  });

  return () => {
    for (const cleanup of cleanups) cleanup();
    navigateFn = null;
  };
}

/**
 * Send a notification if conditions are met (settings enabled, window not focused
 * on the relevant session, etc).
 */
export function maybeNotify(
  type: NotificationType,
  sessionId: string,
  sessionName: string,
  body: string,
  activeView: string,
  sessionProjectIsActive: boolean,
): void {
  if (!settings.enabled) return;

  // Check per-type toggle
  if (type === "complete" && !settings.on_complete) return;
  if (type === "error" && !settings.on_error) return;
  if (type === "waiting" && !settings.on_waiting) return;

  // Suppress if the app window is focused AND the user is on the terminal grid
  // AND the session's project is currently active
  if (windowFocused && activeView === "sessions" && sessionProjectIsActive) {
    return;
  }

  const title =
    type === "complete"
      ? `Session Complete: ${sessionName}`
      : type === "error"
        ? `Session Error: ${sessionName}`
        : `Input Needed: ${sessionName}`;

  sendNotification({ title, body });

  // Store pending target for click-to-navigate
  pendingTarget = { sessionId, timestamp: Date.now() };
}

/**
 * Update the cached notification settings. Called from SettingsView when
 * the user toggles any notification option.
 */
export function updateNotificationSettings(
  partial: Partial<NotificationSettings>,
): void {
  settings = { ...settings, ...partial };
}
