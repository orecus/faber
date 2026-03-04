import { code } from "@streamdown/code";

import type { BundledTheme, ControlsConfig, PluginConfig } from "streamdown";

/** Shared Streamdown plugin config — enables Shiki syntax highlighting. */
export const streamdownPlugins: PluginConfig = { code };

/** Shiki theme pair [light, dark]. */
export const streamdownTheme: [BundledTheme, BundledTheme] = [
  "github-light-default",
  "github-dark-default",
];

/** Hide copy/download buttons on code blocks. */
export const streamdownControls: ControlsConfig = { code: false };
