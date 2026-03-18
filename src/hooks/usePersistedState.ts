import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * useState + backend persistence via get_setting / set_setting.
 * Includes optional debounce for high-frequency updates (e.g. drag resize).
 *
 * All hooks broadcast changes via a window CustomEvent so that multiple
 * components using the same key stay in sync (e.g. TerminalTab → Terminal).
 *
 * Each hook returns a third `loaded` boolean that is `false` until the
 * persisted value has been read from the backend (or the read failed).
 * Use this to avoid UI flashes when the default differs from the saved value.
 */

function broadcastChange(key: string, raw: string) {
  window.dispatchEvent(
    new CustomEvent("persisted-setting-change", { detail: { key, value: raw } }),
  );
}

export function usePersistedBoolean(
  key: string,
  defaultValue: boolean,
): [boolean, (value: boolean) => void, boolean] {
  const [state, setState] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke<string | null>("get_setting", { key })
      .then((saved) => {
        if (saved != null) setState(saved === "true");
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
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

  return [state, setValue, loaded];
}

export function usePersistedString(
  key: string,
  defaultValue: string,
): [string, (value: string) => void, boolean] {
  const [state, setState] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke<string | null>("get_setting", { key })
      .then((saved) => {
        if (saved != null) setState(saved);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
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

  return [state, setValue, loaded];
}

export function usePersistedNumber(
  key: string,
  defaultValue: number,
  debounceMs = 0,
): [number, (value: number) => void, boolean] {
  const [state, setState] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<string | null>("get_setting", { key })
      .then((saved) => {
        if (saved != null) {
          const n = Number(saved);
          if (!isNaN(n)) setState(n);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
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

  return [state, setValue, loaded];
}
