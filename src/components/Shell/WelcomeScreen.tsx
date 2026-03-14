import {
  ChevronRight,
  Circle,
  CircleCheck,
  FolderCode,
  FolderOpen,
  GitCompareArrows,
  LayoutDashboard,
  Loader2,
  type LucideIcon,
  TerminalSquare,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useMemo } from "react";

import { AGENT_DESCRIPTIONS } from "../../lib/agentDescriptions";
import { AgentIcon, getAgentColor } from "../../lib/agentIcons";
import { handleDragRegionMouseDown } from "../../lib/platform";
import { useAppStore } from "../../store/appStore";
import { pickProjectFolder } from "../../utils/pickProjectFolder";
// Shared logo component — see src/components/ui/FaberLogo.tsx
import { FaberLogo } from "../ui/FaberLogo";
import { Card, CardContent } from "../ui/orecus.io/cards/card";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { EASE, STAGGER_DELAYS } from "../ui/orecus.io/lib/animation";
import {
  type ThemeColor,
  gradientHexColors,
} from "../ui/orecus.io/lib/color-utils";
import WindowControls from "./WindowControls";

const CAPABILITIES: { icon: LucideIcon; label: string; description: string }[] =
  [
    {
      icon: LayoutDashboard,
      label: "Task Board",
      description: "Kanban workflow for AI tasks",
    },
    {
      icon: TerminalSquare,
      label: "Terminals",
      description: "Multi-pane terminal grid",
    },
    {
      icon: GitCompareArrows,
      label: "Git Isolation",
      description: "Worktree per task",
    },
  ];

const AGENT_KEYS = [
  "claude-code",
  "codex",
  "copilot",
  "cursor-agent",
  "gemini",
  "opencode",
] as const;

const LOADING_LABELS = [
  "Loading projects",
  "Detecting agents",
  "Detecting shells",
];

