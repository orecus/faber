import {
  ArrowRight,
  CircleHelp,
  ClipboardList,
  Eye,
  type LucideIcon,
  Play,
  Plus,
} from "lucide-react";
import { motion } from "motion/react";

import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { Card, CardContent } from "../ui/orecus.io/cards/card";
import { EASE, STAGGER_DELAYS } from "../ui/orecus.io/lib/animation";

interface EmptyStateProps {
  onNewTask?: () => void;
}

const ONBOARDING_STEPS: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: string;
}[] = [
  {
    icon: ClipboardList,
    title: "Create your first task",
    description:
      "Describe what you want an AI agent to build, fix, or refactor. Tasks live on a Kanban board so you can track progress.",
    action: "create",
  },
  {
    icon: Play,
    title: "Launch a session",
    description:
      "Pick an agent and launch it on your task. Optionally isolate work in a git worktree to keep your main branch clean.",
  },
  {
    icon: Eye,
    title: "Review the results",
    description:
      "When the agent finishes, review the diff, approve changes, and merge — all from within Faber.",
  },
];

export default function EmptyState({ onNewTask }: EmptyStateProps) {
  const setActiveView = useAppStore((s) => s.setActiveView);

  return (
    <div className="flex items-center justify-center flex-1 min-h-0">
      <div className="flex flex-col items-center max-w-[480px] w-full px-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE.out }}
          className="text-center mb-6"
        >
          <h3 className="m-0 mb-1.5 text-base font-semibold text-foreground">
            Get started
          </h3>
          <p className="m-0 text-sm text-dim-foreground leading-relaxed">
            Set up your first AI-powered workflow in three steps.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="flex flex-col gap-3 w-full">
          {ONBOARDING_STEPS.map((step, i) => {
            const Icon = step.icon;
            const isFirst = i === 0;
            return (
              <Card
                key={step.title}
                type={isFirst ? "normal" : "subtle"}
                radius="lg"
                border
                animationPreset="slide-up"
                animationDelay={0.08 + i * STAGGER_DELAYS.normal}
                accentBar={isFirst ? "top" : "none"}
                accentBarVariant="solid"
                accentColor="primary"
                className={isFirst ? "" : "opacity-60"}
              >
                <CardContent className="p-4 flex items-start gap-3.5">
                  <div
                    className={`flex items-center justify-center size-8 rounded-lg shrink-0 ${
                      isFirst
                        ? "bg-primary/15 text-primary"
                        : "bg-muted/60 text-muted-foreground"
                    }`}
                  >
                    <Icon size={16} strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-2xs font-medium text-muted-foreground">
                        Step {i + 1}
                      </span>
                      {!isFirst && (
                        <ArrowRight size={10} className="text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="text-sm font-medium text-foreground mt-0.5">
                      {step.title}
                    </div>
                    <p className="text-xs text-dim-foreground leading-relaxed mt-1 mb-0">
                      {step.description}
                    </p>
                    {isFirst && onNewTask && (
                      <Button
                        size="sm"
                        color="blue"
                        hoverEffect="scale"
                        clickEffect="scale"
                        leftIcon={<Plus className="size-3.5" />}
                        onClick={onNewTask}
                        className="mt-3"
                      >
                        Create Task
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Help link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.4, ease: EASE.out }}
          className="mt-5"
        >
          <button
            type="button"
            onClick={() => setActiveView("help")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <CircleHelp size={12} />
            <span>View documentation</span>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
