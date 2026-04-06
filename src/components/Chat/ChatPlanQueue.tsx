import { CheckCircle2, Circle, ListChecks, Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useRef } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { useAppStore } from "../../store/appStore";

import type { AcpPlanEntry } from "../../types";

// ── Timing tracker ──

/** Frontend-only timing: records when each plan entry started and completed. */
interface EntryTiming {
  startedAt?: number;
  completedAt?: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

// ── Component ──

interface ChatPlanQueueProps {
  sessionId: string;
}

export default React.memo(function ChatPlanQueue({
  sessionId,
}: ChatPlanQueueProps) {
  const planEntries = useAppStore((s) => s.acpPlans[sessionId]);

  // Track per-entry timing by comparing status transitions across renders
  const timingsRef = useRef<Map<string, EntryTiming>>(new Map());

  useEffect(() => {
    if (!planEntries) return;
    const now = Date.now();
    const timings = timingsRef.current;

    for (const entry of planEntries) {
      const existing = timings.get(entry.id);

      if (entry.status === "in_progress") {
        if (!existing?.startedAt) {
          timings.set(entry.id, { ...existing, startedAt: now });
        }
      } else if (entry.status === "completed") {
        if (!existing?.completedAt) {
          timings.set(entry.id, {
            startedAt: existing?.startedAt ?? now,
            completedAt: now,
          });
        }
      }
    }
  }, [planEntries]);

  const completedCount = useMemo(
    () => (planEntries ?? []).filter((e) => e.status === "completed").length,
    [planEntries],
  );

  if (!planEntries || planEntries.length === 0) return null;

  const progressPercent = (completedCount / planEntries.length) * 100;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex justify-center pointer-events-none">
      <Collapsible defaultOpen className="w-3/4 pointer-events-auto">
        {/* Container — matches PromptInput's border-input styling with glass effect */}
        <div className="flex flex-col rounded-t-lg border border-b-0 border-input bg-card/60 backdrop-blur-md overflow-hidden">
          {/* Header / trigger */}
          <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <ListChecks className="size-3.5 shrink-0" />
            <span>Plan</span>

            {/* Progress bar + count — right side */}
            <div className="flex items-center gap-2 flex-1 justify-end">
              <div className="h-1 flex-1 max-w-20 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-2xs text-muted-foreground/60 tabular-nums">
                {completedCount}/{planEntries.length}
              </span>
            </div>
          </CollapsibleTrigger>

          {/* Collapsible task list */}
          <CollapsibleContent className="overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
            <ScrollArea>
              <ul className="max-h-36 px-1 pb-1.5">
                {planEntries.map((entry) => (
                  <PlanItem
                    key={entry.id}
                    entry={entry}
                    timing={timingsRef.current.get(entry.id)}
                  />
                ))}
              </ul>
            </ScrollArea>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
});

// ── Plan item ──

function PlanItem({
  entry,
  timing,
}: {
  entry: AcpPlanEntry;
  timing?: EntryTiming;
}) {
  const isCompleted = entry.status === "completed";
  const isInProgress = entry.status === "in_progress";

  // Compute elapsed duration for completed items
  const durationLabel = useMemo(() => {
    if (!isCompleted || !timing?.startedAt || !timing?.completedAt) return null;
    const ms = timing.completedAt - timing.startedAt;
    // Only show if it took at least 1 second (avoid noise)
    return ms >= 1000 ? formatDuration(ms) : null;
  }, [isCompleted, timing?.startedAt, timing?.completedAt]);

  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
        isInProgress && "bg-primary/5",
      )}
    >
      <PlanItemIcon status={entry.status} />
      <span
        className={cn(
          "flex-1 min-w-0 truncate",
          isCompleted && "text-muted-foreground/50 line-through",
          isInProgress && "text-foreground font-medium",
          !isCompleted && !isInProgress && "text-muted-foreground",
        )}
      >
        {entry.title}
      </span>
      {durationLabel && (
        <span className="shrink-0 text-2xs text-muted-foreground/40 tabular-nums">
          {durationLabel}
        </span>
      )}
    </li>
  );
}

function PlanItemIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 size={13} className="shrink-0 text-success" />;
    case "in_progress":
      return <Loader2 size={13} className="shrink-0 animate-spin text-primary" />;
    default:
      return <Circle size={13} className="shrink-0 text-muted-foreground/30" />;
  }
}
