import { invoke } from "@tauri-apps/api/core";
import {
  Eye,
  FolderCode,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Shield,
  Terminal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAppStore } from "../../store/appStore";
import { Badge } from "../ui/badge";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { sectionHeadingClass, inputClass } from "./shared";

import type { PermissionRule, PermissionLogEntry, PermissionAction } from "../../types";

// ── Capability options ──

const CAPABILITIES = [
  { value: "fs_read", label: "File Read", icon: Eye },
  { value: "fs_write", label: "File Write", icon: Pencil },
  { value: "terminal", label: "Terminal", icon: Terminal },
  { value: "*", label: "All", icon: Shield },
];

const ACTION_LABELS: Record<PermissionAction, { label: string; color: string }> = {
  auto_approve: { label: "Auto-Approve", color: "text-green-500" },
  ask: { label: "Ask", color: "text-yellow-500" },
  deny: { label: "Deny", color: "text-red-500" },
};

const TRUST_MODE_OPTIONS = [
  {
    value: "auto_approve",
    label: "Auto-approve all",
    description: "All file and terminal operations are approved without prompts.",
  },
  {
    value: "normal",
    label: "Apply rules normally",
    description: "Evaluate rules as usual. \"Ask\" rules will still prompt (session pauses until answered).",
  },
  {
    value: "deny_writes",
    label: "Read-only",
    description: "Auto-approve file reads, deny file writes and terminal commands.",
  },
];

/** Returns the contextual pattern field config based on capability */
function getPatternConfig(capability: string) {
  if (capability === "terminal") {
    return { label: "Command pattern", placeholder: "e.g. npm test", field: "command" as const };
  }
  return { label: "Path pattern", placeholder: "e.g. src/**", field: "path" as const };
}

// ── Component ──

