import {
  Check,
  Clock,
  Eye,
  Loader2,
  Pencil,
  Shield,
  ShieldAlert,
  Terminal,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { Checkbox } from "../ui/checkbox";
import { useAppStore } from "../../store/appStore";
import type { AcpPermissionRequest } from "../../types";

// ── Capability → icon/label/color mapping ──

const CAPABILITY_CONFIG: Record<
  string,
  {
    icon: React.ElementType;
    label: string;
    accent: string;
    iconBg: string;
    borderAccent: string;
  }
> = {
  fs_read: {
    icon: Eye,
    label: "Read File",
    accent: "text-blue-400",
    iconBg: "bg-blue-500/15 ring-1 ring-blue-500/25",
    borderAccent: "ring-blue-500/30",
  },
  fs_write: {
    icon: Pencil,
    label: "Write File",
    accent: "text-amber-400",
    iconBg: "bg-amber-500/15 ring-1 ring-amber-500/25",
    borderAccent: "ring-amber-500/30",
  },
  terminal: {
    icon: Terminal,
    label: "Run Command",
    accent: "text-orange-400",
    iconBg: "bg-orange-500/15 ring-1 ring-orange-500/25",
    borderAccent: "ring-orange-500/30",
  },
};

const FALLBACK_CONFIG = {
  icon: Shield,
  label: "Permission",
  accent: "text-warning",
  iconBg: "bg-warning/15 ring-1 ring-warning/25",
  borderAccent: "ring-warning/30",
};

// ── Timeout ──

const DEFAULT_TIMEOUT_SECONDS = 120;

// ── Single Permission Request Card ──

interface PermissionCardProps {
  request: AcpPermissionRequest;
  sessionId: string;
  projectId: string | null;
  /** Configurable timeout in seconds (from project settings). */
  timeoutSeconds: number;
}

const PermissionCard = React.memo(function PermissionCard({
  request,
  sessionId,
  projectId,
  timeoutSeconds,
}: PermissionCardProps) {
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const [responding, setResponding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const removeRequest = useAppStore((s) => s.removeAcpPermissionRequest);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      const secs = Math.floor((Date.now() - startRef.current) / 1000);
      setElapsed(secs);
      if (secs >= timeoutSeconds) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [timeoutSeconds]);

  const remaining = Math.max(0, timeoutSeconds - elapsed);
  const progress = (remaining / timeoutSeconds) * 100;
  const isUrgent = remaining <= 30;
  const isExpired = remaining === 0;

  const respond = useCallback(
    async (approved: boolean) => {
      if (responding) return;
      setResponding(true);
      try {
        await invoke("respond_permission", {
          sessionId,
          requestId: request.request_id,
          approved,
          alwaysAllow: alwaysAllow && approved,
          capability: request.capability,
          pathPattern: null,
          projectId,
        });
        removeRequest(sessionId, request.request_id);
      } catch (e) {
        console.error("Failed to respond to permission request:", e);
        setResponding(false);
      }
    },
    [
      responding,
      sessionId,
      request.request_id,
      request.capability,
      alwaysAllow,
      projectId,
      removeRequest,
    ],
  );

  const config = CAPABILITY_CONFIG[request.capability] ?? FALLBACK_CONFIG;
  const Icon = config.icon;

  return (
    <div
      className={`relative overflow-hidden rounded-lg ring-2 transition-all duration-300 ${
        isExpired
          ? "ring-muted/30 opacity-60"
          : isUrgent
            ? "ring-destructive/50 shadow-md shadow-destructive/10"
            : config.borderAccent + " shadow-sm"
      } bg-card`}
    >
      {/* Timeout progress bar — prominent strip at top */}
      <div className="absolute top-0 inset-x-0 h-1 bg-border/20">
        <div
          className={`h-full transition-all duration-1000 linear ${
            isExpired
              ? "bg-muted/40"
              : isUrgent
                ? "bg-destructive animate-pulse"
                : "bg-primary/60"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="px-4 pt-4 pb-3">
        {/* Header: shield icon + capability + timer */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`flex items-center justify-center size-8 rounded-lg ${config.iconBg} ${config.accent}`}
            >
              <Icon size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <ShieldAlert size={12} className="text-warning shrink-0" />
                <span className="text-xs font-bold uppercase tracking-wider text-warning">
                  Permission Required
                </span>
              </div>
              <span className="text-xs text-muted-foreground font-medium">
                {config.label}
              </span>
            </div>
          </div>
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono tabular-nums ${
              isExpired
                ? "bg-muted/40 text-muted-foreground"
                : isUrgent
                  ? "bg-destructive/15 text-destructive font-semibold animate-pulse"
                  : "bg-muted/40 text-muted-foreground"
            }`}
          >
            <Clock size={11} />
            <span>
              {Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, "0")}
            </span>
          </div>
        </div>

        {/* Description — prominent */}
        <p className="text-sm text-foreground font-medium leading-snug mb-1.5">
          {request.description || "Agent is requesting permission"}
        </p>

        {/* Detail — file path or command (highlighted) */}
        {request.detail && request.detail !== request.description && (
          <div className="font-mono text-xs text-foreground/80 bg-muted/50 rounded-md px-3 py-2 mb-3 ring-1 ring-border/30 break-all">
            {request.detail}
          </div>
        )}

        {/* Actions row — large, clear buttons */}
        <div className="flex items-center justify-between gap-3 mt-2">
          {/* Always allow checkbox */}
          <label className="flex items-center gap-2 cursor-pointer select-none group/check">
            <Checkbox
              checked={alwaysAllow}
              onCheckedChange={(checked) => setAlwaysAllow(checked === true)}
              className="size-4"
            />
            <span className="text-xs text-muted-foreground group-hover/check:text-foreground transition-colors">
              Always allow
            </span>
          </label>

          {/* Approve / Deny buttons — larger and more prominent */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => respond(false)}
              disabled={responding || isExpired}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold text-muted-foreground hover:text-destructive hover:bg-destructive/10 ring-1 ring-border/40 hover:ring-destructive/30 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {responding ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <X size={13} />
              )}
              Deny
            </button>
            <button
              onClick={() => respond(true)}
              disabled={responding || isExpired}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-success-foreground bg-success/20 hover:bg-success/30 ring-1 ring-success/30 hover:ring-success/50 shadow-sm shadow-success/10 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {responding ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// ── Permission Dialog List (rendered per-session in ChatPane) ──

interface PermissionDialogProps {
  sessionId: string;
}

export default React.memo(function PermissionDialog({
  sessionId,
}: PermissionDialogProps) {
  const requests = useAppStore(
    (s) => s.acpPermissionRequests[sessionId] ?? EMPTY,
  );
  const session = useAppStore((s) =>
    s.sessions.find((sess) => sess.id === sessionId),
  );
  const projectId = session?.project_id ?? null;

  // Load configurable timeout from settings
  const [timeoutSeconds, setTimeoutSeconds] = useState(DEFAULT_TIMEOUT_SECONDS);
  useEffect(() => {
    if (!projectId) return;
    invoke<string | null>("get_project_setting", {
      projectId,
      key: "acp_permission_timeout",
    })
      .then((val) => {
        if (val) {
          const parsed = parseInt(val, 10);
          if (parsed > 0) setTimeoutSeconds(parsed);
        }
      })
      .catch(() => {
        // Ignore — use default
      });
  }, [projectId]);

  if (requests.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3 border-b-2 border-warning/30 bg-warning/[0.03]">
      {requests.map((req) => (
        <PermissionCard
          key={req.request_id}
          request={req}
          sessionId={sessionId}
          projectId={projectId}
          timeoutSeconds={timeoutSeconds}
        />
      ))}
    </div>
  );
});

const EMPTY: AcpPermissionRequest[] = [];
