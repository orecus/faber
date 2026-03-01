import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import type { Session } from "../../types";
import { Badge } from "../ui/badge";
import { borderAccentColors } from "../ui/orecus.io/lib/color-utils";

const MODE_LABEL: Record<string, string> = { task: "T", vibe: "V", shell: "S", research: "R" };

export default function SessionDragOverlay({ session }: { session: Session }) {
  const accentColor = useProjectAccentColor();
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-[var(--radius-panel)] border ${borderAccentColors[accentColor]} bg-popover shadow-lg cursor-grabbing`}>
      <Badge
        variant="secondary"
        className="h-[18px] w-[18px] p-0 text-[10px] font-semibold rounded-[3px] bg-accent text-dim-foreground"
      >
        {MODE_LABEL[session.mode] ?? "?"}
      </Badge>
      <span className="text-xs text-foreground">{session.agent}</span>
    </div>
  );
}
