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
 * detailed card with token breakdown and cost (powered by ACP UsageUpdate +
 * PromptResponse token usage).
 * Uses the ai-elements Context component family.
 */

interface ContextUsageIndicatorProps {
  sessionId: string;
}

/** Format a token count compactly (e.g. 12345 → "12.3K"). */
function formatTokens(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
}

/** Format cost amount with currency. */
function formatCost(amount: number, currency?: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export default React.memo(function ContextUsageIndicator({
  sessionId,
}: ContextUsageIndicatorProps) {
  const usage = useAppStore((s) => s.acpUsage[sessionId]);
  const tokenUsage = useAppStore((s) => s.acpTokenUsage[sessionId]);

  // Don't render until we've received at least one UsageUpdate
  if (!usage || usage.size === 0) return null;

  const hasCost = usage.cost_amount != null && usage.cost_amount > 0;
  const hasTokens = tokenUsage && tokenUsage.total_tokens > 0;

  return (
    <Context usedTokens={usage.used} maxTokens={usage.size}>
      <ContextTrigger className="h-7 px-2 gap-1.5 text-xs rounded-md cursor-default" />
      <ContextContent side="top" align="end" className="w-64">
        <ContextContentHeader />
        {hasTokens && (
          <ContextContentBody className="space-y-1.5 py-2">
            <TokenRow label="Input" tokens={tokenUsage.input_tokens} />
            <TokenRow label="Output" tokens={tokenUsage.output_tokens} />
            {tokenUsage.thought_tokens != null && tokenUsage.thought_tokens > 0 && (
              <TokenRow label="Reasoning" tokens={tokenUsage.thought_tokens} />
            )}
            {tokenUsage.cached_read_tokens != null && tokenUsage.cached_read_tokens > 0 && (
              <TokenRow label="Cache read" tokens={tokenUsage.cached_read_tokens} />
            )}
            {tokenUsage.cached_write_tokens != null && tokenUsage.cached_write_tokens > 0 && (
              <TokenRow label="Cache write" tokens={tokenUsage.cached_write_tokens} />
            )}
          </ContextContentBody>
        )}
        {hasCost && (
          <ContextContentBody className="py-2 border-t border-border/40">
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

/** A single row in the token breakdown. */
function TokenRow({ label, tokens }: { label: string; tokens: number }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{formatTokens(tokens)}</span>
    </div>
  );
}
