import type { ITheme } from "@xterm/xterm";

/**
 * Full 16-color ANSI palettes for each app theme.
 * Dark themes use a GitHub-Dark-inspired palette;
 * Light themes use a GitHub-Light-inspired palette.
 * Glass vs flat share the same ANSI colors but differ in background opacity.
 */

interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground?: string;

  // Standard ANSI colors (0-7)
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;

  // Bright ANSI colors (8-15)
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

// ── Dark palette (used by dark-glass & dark-flat) ──

const DARK_THEME: TerminalTheme = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
  cursorAccent: "#0d1117",
  selectionBackground: "#264f78",

  black: "#484f58",
  red: "#f85149",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#76e3ea",
  white: "#e6edf3",

  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#b3f0ff",
  brightWhite: "#f0f6fc",
};

// ── Light palette (used by light-glass & light-flat) ──

const LIGHT_THEME: TerminalTheme = {
  background: "#ffffff",
  foreground: "#24292f",
  cursor: "#0969da",
  cursorAccent: "#ffffff",
  selectionBackground: "#0969da33",

  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",

  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#7d4e00",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};

// ── Theme map ──

type AppTheme = "dark-glass" | "dark-flat" | "light-glass" | "light-flat";

const THEME_MAP: Record<AppTheme, TerminalTheme> = {
  "dark-glass": DARK_THEME,
  "dark-flat": DARK_THEME,
  "light-glass": LIGHT_THEME,
  "light-flat": LIGHT_THEME,
};

/** Convert our TerminalTheme to xterm's ITheme. */
function toXtermTheme(theme: TerminalTheme): ITheme {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.cursorAccent,
    selectionBackground: theme.selectionBackground,
    selectionForeground: theme.selectionForeground,
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
  };
}

/** Get the xterm ITheme for a given app theme name. */
export function getXtermTheme(appTheme: string): ITheme {
  const key = appTheme as AppTheme;
  const terminal = THEME_MAP[key] ?? DARK_THEME;
  return toXtermTheme(terminal);
}
