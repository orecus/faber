import {
  ChevronRight,
  CircleCheck,
  FolderCode,
  FolderOpen,
  FolderPlus,
  GitCompareArrows,
  LayoutDashboard,
  Loader2,
  type LucideIcon,
  TerminalSquare,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { handleDragRegionMouseDown } from "../../lib/platform";
import { useAppStore } from "../../store/appStore";
import { pickProjectFolder } from "../../utils/pickProjectFolder";
// Shared logo component — see src/components/ui/FaberLogo.tsx
import { FaberLogo } from "../ui/FaberLogo";
import { Card, CardContent } from "../ui/orecus.io/cards/card";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { EASE, STAGGER_DELAYS } from "../ui/orecus.io/lib/animation";
import AgentCardGrid from "../Launchers/AgentCardGrid";
import {
  type ThemeColor,
  gradientHexColors,
} from "../ui/orecus.io/lib/color-utils";
import CreateProjectDialog from "./CreateProjectDialog";
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

  const activeLoadingLabel = useMemo(
    () => backgroundTasks.find((t) => LOADING_LABELS.includes(t)) ?? null,
    [backgroundTasks],
  );

  const [showCreateProject, setShowCreateProject] = useState(false);

  // Match right-column height to the left column
  const leftColRef = useRef<HTMLDivElement>(null);
  const [leftColHeight, setLeftColHeight] = useState<number>(0);

  useEffect(() => {
    const el = leftColRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setLeftColHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasProjects = projects.length > 0;
  const showProjects = hasProjects && !isLoading;

  const isDetectingAgents = useMemo(
    () => backgroundTasks.includes("Detecting agents"),
    [backgroundTasks],
  );
  const agentSummary = useMemo(() => {
    if (isDetectingAgents || agents.length === 0) return null;
    const installed = agents.filter((a) => a.installed).length;
    if (installed === agents.length) return { text: "All agents ready", allReady: true };
    return { text: `${installed} of ${agents.length} agents detected`, allReady: false };
  }, [agents, isDetectingAgents]);

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
              ref={leftColRef}
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
                      <span className="text-xs text-muted-foreground">
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

                  {/* Secondary CTA */}
                  <Button
                    variant="outline"
                    size="sm"
                    hoverEffect="scale"
                    clickEffect="scale"
                    leftIcon={<FolderPlus className="size-3.5" />}
                    onClick={() => setShowCreateProject(true)}
                  >
                    Create New Project
                  </Button>
                </CardContent>
              </Card>

              {/* Capabilities — only shown for first-time users */}
              {!hasProjects && (
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
                          <div className="text-xs font-medium text-dim-foreground">
                            {cap.label}
                          </div>
                          <div className="text-2xs text-muted-foreground leading-snug">
                            {cap.description}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Supported agents — 3-per-row card grid */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.35, ease: EASE.out }}
                className="mt-5 w-full flex flex-col items-center gap-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Supported agents
                  </span>
                  {agentSummary && (
                    <span
                      className={`flex items-center gap-1 text-xs ${
                        agentSummary.allReady
                          ? "text-success"
                          : "text-dim-foreground"
                      }`}
                    >
                      {agentSummary.allReady && (
                        <CircleCheck size={11} />
                      )}
                      <span>· {agentSummary.text}</span>
                    </span>
                  )}
                </div>
                <AgentCardGrid
                  selectedAgentName={null}
                  accentColor="blue"
                  isDisabled={() => false}
                  animated
                  animationDelay={0.4}
                  showStatus
                  className="w-full"
                />
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
                  className="w-[320px] shrink-0 pt-[68px] flex flex-col"
                  style={leftColHeight ? { maxHeight: leftColHeight } : undefined}
                >
                  <div className="flex items-center gap-2 mb-2.5 px-1 shrink-0">
                    <span className="text-xs font-medium tracking-[0.08em] uppercase text-muted-foreground">
                      Your Projects
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="flex flex-col gap-1.5 overflow-y-auto min-h-0 flex-1 p-1">
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
                              <span className="text-sm font-medium text-foreground truncate">
                                {project.name}
                              </span>
                              <span className="text-xs text-muted-foreground truncate">
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

      {showCreateProject && (
        <CreateProjectDialog onDismiss={() => setShowCreateProject(false)} />
      )}
    </div>
  );
}
