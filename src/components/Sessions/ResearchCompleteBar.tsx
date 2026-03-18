import { ArrowRight, FlaskConical, X } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface ResearchCompleteBarProps {
  sessionId: string;
  taskId: string;
}

export default React.memo(function ResearchCompleteBar({
  sessionId,
  taskId,
}: ResearchCompleteBarProps) {
  const accentColor = useProjectAccentColor();
  const dismissResearchComplete = useAppStore((s) => s.dismissResearchComplete);
  const setLaunchTaskForSession = useAppStore((s) => s.setLaunchTaskForSession);
  const mcpSummary = useAppStore((s) => s.mcpStatus[sessionId]?.summary);

  // Animate in after mount
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleContinue = useCallback(() => {
    setLaunchTaskForSession(sessionId);
  }, [sessionId, setLaunchTaskForSession]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => dismissResearchComplete(sessionId), 300);
  }, [sessionId, dismissResearchComplete]);

  const task = useAppStore((s) => s.tasks.find((t) => t.id === taskId));

  return (
    <div className="absolute inset-0 z-[8] flex items-center justify-center">
      {/* Blur backdrop */}
      <div
        className={`absolute inset-0 transition-all duration-300 ease-out ${
          visible
            ? "backdrop-blur-[3px] bg-black/30"
            : "backdrop-blur-0 bg-black/0"
        }`}
      />

      {/* Centered card */}
      <div
        className={`relative transition-all duration-300 ease-out w-[75%] ${
          visible
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4"
        }`}
      >
        <div className="rounded-xl bg-card/95 backdrop-blur-md ring-1 ring-border/50 shadow-2xl overflow-hidden">
          {/* Accent top border */}
          <div
            className="h-[2px] w-full"
            style={{ background: `var(--${accentColor})` }}
          />

          <div className="px-4 py-3 flex items-center gap-3">
            {/* Info */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FlaskConical size={14} className="text-success shrink-0" />
              <div className="min-w-0">
                <span className="text-xs font-medium text-foreground">
                  Research complete
                </span>
                {mcpSummary ? (
                  <p className="text-[11px] text-dim-foreground truncate mt-0.5">
                    {mcpSummary}
                  </p>
                ) : task ? (
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {task.title}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="color"
                color={accentColor}
                size="sm"
                onClick={handleContinue}
                leftIcon={<ArrowRight className="size-3.5" />}
                hoverEffect="scale-glow"
                clickEffect="scale"
                className="h-7 text-[12px]"
              >
                Continue to Implementation
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                className="h-7 w-7 p-0 text-muted-foreground"
                title="Dismiss"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