export default function WelcomeScreen() {
  const addProjectFromPath = useAppStore((s) => s.addProjectFromPath);
  const projects = useAppStore((s) => s.projects);
  const openProject = useAppStore((s) => s.openProject);
  const backgroundTasks = useAppStore((s) => s.backgroundTasks);
  const agents = useAppStore((s) => s.agents);

  const isLoading = useMemo(
    () => backgroundTasks.some((t) => LOADING_LABELS.includes(t)),
    [backgroundTasks],
  );

  const isDetectingAgents = useMemo(
    () => backgroundTasks.includes("Detecting agents"),
    [backgroundTasks],
  );

  const activeLoadingLabel = useMemo(
    () => backgroundTasks.find((t) => LOADING_LABELS.includes(t)) ?? null,
    [backgroundTasks],
  );

  // Build a lookup: agent key -> { installed, display_name }
  const agentDetection = useMemo(() => {
    const map = new Map<string, { installed: boolean; displayName: string }>();
    for (const a of agents) {
      map.set(a.name, { installed: a.installed, displayName: a.display_name });
    }
    return map;
  }, [agents]);

  const detectionDone = agents.length > 0 && !isDetectingAgents;

  const hasProjects = projects.length > 0;
  const showProjects = hasProjects && !isLoading;

  const handleOpenProject = useCallback(
    (id: string) => openProject(id),
    [openProject],
  );

  async function handlePickFolder() {
    const selected = await pickProjectFolder();
    if (!selected) return;
    await addProjectFromPath(selected);
  }

  return (
    <div className="flex flex-col h-screen bg-card/70">
      <div
        onMouseDown={handleDragRegionMouseDown}
        className="flex items-center justify-end h-9 shrink-0 select-none"
      >
        <WindowControls />
      </div>
      <div className="flex-1 flex items-center justify-center overflow-auto">
        <LayoutGroup>
          <motion.div
            layout
            transition={{ duration: 0.5, ease: EASE.panel }}
            className="flex flex-row items-start gap-8 px-6"
          >
            {/* Left column — CTA + capabilities + agents */}
            <motion.div
              layout
              transition={{ duration: 0.5, ease: EASE.panel }}
              className="flex flex-col items-center w-full max-w-[540px]"
            >
              {/* Title */}
              <motion.div
                layout="position"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE.out }}
                className="flex flex-col items-center mb-8"
              >
                <div className="flex items-center gap-4">
                  <FaberLogo className="size-12 shrink-0 text-primary" />
                  <div className="text-left">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground mb-0.5">
                      Faber
                    </h1>
                    <div className="text-xs font-medium tracking-[0.15em] uppercase text-primary">
                      AI Agent Orchestrator
                    </div>
                  </div>
                </div>

                {/* Loading indicator */}
                <AnimatePresence mode="wait">
                  {isLoading && (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.25, ease: EASE.out }}
                      className="flex items-center justify-center gap-2 mt-3"
                    >
                      <Loader2
                        size={12}
                        className="animate-spin text-muted-foreground"
                      />
                      <span className="text-[11px] text-muted-foreground">
                        {activeLoadingLabel
                          ? `${activeLoadingLabel}…`
                          : "Loading…"}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Main CTA card */}
              <Card
                type="normal"
                radius="lg"
                animationPreset="slide-up"
                animationDelay={0.05}
                hoverEffect="none"
                accentBar="top"
                accentBarVariant="solid"
                accentColor="primary"
                className="w-full"
              >
                <CardContent className="p-8 flex flex-col items-center gap-6">
                  {/* Description */}
                  <p className="text-sm text-dim-foreground text-center leading-relaxed max-w-[400px]">
                    Manage AI coding agents with a task-driven workflow. Assign
                    tasks, isolate work in git worktrees, and review changes
                    &mdash; all from one place.
                  </p>

                  {/* Primary CTA */}
                  <Button
                    glow
                    color="blue"
                    size="lg"
                    hoverEffect="scale"
                    clickEffect="scale"
                    leftIcon={<FolderOpen className="size-[18px]" />}
                    onClick={handlePickFolder}
                    className="w-full font-semibold"
                  >
                    Open Project Folder
                  </Button>
                </CardContent>
              </Card>

              {/* Capabilities */}
              <div className="grid grid-cols-3 gap-3 w-full mt-5">
                {CAPABILITIES.map((cap, i) => {
                  const Icon = cap.icon;
                  return (
                    <Card
                      key={cap.label}
                      type="subtle"
                      radius="md"
                      border
                      animationPreset="slide-up"
                      animationDelay={0.15 + i * STAGGER_DELAYS.fast}
                      className="text-center"
                    >
                      <CardContent className="p-4 flex flex-col items-center gap-1.5">
                        <div className="text-muted-foreground">
                          <Icon size={18} strokeWidth={1.5} />
                        </div>
                        <div className="text-[12px] font-medium text-dim-foreground">
                          {cap.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground leading-snug">
                          {cap.description}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Supported agents — 3-per-row card grid */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.35, ease: EASE.out }}
                className="mt-5 w-full flex flex-col items-center gap-2.5"
              >
                <span className="text-[11px] text-muted-foreground">
                  Supported agents
                </span>
                <div className="grid grid-cols-3 gap-2.5 w-full">
                  {AGENT_KEYS.map((key, i) => {
                    const info = agentDetection.get(key);
                    const displayName = info?.displayName ?? key;
                    const description =
                      AGENT_DESCRIPTIONS[
                        key === "cursor-agent" ? "cursor" : key
                      ] ?? "";
                    const color = getAgentColor(key);
                    const installed = info?.installed ?? false;

                    return (
                      <motion.div
                        key={key}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.3,
                          delay: 0.4 + i * STAGGER_DELAYS.fast,
                          ease: EASE.out,
                        }}
                      >
                        <Card
                          type="subtle"
                          radius="md"
                          border
                          hoverEffect="none"
                          className="h-full"
                        >
                          <CardContent className="px-3 flex items-start gap-2.5">
                            {/* Agent icon with brand-tinted background */}
                            <div
                              className="flex items-center justify-center size-8 rounded-md shrink-0"
                              style={{ backgroundColor: `${color}18` }}
                            >
                              <AgentIcon agent={key} size={16} />
                            </div>
                            <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[12px] font-medium text-foreground truncate">
                                  {displayName}
                                </span>
                                {/* Detection status indicator */}
                                <AnimatePresence>
                                  {detectionDone && (
                                    <motion.span
                                      initial={{ opacity: 0, scale: 0.5 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      transition={{
                                        duration: 0.25,
                                        delay: i * 0.04,
                                        ease: EASE.out,
                                      }}
                                      className="shrink-0"
                                      title={
                                        installed
                                          ? "Detected on system"
                                          : "Not found in PATH"
                                      }
                                    >
                                      {installed ? (
                                        <CircleCheck
                                          size={12}
                                          className="text-success"
                                        />
                                      ) : (
                                        <Circle
                                          size={12}
                                          className="text-muted-foreground/40"
                                        />
                                      )}
                                    </motion.span>
                                  )}
                                  {!detectionDone && isDetectingAgents && (
                                    <motion.span
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      exit={{ opacity: 0 }}
                                      className="shrink-0"
                                    >
                                      <Loader2
                                        size={11}
                                        className="animate-spin text-muted-foreground/50"
                                      />
                                    </motion.span>
                                  )}
                                </AnimatePresence>
                              </div>
                              <span className="text-[10px] text-muted-foreground leading-snug">
                                {description}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            </motion.div>

            {/* Right column — discovered projects */}
            <AnimatePresence>
              {showProjects && (
                <motion.div
                  key="projects-panel"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ duration: 0.45, ease: EASE.panel }}
                  className="w-[320px] shrink-0 pt-[68px]"
                >
                  <div className="flex items-center gap-2 mb-2.5 px-1">
                    <span className="text-[11px] font-medium tracking-[0.08em] uppercase text-muted-foreground">
                      Your Projects
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {projects.map((project, i) => {
                      const themeColor =
                        (project.color as ThemeColor) || "primary";
                      const accentHex =
                        gradientHexColors[themeColor]?.start ??
                        gradientHexColors.primary.start;
                      return (
                        <Card
                          key={project.id}
                          type="normal"
                          radius="lg"
                          hoverEffect="lift"
                          clickEffect="scale"
                          animationPreset="slide-left"
                          animationDelay={0.06 + i * STAGGER_DELAYS.fast}
                          accentBar="top"
                          accentBarVariant="solid"
                          accentColor={themeColor}
                          className="cursor-pointer"
                          onClick={() => handleOpenProject(project.id)}
                        >
                          <CardContent className="group flex items-center gap-3">
                            <div
                              className="flex items-center justify-center size-8 rounded-md shrink-0
                              transition-colors duration-150"
                              style={{ backgroundColor: `${accentHex}18` }}
                            >
                              <FolderCode
                                size={16}
                                strokeWidth={1.5}
                                className="transition-colors duration-150"
                                style={{ color: accentHex }}
                              />
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-[13px] font-medium text-foreground truncate">
                                {project.name}
                              </span>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {project.path}
                              </span>
                            </div>
                            <ChevronRight
                              size={14}
                              className="text-muted-foreground opacity-0 -translate-x-1
                              group-hover:opacity-100 group-hover:translate-x-0
                              transition-all duration-150 shrink-0"
                            />
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>
      </div>
    </div>
  );
}
