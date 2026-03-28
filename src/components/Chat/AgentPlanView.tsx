import {
  CheckCircle2,
  Circle,
  Loader2,
} from "lucide-react";
import React from "react";

import {
  Plan,
  PlanAction,
  PlanContent,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/plan";

import type { AcpPlanEntry } from "../../types";

function PlanStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "in_progress":
      return <Loader2 size={14} className="animate-spin text-primary shrink-0" />;
    case "completed":
      return <CheckCircle2 size={14} className="text-success shrink-0" />;
    default:
      return <Circle size={14} className="text-muted-foreground/50 shrink-0" />;
  }
}

interface AgentPlanViewProps {
  entries: AcpPlanEntry[];
  isStreaming?: boolean;
}

export default React.memo(function AgentPlanView({
  entries,
  isStreaming = false,
}: AgentPlanViewProps) {
  const completedCount = entries.filter((e) => e.status === "completed").length;
  const hasActive = entries.some((e) => e.status === "in_progress");

  return (
    <Plan defaultOpen isStreaming={isStreaming} className="rounded-none border-x-0 border-t-0">
      <PlanHeader>
        <PlanTitle>
          {`Plan — ${completedCount}/${entries.length} completed`}
        </PlanTitle>
        <PlanAction>
          <PlanTrigger />
        </PlanAction>
      </PlanHeader>
      <PlanContent>
        <div className="space-y-1">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`flex items-start gap-2 rounded-md px-2 py-1 ${
                entry.status === "in_progress" ? "bg-blue-500/5" : ""
              }`}
            >
              <div className="mt-0.5">
                <PlanStatusIcon status={entry.status} />
              </div>
              <span
                className={`text-sm leading-snug ${
                  entry.status === "completed"
                    ? "text-muted-foreground line-through"
                    : entry.status === "in_progress"
                      ? "text-foreground font-medium"
                      : "text-dim-foreground"
                }`}
              >
                {entry.title}
              </span>
            </div>
          ))}
          {hasActive && (
            <div className="mt-2 h-1 w-full rounded-full bg-muted/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{
                  width: `${entries.length > 0 ? (completedCount / entries.length) * 100 : 0}%`,
                }}
              />
            </div>
          )}
        </div>
      </PlanContent>
    </Plan>
  );
});
