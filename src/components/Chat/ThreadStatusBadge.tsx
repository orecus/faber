import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Loader2,
  Square,
  XCircle,
} from "lucide-react";
import React from "react";

import { useAppStore } from "../../store/appStore";

/**
 * ThreadStatusBadge — compact inline status pill for use in toolbars.
 * Shows the current ACP conversation state with icon + label.
 */

interface ThreadStatusBadgeProps {
  sessionId: string;
  sessionStatus: string;
}

type ThreadState = {
  label: string;
  icon: React.ReactNode;
  colorClass: string;
  animate?: boolean;
};

function getThreadState(
  sessionStatus: string,
  promptPending: boolean,
  hasPermissionRequests: boolean,
): ThreadState {
  if (hasPermissionRequests) {
    return {
      label: "Waiting",
      icon: <AlertCircle size={11} />,
      colorClass: "text-warning",
      animate: true,
    };
  }

  switch (sessionStatus) {
    case "starting":
      return {
        label: "Connecting",
        icon: <Loader2 size={11} className="animate-spin" />,
        colorClass: "text-muted-foreground",
      };
    case "running":
      if (promptPending) {
        return {
          label: "Working",
          icon: <Loader2 size={11} className="animate-spin" />,
          colorClass: "text-primary",
          animate: true,
        };
      }
      return {
        label: "Ready",
        icon: <CircleDot size={11} />,
        colorClass: "text-success",
      };
    case "error":
      return {
        label: "Error",
        icon: <XCircle size={11} />,
        colorClass: "text-destructive",
      };
    case "finished":
      return {
        label: "Completed",
        icon: <CheckCircle2 size={11} />,
        colorClass: "text-muted-foreground",
      };
    case "stopped":
      return {
        label: "Stopped",
        icon: <Square size={11} />,
        colorClass: "text-muted-foreground",
      };
    default:
      return {
        label: sessionStatus,
        icon: <CircleDot size={11} />,
        colorClass: "text-muted-foreground",
      };
  }
}

export default React.memo(function ThreadStatusBadge({
  sessionId,
  sessionStatus,
}: ThreadStatusBadgeProps) {
  const promptPending = useAppStore(
    (s) => s.acpPromptPending[sessionId] ?? false,
  );
  const hasPermissionRequests = useAppStore(
    (s) => (s.acpPermissionRequests[sessionId] ?? []).length > 0,
  );

  const state = getThreadState(sessionStatus, promptPending, hasPermissionRequests);

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium ${state.colorClass} ${
        state.animate ? "animate-pulse" : ""
      } bg-muted/40`}
    >
      {state.icon}
      {state.label}
    </span>
  );
});
