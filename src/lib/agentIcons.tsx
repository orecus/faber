import { TerminalSquare } from "lucide-react";

/**
 * Maps agent names to their brand SVG icons (from /public).
 * Falls back to TerminalSquare for unknown agents and shell sessions.
 */

const AGENT_ICON_MAP: Record<string, { src: string; srcDark?: string }> = {
  "claude-code": { src: "/claude-ai-icon.svg" },
  codex: { src: "/openai.svg", srcDark: "/openai_dark.svg" },
  "cursor-agent": { src: "/cursor_light.svg", srcDark: "/cursor_dark.svg" },
  gemini: { src: "/gemini.svg" },
  opencode: { src: "/opencode-logo-light.svg", srcDark: "/opencode-logo-dark.svg" },
};

/** Reads the current theme from the document's data-theme attribute. */
function isDarkTheme(): boolean {
  return document.documentElement.getAttribute("data-theme")?.startsWith("dark") ?? true;
}

interface AgentIconProps {
  agent: string;
  size?: number;
  className?: string;
}

export function AgentIcon({
  agent,
  size = 14,
  className = "",
}: AgentIconProps) {
  const normalized = agent.toLowerCase();

  // Shell sessions
  if (normalized === "shell") {
    return <TerminalSquare size={size} className={className} />;
  }

  const entry = AGENT_ICON_MAP[normalized];
  if (entry) {
    const dark = isDarkTheme();
    const src = dark && entry.srcDark ? entry.srcDark : entry.src;
    return (
      <img
        src={src}
        alt={agent}
        width={size}
        height={size}
        className={`shrink-0 ${className}`}
        draggable={false}
      />
    );
  }

  // Fallback
  return <TerminalSquare size={size} className={className} />;
}

/** Brand colors per agent (used for accent tinting in cards) */
export const AGENT_COLORS: Record<string, string> = {
  "claude-code": "#D97757",
  codex: "#10a37f",
  "cursor-agent": "#00A8FF",
  gemini: "#4285F4",
  opencode: "#00DC82",
};

export function getAgentColor(agent: string): string {
  return AGENT_COLORS[agent.toLowerCase()] ?? "var(--muted-foreground)";
}
