import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * useState + backend persistence via get_setting / set_setting.
 * Includes optional debounce for high-frequency updates (e.g. drag resize).
 *
 * All hooks broadcast changes via a window CustomEvent so that multiple
 * components using the same key stay in sync (e.g. TerminalTab → Terminal).
 */

function broadcastChange(key: string, raw: string) {
  window.dispatchEvent(
    new CustomEvent("persisted-setting-change", { detail: { key, value: raw } }),
  );
}

export function usePersistedBoolean(
  key: string,
  defaultValue: boolean,
): [boolean, (value: boolean) => void] {
  const [state, setState] = useState(defaultValue);

  useEffect(() => {
    invoke<string | null>("get_setting", { key })
      .then((saved) => {
        if (saved != null) setState(saved === "true");
      })
      .catch(() => {});
  }, [key]);

  // Listen for cross-component broadcasts
  useEffect(() => {
    const handler = (e: Event) => {
      const { key: k, value } = (e as CustomEvent).detail;
      if (k === key) setState(value === "true");
    };
    window.addEventListener("persisted-setting-change", handler);
    return () => window.removeEventListener("persisted-setting-change", handler);
  }, [key]);

  const setValue = useCallback(
    (value: boolean) => {
      setState(value);
      const raw = String(value);
      invoke("set_setting", { key, value: raw }).catch(() => {});
      broadcastChange(key, raw);
    },
    [key],
  );

  return [state, setValue];
}

export function usePersistedString(
  key: string,
  defaultValue: string,
): [string, (value: string) => void] {
  const [state, setState] = useState(defaultValue);

  useEffect(() => {
    invoke<string | null>("get_setting", { key })
      .then((saved) => {
        if (saved != null) setState(saved);
      })
      .catch(() => {});
  }, [key]);

  // Listen for cross-component broadcasts
  useEffect(() => {
    const handler = (e: Event) => {
      const { key: k, value } = (e as CustomEvent).detail;
      if (k === key) setState(value);
    };
    window.addEventListener("persisted-setting-change", handler);
    return () => window.removeEventListener("persisted-setting-change", handler);
  }, [key]);

  const setValue = useCallback(
    (value: string) => {
      setState(value);
      invoke("set_setting", { key, value }).catch(() => {});
      broadcastChange(key, value);
    },
    [key],
  );

  return [state, setValue];
}

export function usePersistedNumber(
  key: string,
  defaultValue: number,
  debounceMs = 0,
): [number, (value: number) => void] {
  const [state, setState] = useState(defaultValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<string | null>("get_setting", { key })
      .then((saved) => {
        if (saved != null) {
          const n = Number(saved);
          if (!isNaN(n)) setState(n);
        }
      })
      .catch(() => {});
  }, [key]);

  // Listen for cross-component broadcasts
  useEffect(() => {
    const handler = (e: Event) => {
      const { key: k, value } = (e as CustomEvent).detail;
      if (k === key) {
        const n = Number(value);
        if (!isNaN(n)) setState(n);
      }
    };
    window.addEventListener("persisted-setting-change", handler);
    return () => window.removeEventListener("persisted-setting-change", handler);
  }, [key]);

  const setValue = useCallback(
    (value: number) => {
      setState(value);

      const raw = String(value);
      const persist = () => {
        invoke("set_setting", { key, value: raw }).catch(() => {});
        broadcastChange(key, raw);
      };

      if (debounceMs > 0) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(persist, debounceMs);
      } else {
        persist();
      }
    },
    [key, debounceMs],
  );

  return [state, setValue];
}