export function AcpPermissionsTab() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);

  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [log, setLog] = useState<PermissionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [trustModePolicy, setTrustModePolicy] = useState("auto_approve");
  const [defaultPolicy, setDefaultPolicy] = useState<PermissionAction>("ask");

  // New rule form state
  const [newCapability, setNewCapability] = useState("fs_read");
  const [newPattern, setNewPattern] = useState("");
  const [newAction, setNewAction] = useState<PermissionAction>("auto_approve");
  const [adding, setAdding] = useState(false);
  const [permissionTimeout, setPermissionTimeout] = useState(120);

  const loadData = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const [rulesData, logData, contPolicy, defPolicy, timeoutVal] = await Promise.all([
        invoke<PermissionRule[]>("list_permission_rules", {
          projectId: activeProjectId,
        }),
        invoke<PermissionLogEntry[]>("get_permission_log", {
          projectId: activeProjectId,
          limit: 20,
        }),
        invoke<string | null>("get_project_setting", {
          projectId: activeProjectId,
          key: "acp_trust_mode_policy",
        }).catch(() => null),
        invoke<string | null>("get_project_setting", {
          projectId: activeProjectId,
          key: "acp_default_policy",
        }).catch(() => null),
        invoke<string | null>("get_project_setting", {
          projectId: activeProjectId,
          key: "acp_permission_timeout",
        }).catch(() => null),
      ]);
      setRules(rulesData);
      setLog(logData);
      if (contPolicy) setTrustModePolicy(contPolicy);
      if (defPolicy) setDefaultPolicy(defPolicy as PermissionAction);
      if (timeoutVal) setPermissionTimeout(parseInt(timeoutVal, 10) || 120);
    } catch (e) {
      console.error("Failed to load permission data:", e);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addRule = useCallback(async () => {
    if (!activeProjectId) return;
    setAdding(true);
    const patternConfig = getPatternConfig(newCapability);
    const trimmed = newPattern.trim() || null;
    try {
      await invoke("create_permission_rule", {
        projectId: activeProjectId,
        capability: newCapability,
        pathPattern: patternConfig.field === "path" ? trimmed : null,
        commandPattern: patternConfig.field === "command" ? trimmed : null,
        action: newAction,
      });
      setNewPattern("");
      await loadData();
    } catch (e) {
      console.error("Failed to create rule:", e);
    } finally {
      setAdding(false);
    }
  }, [activeProjectId, newCapability, newPattern, newAction, loadData]);

  const deleteRule = useCallback(
    async (ruleId: string) => {
      try {
        await invoke("delete_permission_rule", { projectId: activeProjectId, ruleId });
        await loadData();
      } catch (e) {
        console.error("Failed to delete rule:", e);
      }
    },
    [activeProjectId, loadData],
  );

  const resetRules = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      await invoke("reset_permission_rules", {
        projectId: activeProjectId,
      });
      await loadData();
    } catch (e) {
      console.error("Failed to reset rules:", e);
    }
  }, [activeProjectId, loadData]);

  const updateTrustModePolicy = useCallback(
    async (value: string) => {
      if (!activeProjectId) return;
      setTrustModePolicy(value);
      try {
        await invoke("set_project_setting", {
          projectId: activeProjectId,
          key: "acp_trust_mode_policy",
          value,
        });
      } catch (e) {
        console.error("Failed to update trust mode policy:", e);
      }
    },
    [activeProjectId],
  );

  const updateDefaultPolicy = useCallback(
    async (value: string) => {
      if (!activeProjectId) return;
      setDefaultPolicy(value as PermissionAction);
      try {
        await invoke("set_project_setting", {
          projectId: activeProjectId,
          key: "acp_default_policy",
          value,
        });
      } catch (e) {
        console.error("Failed to update default policy:", e);
      }
    },
    [activeProjectId],
  );

  const updatePermissionTimeout = useCallback(
    async (seconds: number) => {
      if (!activeProjectId) return;
      const clamped = Math.max(10, Math.min(600, seconds));
      setPermissionTimeout(clamped);
      try {
        await invoke("set_project_setting", {
          projectId: activeProjectId,
          key: "acp_permission_timeout",
          value: String(clamped),
        });
      } catch (e) {
        console.error("Failed to update permission timeout:", e);
      }
    },
    [activeProjectId],
  );

  if (!activeProjectId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <FolderCode className="mb-3 size-10 opacity-30" />
        <p className="text-sm font-medium text-foreground">
          No project selected
        </p>
        <p className="mt-1 text-xs text-center max-w-xs">
          Open a project to manage ACP permissions.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  const patternConfig = getPatternConfig(newCapability);

  return (
    <div className="space-y-6">
      {/* ── How It Works ── */}
      <div className="rounded-lg bg-muted/20 ring-1 ring-border/30 px-3.5 py-2.5">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          When an ACP agent requests file or terminal access, permissions are evaluated in order:{" "}
          <span className="text-dim-foreground font-medium">Trust mode override</span> (autonomous sessions only)
          {" \u2192 "}
          <span className="text-dim-foreground font-medium">Matching rules</span> (most specific first)
          {" \u2192 "}
          <span className="text-dim-foreground font-medium">Default policy</span>.
          {" "}If the result is &quot;Ask&quot;, a dialog prompts you for approval.
        </p>
      </div>

      {/* ── Permission Rules ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className={`${sectionHeadingClass} mb-0`}>Permission Rules</h3>
          {rules.length > 0 && (
            <button
              onClick={resetRules}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
            >
              <RotateCcw size={11} />
              Reset all
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Rules with patterns (e.g. <code className="text-[10px] bg-muted/50 px-1 py-0.5 rounded">src/**</code>)
          take priority over capability-wide rules. First match wins.
        </p>

        {/* Existing rules */}
        {rules.length > 0 ? (
          <div className="space-y-1.5 mb-3">
            {rules.map((rule) => {
              const capCfg = CAPABILITIES.find((c) => c.value === rule.capability);
              const CapIcon = capCfg?.icon ?? Shield;
              const actionCfg = ACTION_LABELS[rule.action] ?? ACTION_LABELS.ask;
              const pattern = rule.path_pattern || rule.command_pattern;

              return (
                <div
                  key={rule.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md ring-1 ring-border/30 bg-muted/20 group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CapIcon size={14} className="text-muted-foreground shrink-0" />
                    <span className="text-[13px] font-medium truncate">
                      {capCfg?.label ?? rule.capability}
                    </span>
                    <code className="text-[11px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded truncate max-w-[240px]">
                      {pattern || "*"}
                    </code>
                    <Badge variant="outline" className={`text-[10px] ${actionCfg.color}`}>
                      {actionCfg.label}
                    </Badge>
                  </div>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/60 mb-3">
            No rules configured. The default policy will be used for all requests.
          </p>
        )}

        {/* Add rule form */}
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-2 gap-y-1">
          {/* Row 1: labels */}
          <span className="text-[11px] text-muted-foreground">Capability</span>
          <span className="text-[11px] text-muted-foreground">
            {patternConfig.label} <span className="text-muted-foreground/40">(optional)</span>
          </span>
          <span className="text-[11px] text-muted-foreground">Action</span>
          <span />

          {/* Row 2: controls */}
          <Select
            value={newCapability}
            onValueChange={(v) => {
              if (v) {
                setNewCapability(v);
                setNewPattern("");
              }
            }}
            items={CAPABILITIES.map((cap) => ({ value: cap.value, label: cap.label }))}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAPABILITIES.map((cap) => (
                <SelectItem key={cap.value} value={cap.value}>
                  {cap.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            type="text"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder={patternConfig.placeholder}
            className={`${inputClass} w-full h-8 min-w-[140px]`}
          />

          <Select
            value={newAction}
            onValueChange={(v) => v && setNewAction(v as PermissionAction)}
            items={[
              { value: "auto_approve", label: "Auto-Approve" },
              { value: "ask", label: "Ask" },
              { value: "deny", label: "Deny" },
            ]}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto_approve">Auto-Approve</SelectItem>
              <SelectItem value="ask">Ask</SelectItem>
              <SelectItem value="deny">Deny</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            onClick={addRule}
            disabled={adding}
            className="h-8 px-3"
          >
            {adding ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            Add
          </Button>
        </div>
      </section>

      {/* ── Default Policy ── */}
      <section>
        <h3 className={sectionHeadingClass}>Default Policy</h3>
        <p className="text-[11px] text-muted-foreground mb-2">
          Fallback action when no rule matches a permission request.
        </p>
        <Select
          value={defaultPolicy}
          onValueChange={(v) => v && updateDefaultPolicy(v)}
          items={[
            { value: "ask", label: "Ask \u2014 prompt for approval (safest)" },
            { value: "auto_approve", label: "Auto-Approve \u2014 allow without prompt" },
            { value: "deny", label: "Deny \u2014 block without prompt" },
          ]}
        >
          <SelectTrigger className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ask">Ask &mdash; prompt for approval (safest)</SelectItem>
            <SelectItem value="auto_approve">Auto-Approve &mdash; allow without prompt</SelectItem>
            <SelectItem value="deny">Deny &mdash; block without prompt</SelectItem>
          </SelectContent>
        </Select>
      </section>

      {/* ── Autonomous Sessions (Trust Mode) ── */}
      <section>
        <h3 className={sectionHeadingClass}>Autonomous Sessions</h3>
        <p className="text-[11px] text-muted-foreground mb-2">
          Override policy for sessions launched automatically by continuous mode.
          This takes priority over rules and the default policy.
        </p>
        <Select
          value={trustModePolicy}
          onValueChange={(v) => v && updateTrustModePolicy(v)}
          items={TRUST_MODE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
        >
          <SelectTrigger className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRUST_MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Description for selected option */}
        <p className="text-[10px] text-muted-foreground/70 mt-1.5">
          {TRUST_MODE_OPTIONS.find((o) => o.value === trustModePolicy)?.description}
        </p>
      </section>

      {/* ── Permission Timeout ── */}
      <section>
        <h3 className={sectionHeadingClass}>Prompt Timeout</h3>
        <p className="text-[11px] text-muted-foreground mb-2">
          When a permission dialog appears, how long to wait for your response before auto-denying.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={10}
            max={600}
            step={10}
            value={permissionTimeout}
            onChange={(e) => updatePermissionTimeout(parseInt(e.target.value, 10) || 120)}
            className={`${inputClass} w-24 h-8`}
          />
          <span className="text-[11px] text-muted-foreground">seconds</span>
        </div>
      </section>

      {/* ── Recent Permission Log ── */}
      <section>
        <h3 className={sectionHeadingClass}>Recent Decisions</h3>
        {log.length > 0 ? (
          <div className="max-h-[280px] overflow-y-auto space-y-0.5 rounded-lg ring-1 ring-border/20 bg-muted/10 p-1.5">
            {log.map((entry) => {
              const isApproved =
                entry.decision === "approved" || entry.decision === "auto_approved";
              const isAuto =
                entry.decision === "auto_approved" || entry.decision === "auto_denied";
              const capCfg = CAPABILITIES.find((c) => c.value === entry.capability);

              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground rounded-md hover:bg-muted/30 transition-colors"
                >
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${
                      isApproved ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className="font-medium truncate w-[72px] shrink-0">
                    {capCfg?.label ?? entry.capability}
                  </span>
                  <code className="truncate flex-1 text-[10px] text-muted-foreground/60 font-mono">
                    {entry.detail || "\u2014"}
                  </code>
                  <span className={`shrink-0 text-[10px] ${isApproved ? "text-green-500" : "text-red-500"}`}>
                    {isAuto ? "auto-" : ""}
                    {isApproved ? "approved" : "denied"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/60">
            No permission decisions recorded yet. Decisions will appear here once an ACP session runs.
          </p>
        )}
      </section>
    </div>
  );
}
