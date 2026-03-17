import React from "react";

import { useAppStore } from "../../store/appStore";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextTrigger,
} from "../ai-elements/context";

/**
 * ContextUsageIndicator — compact context window usage pill for chat toolbars.
 *
 * Shows a circular progress icon + percentage that expands on hover into a
 * detailed card with token breakdown and cost (powered by ACP UsageUpdate).
 * Uses the ai-elements Context component family.
 */

interface ContextUsageIndicatorProps {
  sessionId: string;
}

export default React.memo(function ContextUsageIndicator({
  sessionId,
}: ContextUsageIndicatorProps) {
  const usage = useAppStore((s) => s.acpUsage[sessionId]);

  // Don't render until we've received at least one UsageUpdate
  if (!usage || usage.size === 0) return null;

  const hasCost = usage.cost_amount != null && usage.cost_amount > 0;

  return (
    <Context usedTokens={usage.used} maxTokens={usage.size}>
      <ContextTrigger className="h-7 px-2 gap-1.5 text-[11px] rounded-md cursor-default" />
      <ContextContent side="top" align="end" className="w-64">
        <ContextContentHeader />
        {hasCost && (
          <ContextContentBody className="py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Session cost</span>
              <span className="font-medium tabular-nums">
                {formatCost(usage.cost_amount!, usage.cost_currency)}
              </span>
            </div>
          </ContextContentBody>
        )}
      </ContextContent>
    </Context>
  );
});

/** Format cost amount with currency. */
function formatCost(amount: number, currency?: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}
