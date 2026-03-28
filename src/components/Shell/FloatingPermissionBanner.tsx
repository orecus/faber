import { ShieldAlert } from "lucide-react";
import { memo, useCallback, useMemo } from "react";

import { useAppStore } from "../../store/appStore";

/**
 * FloatingPermissionBanner — global fixed-position banner that appears
 * when any ACP session has pending permission requests.
 *
 * Visible from ANY view (Dashboard, GitHub, etc.), not just Sessions.
 * Clicking navigates to the Sessions view to handle the request.
 */
export default memo(function FloatingPermissionBanner() {
  const acpPermissionRequests = useAppStore((s) => s.acpPermissionRequests);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const sessions = useAppStore((s) => s.sessions);

  // Collect all pending requests across all sessions
  const pendingEntries = useMemo(() => {
    const entries: { sessionId: string; sessionName: string; count: number }[] =
      [];
    for (const [sessionId, requests] of Object.entries(
      acpPermissionRequests,
    )) {
      if (requests && requests.length > 0) {
        const session = sessions.find((s) => s.id === sessionId);
        entries.push({
          sessionId,
          sessionName: session?.name || session?.agent || "Session",
          count: requests.length,
        });
      }
    }
    return entries;
  }, [acpPermissionRequests, sessions]);

  const totalCount = useMemo(
    () => pendingEntries.reduce((sum, e) => sum + e.count, 0),
    [pendingEntries],
  );

  const handleClick = useCallback(() => {
    // Navigate to sessions view where the permission dialogs live
    setActiveView("sessions");
  }, [setActiveView]);

  // Don't show if no pending requests, or if already on sessions view
  // (the inline PermissionDialog in ChatPane is visible there)
  if (totalCount === 0 || activeView === "sessions") return null;

  return (
    <button
      onClick={handleClick}
      role="alert"
      aria-label={totalCount === 1 ? `${pendingEntries[0].sessionName} needs permission — click to review` : `${totalCount} permission requests waiting — click to review`}
      className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-full backdrop-blur-md bg-warning/90 ring-1 ring-warning/60 shadow-lg shadow-warning/20 cursor-pointer hover:bg-warning hover:shadow-xl hover:shadow-warning/30 transition-all duration-200 animate-in slide-in-from-top-4 fade-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Pulsing dot */}
      <span className="relative flex size-2.5">
        <span className="absolute inset-0 rounded-full bg-white/80 animate-ping" />
        <span className="relative rounded-full size-2.5 bg-white" />
      </span>

      <ShieldAlert size={15} className="text-warning-foreground shrink-0" />

      <span className="text-xs font-semibold text-warning-foreground whitespace-nowrap">
        {totalCount === 1
          ? `${pendingEntries[0].sessionName} needs permission`
          : `${totalCount} permission requests waiting`}
      </span>

      <span className="text-2xs font-medium text-warning-foreground/70 whitespace-nowrap">
        Click to review
      </span>
    </button>
  );
});
