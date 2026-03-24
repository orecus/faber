import type { Priority } from "../../types";
import { useAppStore } from "../../store/appStore";
import { DEFAULT_PRIORITIES } from "../../lib/priorities";
import { getPriorityLabel, getPriorityTextClass } from "../../lib/priorities";
import { Badge } from "../ui/badge";

export default function PriorityBadge({ priority }: { priority: Priority }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const priorities = useAppStore((s) =>
    activeProjectId ? (s.projectPriorities[activeProjectId] ?? DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES
  );

  return (
    <Badge
      variant="secondary"
      title={getPriorityLabel(priority, priorities)}
      className={`h-auto py-px px-1.5 text-[10px] font-bold tracking-wide rounded-[var(--radius-element)] bg-accent ${getPriorityTextClass(priority, priorities)}`}
    >
      {priority}
    </Badge>
  );
}
