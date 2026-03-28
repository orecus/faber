import { CircleCheck, CircleX, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";

import { AgentIcon, getAgentColor } from "../../lib/agentIcons";
import { useAppStore } from "../../store/appStore";
import type { AgentInfo } from "../../types";
import { EASE, STAGGER_DELAYS } from "../ui/orecus.io/lib/animation";
import {
  type ThemeColor,
  borderAccentColors,
} from "../ui/orecus.io/lib/color-utils";

/** Stub agent defaults — all detection-dependent fields are false/null. */
const AGENT_STUB: Omit<AgentInfo, "name" | "display_name" | "command"> = {
  installed: false, default_model: null, supported_models: [],
  supports_acp: false, acp_installed: false, acp_command: null,
  acp_args: [], acp_install_command: null, acp_adapter_package: null,
  cli_install_url: null, cli_install_hint: null,
};

/** Static list of known agents shown as placeholders while detection runs. */
const KNOWN_AGENTS: AgentInfo[] = [
  { ...AGENT_STUB, name: "claude-code", display_name: "Claude Code", command: "claude", supports_acp: true },
  { ...AGENT_STUB, name: "codex", display_name: "Codex CLI", command: "codex" },
  { ...AGENT_STUB, name: "gemini", display_name: "Gemini CLI", command: "gemini" },
  { ...AGENT_STUB, name: "copilot", display_name: "Copilot CLI", command: "copilot" },
  { ...AGENT_STUB, name: "opencode", display_name: "OpenCode", command: "opencode" },
  { ...AGENT_STUB, name: "cursor-agent", display_name: "Cursor Agent", command: "cursor-agent" },
];

interface AgentCardGridProps {
  /** Which agent is currently selected (by name), or null for display-only */
  selectedAgentName: string | null;
  /** Called when user clicks an enabled agent card. Omit for display-only grids. */
  onSelect?: (agentName: string) => void;
  /** Project accent color for selected card border */
  accentColor: ThemeColor;
  /** Optional filter: return false to hide an agent entirely */
  filter?: (agent: AgentInfo) => boolean;
  /** Optional: return true to disable a card (visible but not clickable). Defaults to `!agent.installed` */
  isDisabled?: (agent: AgentInfo) => boolean;
  /** Staggered entrance animation (for WelcomeScreen) */
  animated?: boolean;
  /** Base delay offset for staggered animation (default 0) */
  animationDelay?: number;
  /** Show CLI / ACP detection status badges */
  showStatus?: boolean;
  /** Number of grid columns */
  columns?: 3 | 4 | 5 | 6;
  /** Additional className on the outer grid */
  className?: string;
}

const GRID_COLS: Record<number, string> = {
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

export default function AgentCardGrid({
  selectedAgentName,
  onSelect,
  accentColor,
  filter,
  isDisabled,
  animated = false,
  animationDelay = 0,
  showStatus = false,
  columns = 3,
  className,
}: AgentCardGridProps) {
  const agents = useAppStore((s) => s.agents);
  const backgroundTasks = useAppStore((s) => s.backgroundTasks);

  const isDetecting = useMemo(
    () => backgroundTasks.includes("Detecting agents"),
    [backgroundTasks],
  );

  // Use placeholder agents while detection hasn't returned results yet
  const effectiveAgents = agents.length > 0 ? agents : KNOWN_AGENTS;

  const visibleAgents = useMemo(
    () => (filter ? effectiveAgents.filter(filter) : effectiveAgents),
    [effectiveAgents, filter],
  );

  return (
    <div className={`grid ${GRID_COLS[columns]} gap-2 ${className ?? ""}`}>
      {visibleAgents.map((agent, i) => {
        const isSelected = selectedAgentName === agent.name;
        const disabled = isDisabled
          ? isDisabled(agent)
          : !agent.installed;

        const card = (
          <AgentCard
            key={agent.name}
            agent={agent}
            isSelected={isSelected}
            disabled={disabled}
            accentColor={accentColor}
            showStatus={showStatus}
            isDetecting={isDetecting}
            onSelect={onSelect}
          />
        );

        if (animated) {
          return (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.3,
                delay: animationDelay + i * STAGGER_DELAYS.fast,
                ease: EASE.out,
              }}
            >
              {card}
            </motion.div>
          );
        }

        return card;
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface AgentCardProps {
  agent: AgentInfo;
  isSelected: boolean;
  disabled: boolean;
  accentColor: ThemeColor;
  showStatus: boolean;
  isDetecting: boolean;
  onSelect?: (name: string) => void;
}

function AgentCard({
  agent,
  isSelected,
  disabled,
  accentColor,
  showStatus,
  isDetecting,
  onSelect,
}: AgentCardProps) {
  const color = getAgentColor(agent.name);
  const interactive = !!onSelect;

  return (
    <button
      onClick={() => interactive && !disabled && onSelect(agent.name)}
      disabled={disabled || !interactive}
      className={`flex w-full items-center gap-2 rounded-[var(--radius-element)] px-3 py-2.5 text-left transition-all duration-150 border ${
        isSelected
          ? `${borderAccentColors[accentColor]} bg-accent`
          : "border-border bg-popover"
      } ${disabled ? "opacity-40 cursor-default" : interactive ? "cursor-pointer" : "cursor-default"}`}
    >
      {/* Icon */}
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ background: `${color}20` }}
      >
        <AgentIcon agent={agent.name} size={18} />
      </span>

      {/* Name + status */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span
          className={`text-xs truncate ${isSelected ? "font-medium" : "font-normal"} ${
            disabled ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {agent.display_name}
        </span>

        {showStatus && (
          <div className="flex items-center gap-2">
            <StatusBadge
              label="CLI"
              installed={agent.installed}
              loading={isDetecting}
            />
            <StatusBadge
              label="ACP"
              installed={agent.acp_installed}
              loading={isDetecting}
            />
          </div>
        )}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */

interface StatusBadgeProps {
  label: string;
  installed: boolean;
  loading: boolean;
}

function StatusBadge({ label, installed, loading }: StatusBadgeProps) {
  return (
    <span className="flex items-center gap-0.5 text-2xs text-muted-foreground">
      {label}
      {loading ? (
        <Loader2 size={9} className="animate-spin text-muted-foreground/50" />
      ) : installed ? (
        <CircleCheck size={10} className="text-success" />
      ) : (
        <CircleX size={10} className="text-muted-foreground/40" />
      )}
    </span>
  );
}
