import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { usePersistedString, usePersistedNumber } from "../hooks/usePersistedState";
import { useTheme } from "../contexts/ThemeContext";
import { getXtermTheme } from "../lib/terminalTheme";
import { ptyBuffer } from "../lib/ptyBuffer";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  sessionId: string;
  onExit?: (sessionId: string) => void;
}

interface PtyOutputPayload {
  session_id: string;
  data: string;
}

interface PtyExitPayload {
  session_id: string;
  success: boolean;
}

export default function Terminal({ sessionId, onExit }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const { theme } = useTheme();

  const [fontFamily] = usePersistedString(
    "terminal_font_family",
    "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  );
  const [fontSize] = usePersistedNumber("terminal_font_size", 14);
  const [lineHeight] = usePersistedNumber("terminal_line_height", 1.0);
  const [zoom] = usePersistedNumber("terminal_zoom", 100);

  // Apply zoom as a font size multiplier (e.g. 125% zoom → fontSize * 1.25)
  const effectiveFontSize = Math.round(fontSize * (zoom / 100));
  // xterm.js requires lineHeight >= 1
  const effectiveLineHeight = Math.max(1.0, lineHeight);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      scrollback: 10000,
      fontFamily,
      fontSize: effectiveFontSize,
      lineHeight: effectiveLineHeight,
      theme: getXtermTheme(theme),
      allowProposedApi: true,
      tabStopWidth: 8,
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    term.open(containerRef.current);
    fitAddon.fit();

    // GPU-accelerated rendering: WebGL → Canvas → DOM fallback
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        try {
          term.loadAddon(new CanvasAddon());
        } catch {
          // DOM renderer as final fallback
        }
      });
      term.loadAddon(webglAddon);
    } catch {
      try {
        term.loadAddon(new CanvasAddon());
      } catch {
        // DOM renderer as final fallback
      }
    }

    termRef.current = term;

    // Replay buffered output so the terminal shows history from before this
    // mount (e.g., after a project switch or grid layout change).
    // Suppress input forwarding during replay to prevent cursor position
    // report responses (from \x1b[6n in the buffer) leaking into the PTY.
    let replayDone = false;

    const inputDisposable = term.onData((data: string) => {
      if (!replayDone) return;
      invoke("write_pty", { sessionId, data }).catch(() => {
        // Session may have ended
      });
    });

    const buffered = ptyBuffer.getBuffer(sessionId);
    if (buffered) {
      term.write(buffered, () => { replayDone = true; });
    } else {
      replayDone = true;
    }

    // PTY output → terminal
    const unlistenOutput = listen<PtyOutputPayload>("pty-output", (event) => {
      if (event.payload.session_id === sessionId) {
        term.write(event.payload.data);
      }
    });

    // PTY exit
    const unlistenExit = listen<PtyExitPayload>("pty-exit", (event) => {
      if (event.payload.session_id === sessionId) {
        onExit?.(sessionId);
      }
    });

    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const { cols, rows } = term;
      invoke("resize_pty", { sessionId, cols, rows }).catch(() => {
        // Session may have ended
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      inputDisposable.dispose();
      unlistenOutput.then((fn) => fn());
      unlistenExit.then((fn) => fn());
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, onExit]);

  // Live-update terminal theme when app theme changes
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = getXtermTheme(theme);
  }, [theme]);

  // Live-update terminal font options when settings change
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = effectiveFontSize;
    term.options.lineHeight = effectiveLineHeight;
    fitAddonRef.current?.fit();
  }, [fontFamily, effectiveFontSize, effectiveLineHeight]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-0"
    />
  );
}
