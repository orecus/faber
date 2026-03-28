import React from "react";

/** Format an ISO 8601 timestamp into a human-readable "resets in …" string. */
export function formatResetTime(isoTimestamp: string | null): string | null {
  if (!isoTimestamp) return null;

  try {
    const resetDate = new Date(isoTimestamp);
    const now = Date.now();
    const diffMs = resetDate.getTime() - now;

    if (diffMs <= 0) return "resetting…";

    const minutes = Math.floor(diffMs / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remainingHours = hours % 24;
      return remainingHours > 0
        ? `resets in ${days}d ${remainingHours}h`
        : `resets in ${days}d`;
    }
    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0
        ? `resets in ${hours}h ${remainingMinutes}m`
        : `resets in ${hours}h`;
    }
    return `resets in ${minutes}m`;
  } catch {
    return null;
  }
}

/** Resolve the bar color class based on utilization percentage. */
function barColorClass(utilization: number): string {
  if (utilization >= 80) return "bg-destructive";
  if (utilization >= 50) return "bg-warning";
  return "bg-success";
}

/** Resolve the text color class based on utilization percentage. */
function textColorClass(utilization: number): string {
  if (utilization >= 80) return "text-destructive";
  if (utilization >= 50) return "text-warning";
  return "text-dim-foreground";
}

interface UsageProgressBarProps {
  label: string;
  utilization: number;
  resetTime: string | null;
}

const UsageProgressBar = React.memo(function UsageProgressBar({
  label,
  utilization,
  resetTime,
}: UsageProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, utilization));
  const resetLabel = formatResetTime(resetTime);

  return (
    <div className="px-3 py-0.5">
      {/* Label row */}
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-2xs text-dim-foreground truncate">
          {label}
          <span className={`ml-1 text-xs font-medium ${textColorClass(clamped)}`}>
            {Math.round(clamped)}%
          </span>
        </span>
        {resetLabel && (
          <span className="text-2xs text-muted-foreground shrink-0">
            {resetLabel}
          </span>
        )}
      </div>
      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-accent/50 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${barColorClass(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
});

export default UsageProgressBar;
