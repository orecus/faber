import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Check,
  Copy,
  Radio,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAppStore } from "../../store/appStore";

import type { McpInfo } from "../../types";

function StatusRow({
  icon,
  label,
  right,
  className,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div
      onClick={onClick}
      title={title}
      className={`group/row flex items-center gap-2 px-3 h-6 text-xs text-dim-foreground min-w-0 ${onClick ? "cursor-pointer hover:bg-accent/40" : ""} ${className ?? ""}`}
    >
      <span className="inline-flex w-4 justify-center shrink-0">{icon}</span>
      <span className="truncate min-w-0 flex-1">{label}</span>
      {right && <span className="shrink-0 ml-auto">{right}</span>}
    </div>
  );
}

export default function SidebarStatusPanel() {
  const mcpActiveCount = useAppStore((s) => Object.keys(s.mcpStatus).length);
  const ghAuthStatus = useAppStore((s) => s.ghAuthStatus);

  // ── MCP info ──
  const [mcpInfo, setMcpInfo] = useState<McpInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshMcpInfo = useCallback(() => {
    invoke<McpInfo>("get_mcp_info")
      .then(setMcpInfo)
      .catch(() => setMcpInfo(null));
  }, []);

  useEffect(() => {
    refreshMcpInfo();
  }, [refreshMcpInfo]);
  const mcpOnline = mcpInfo != null && mcpInfo.port > 0;

  const handleCopyMcpPath = useCallback(() => {
    if (!mcpInfo?.sidecar_path) return;
    navigator.clipboard.writeText(mcpInfo.sidecar_path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [mcpInfo]);

  // ── gh auth warning ──
  const ghNotInstalled = ghAuthStatus && !ghAuthStatus.installed;
  const ghNotAuthenticated = ghAuthStatus && ghAuthStatus.installed && !ghAuthStatus.authenticated;
  const ghScopeWarning = ghAuthStatus?.has_scope_warnings ?? false;
  const showGhWarning = ghNotInstalled || ghNotAuthenticated || ghScopeWarning;

  const ghWarningText = ghNotInstalled
    ? "gh not installed"
    : ghNotAuthenticated
      ? "gh not authenticated"
      : ghScopeWarning
        ? "gh: missing scopes"
        : null;

  const ghWarningTooltip = ghNotInstalled
    ? "GitHub CLI (gh) is not installed. Install it to enable push, PR creation, and issue import."
    : ghNotAuthenticated
      ? "GitHub CLI is not authenticated. Run `gh auth login` to enable push, PR creation, and issue import."
      : ghScopeWarning
        ? `Token is missing required scopes: ${ghAuthStatus!.missing_scopes.join(", ")}. Some GitHub features may fail.`
        : undefined;

  // Scope warnings use amber/warning color; not-installed/not-authed use destructive/red
  const ghWarningIsScopeOnly = ghScopeWarning && !ghNotInstalled && !ghNotAuthenticated;

  return (
    <div className="shrink-0 py-1.5">
      {/* MCP */}
      {mcpOnline ? (
        <StatusRow
          icon={<Radio size={14} className="text-success" />}
          onClick={handleCopyMcpPath}
          title="Click to copy MCP sidecar path"
          label={
            <span>
              MCP :{mcpInfo.port}
              {mcpActiveCount > 0 && (
                <span className="ml-1 text-muted-foreground">
                  ({mcpActiveCount})
                </span>
              )}
            </span>
          }
          right={
            copied ? (
              <Check size={12} className="text-success" />
            ) : (
              <Copy
                size={12}
                className="opacity-30 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity text-muted-foreground"
              />
            )
          }
        />
      ) : (
        <StatusRow
          icon={<Radio size={14} />}
          label="MCP offline"
          className="text-muted-foreground"
        />
      )}

      {/* gh warning */}
      {showGhWarning && ghWarningText && (
        <StatusRow
          icon={<AlertTriangle size={14} className={ghWarningIsScopeOnly ? "text-warning" : "text-destructive"} />}
          label={
            <span className={ghWarningIsScopeOnly ? "text-warning" : "text-destructive"} title={ghWarningTooltip}>
              {ghWarningText}
            </span>
          }
        />
      )}
    </div>
  );
}
