import { invoke } from "@tauri-apps/api/core";
import {
  Eye,
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
  { value: "auto_approve", label: "Auto-approve all" },
  { value: "normal", label: "Use normal rules" },
  { value: "deny_writes", label: "Deny write operations" },
];

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
    try {
      await invoke("create_permission_rule", {
        projectId: activeProjectId,
        capability: newCapability,
        pathPattern: newPattern.trim() || null,
        commandPattern: null,
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
    [loadData],
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
      <div className="text-sm text-muted-foreground py-8 text-center">
        Select a project to manage ACP permissions.
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

  return (
    <div className="space-y-6">
      {/* ── Default Policy ── */}
      <section>
        <h3 className={sectionHeadingClass}>Default Policy</h3>
        <p className="text-xs text-muted-foreground mb-2">
          When no rule matches a permission request, this action is taken.
        </p>
        <Select
          value={defaultPolicy}
          onValueChange={(v) => v && updateDefaultPolicy(v)}
          items={[
            { value: "ask", label: "Ask (safest)" },
            { value: "auto_approve", label: "Auto-Approve" },
            { value: "deny", label: "Deny" },
          ]}
        >
          <SelectTrigger className={`${inputClass} w-48`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ask">Ask (safest)</SelectItem>
            <SelectItem value="auto_approve">Auto-Approve</SelectItem>
            <SelectItem value="deny">Deny</SelectItem>
          </SelectContent>
        </Select>
      </section>

      {/* ── Trust Mode ── */}
      <section>
        <h3 className={sectionHeadingClass}>Trust Mode</h3>
        <p className="text-xs text-muted-foreground mb-2">
          Permission behavior when tasks run autonomously (e.g. continuous mode auto-launch queue).
        </p>
        <Select
          value={trustModePolicy}
          onValueChange={(v) => v && updateTrustModePolicy(v)}
          items={TRUST_MODE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
        >
          <SelectTrigger className={`${inputClass} w-56`}>
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
      </section>

      {/* ── Permission Timeout ── */}
      <section>
        <h3 className={sectionHeadingClass}>Permission Timeout</h3>
        <p className="text-xs text-muted-foreground mb-2">
          How long to wait for a user response before auto-denying a permission request (seconds).
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
          <span className="text-xs text-muted-foreground">seconds (default: 120)</span>
        </div>
      </section>

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
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/60 mb-3">
            No rules configured. The default policy will be used for all requests.
          </p>
        )}

        {/* Add rule form — two-row grid: labels on top, controls on bottom */}
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-2 gap-y-1">
          {/* Row 1: labels */}
          <span className="text-[11px] text-muted-foreground">Capability</span>
          <span className="text-[11px] text-muted-foreground">
            Path pattern <span className="text-muted-foreground/40">(optional)</span>
          </span>
          <span className="text-[11px] text-muted-foreground">Action</span>
          <span />

          {/* Row 2: controls — all h-8 */}
          <Select
            value={newCapability}
            onValueChange={(v) => v && setNewCapability(v)}
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
            placeholder="e.g. src/**"
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

      {/* ── Recent Permission Log ── */}
      <section>
        <h3 className={sectionHeadingClass}>Recent Decisions</h3>
        {log.length > 0 ? (
          <div className="max-h-[200px] overflow-y-auto space-y-0.5">
            {log.slice(0, 5).map((entry) => {
              const isApproved =
                entry.decision === "approved" || entry.decision === "auto_approved";
              const isAuto =
                entry.decision === "auto_approved" || entry.decision === "auto_denied";

              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground"
                >
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${
                      isApproved ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className="font-medium truncate max-w-[100px]">
                    {entry.capability}
                  </span>
                  <span className="truncate flex-1 text-muted-foreground/50">
                    {entry.detail || "—"}
                  </span>
                  <span className={isApproved ? "text-green-500" : "text-red-500"}>
                    {isAuto ? "auto-" : ""}
                    {isApproved ? "approved" : "denied"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/60">
            No permission decisions recorded yet.
          </p>
        )}
      </section>
    </div>
  );
}
