import type { Priority } from "../../types";
import { Badge } from "../ui/badge";

const PRIORITY_COLORS: Record<Priority, string> = {
  P0: "text-destructive",
  P1: "text-warning",
  P2: "text-muted-foreground",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  P0: "P0 — Critical",
  P1: "P1 — High",
  P2: "P2 — Normal",
};

export default function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge
      variant="secondary"
      title={PRIORITY_LABELS[priority]}
      className={`h-auto py-px px-1.5 text-[10px] font-bold tracking-wide rounded-[var(--radius-element)] bg-accent ${PRIORITY_COLORS[priority]}`}
    >
      {priority}
    </Badge>
  );
}
