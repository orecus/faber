import type { SessionStatus } from "../../types";

const STATUS_COLORS: Record<string, string> = {
  starting: "var(--warning)",
  running: "var(--success)",
  paused: "var(--muted-foreground)",
  stopped: "var(--muted-foreground)",
  finished: "var(--dim-foreground)",
  error: "var(--destructive)",
};

export default function LiveStatusIndicator({ status }: { status: SessionStatus }) {
  const isActive = status === "running" || status === "starting";
  return (
    <span
      title={status}
      className={`inline-block w-[7px] h-[7px] rounded-full shrink-0 ${isActive ? "animate-pulse" : ""}`}
      style={{ background: STATUS_COLORS[status] ?? "var(--muted-foreground)" }}
    />
  );
}
