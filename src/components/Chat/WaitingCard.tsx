import { CircleHelp, X } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { useAppStore } from "../../store/appStore";

interface WaitingCardProps {
  sessionId: string;
}

/**
 * WaitingCard — slides up above the ChatInput when the agent reports
 * a "waiting" MCP state (e.g. needs user clarification).
 *
 * Auto-appears when mcpStatus[sessionId].waiting is true.
 * Dismissible, but reappears if a new waiting event fires.
 */
export default React.memo(function WaitingCard({
  sessionId,
}: WaitingCardProps) {
  const waiting = useAppStore((s) => s.mcpStatus[sessionId]?.waiting ?? false);
  const question = useAppStore(
    (s) => s.mcpStatus[sessionId]?.waiting_question ?? "",
  );

  const [dismissed, setDismissed] = useState(false);
  // Track the question we dismissed so we can re-show on a *new* question
  const [dismissedQuestion, setDismissedQuestion] = useState("");

  // Re-show when a new waiting question arrives
  useEffect(() => {
    if (waiting && question && question !== dismissedQuestion) {
      setDismissed(false);
    }
  }, [waiting, question, dismissedQuestion]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setDismissedQuestion(question);
  }, [question]);

  const visible = waiting && question && !dismissed;

  return (
    <div
      className={`overflow-hidden transition-all duration-300 ease-out ${
        visible
          ? "max-h-40 opacity-100 translate-y-0"
          : "max-h-0 opacity-0 translate-y-2"
      }`}
    >
      <div className="mx-3 mt-1 mb-2">
        <div className="flex items-start gap-2.5 rounded-lg bg-warning/10 ring-1 ring-warning/25 px-3 py-2.5">
          {/* Icon */}
          <div className="flex items-center justify-center shrink-0 mt-0.5">
            <CircleHelp size={14} className="text-warning" />
          </div>

          {/* Question text */}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-warning/80 uppercase tracking-wider mb-0.5">
              Waiting for input
            </p>
            <p className="text-xs text-foreground leading-relaxed">
              {question}
            </p>
          </div>

          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-warning/10 transition-colors"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
});
