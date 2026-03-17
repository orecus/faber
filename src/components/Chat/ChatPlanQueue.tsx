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

  return (
    <Queue className="mx-3 mb-0 rounded-b-none border-b-0 shadow-none">
      <QueueSection defaultOpen>
        <QueueSectionTrigger>
          <QueueSectionLabel
            count={planEntries.length}
            label="Tasks"
            icon={<ListChecks className="size-3.5" />}
          />
          <span className="text-xs text-muted-foreground/60 tabular-nums">
            {completedCount}/{planEntries.length}
          </span>
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
  );
});
