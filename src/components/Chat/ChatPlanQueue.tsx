import { ListChecks } from "lucide-react";
import React, { useMemo } from "react";

import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";

import { useAppStore } from "../../store/appStore";

interface ChatPlanQueueProps {
  sessionId: string;
}

export default React.memo(function ChatPlanQueue({
  sessionId,
}: ChatPlanQueueProps) {
  const planEntries = useAppStore((s) => s.acpPlans[sessionId]);

  const completedCount = useMemo(
    () => (planEntries ?? []).filter((e) => e.status === "completed").length,
    [planEntries],
  );

  if (!planEntries || planEntries.length === 0) return null;

  const progressPercent = (completedCount / planEntries.length) * 100;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex justify-center pointer-events-none">
      <Queue className="w-3/4 rounded-b-none border-b-0 shadow-lg bg-card/80 backdrop-blur-md pointer-events-auto">
        <QueueSection defaultOpen>
          <QueueSectionTrigger>
            <QueueSectionLabel
              count={planEntries.length}
              label="Tasks"
              icon={<ListChecks className="size-3.5" />}
            />
            <div className="flex items-center gap-2.5 flex-1 justify-end">
              <div className="h-1.5 flex-1 max-w-24 rounded-full bg-muted/50 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground/60 tabular-nums">
                {completedCount}/{planEntries.length}
              </span>
            </div>
          </QueueSectionTrigger>
          <QueueSectionContent>
            <QueueList>
              {planEntries.map((entry) => (
                <QueueItem
                  key={entry.id}
                  className={
                    entry.status === "in_progress"
                      ? "bg-primary/5"
                      : undefined
                  }
                >
                  <div className="flex items-center gap-2">
                    <QueueItemIndicator
                      completed={entry.status === "completed"}
                      className={
                        entry.status === "in_progress"
                          ? "border-primary bg-primary/20 animate-pulse"
                          : undefined
                      }
                    />
                    <QueueItemContent
                      completed={entry.status === "completed"}
                      className={
                        entry.status === "in_progress"
                          ? "text-foreground font-medium"
                          : undefined
                      }
                    >
                      {entry.title}
                    </QueueItemContent>
                  </div>
                </QueueItem>
              ))}
            </QueueList>
          </QueueSectionContent>
        </QueueSection>
      </Queue>
    </div>
  );
});
