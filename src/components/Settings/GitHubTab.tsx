import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  Github,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Tag,
  User,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAppStore } from "../../store/appStore";
import { Card, CardContent } from "../ui/orecus.io/cards/card";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import { sectionHeadingClass, ToggleRow } from "./shared";

import type { GhAuthStatus, GitHubLabelFull, GitHubLabelMapping, TaskStatus } from "../../types";

// ── Auth Status Card ──

function AuthStatusCard({
  authStatus,
  onRecheck,
  recheckLoading,
}: {
  authStatus: GhAuthStatus | null;
  onRecheck: () => void;
  recheckLoading: boolean;
}) {
  if (!authStatus) {
    return (
      <Card type="normal" radius="lg" border>
        <CardContent className="flex items-center gap-3">
          <div className="flex items-center justify-center size-9 rounded-lg bg-muted shrink-0">
            <Shield className="size-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-foreground">
              Checking authentication...
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Verifying GitHub CLI status
            </div>
          </div>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const isOk = authStatus.installed && authStatus.authenticated && !authStatus.has_scope_warnings;
  const hasWarning = authStatus.installed && authStatus.authenticated && authStatus.has_scope_warnings;

  return (
    <Card type="normal" radius="lg" border>
      <CardContent className="flex items-center gap-3">
        <div
          className={`flex items-center justify-center size-9 rounded-lg shrink-0 ${
            isOk
              ? "bg-[color-mix(in_oklch,var(--success)_12%,transparent)]"
              : hasWarning
                ? "bg-[color-mix(in_oklch,var(--warning)_12%,transparent)]"
                : "bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)]"
          }`}
        >
          {isOk ? (
            <ShieldCheck className="size-4 text-success" />
          ) : hasWarning ? (
            <ShieldAlert className="size-4 text-warning" />
          ) : (
            <ShieldAlert className="size-4 text-destructive" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
            {isOk
              ? "Authenticated"
              : hasWarning
                ? "Authenticated (scope warnings)"
                : !authStatus.installed
                  ? "GitHub CLI not installed"
                  : "Not authenticated"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {isOk && authStatus.username && (
              <span className="inline-flex items-center gap-1">
                <User className="size-3" />
                {authStatus.username}
                {authStatus.token_source && (
                  <span className="text-muted-foreground/60">
                    via {authStatus.token_source}
                  </span>
                )}
              </span>
            )}
            {hasWarning && (
              <span className="text-warning">
                Missing scopes: {authStatus.missing_scopes.join(", ")}
              </span>
            )}
            {!authStatus.installed && (
              <span>
                Install the{" "}
                <code className="text-[10px] bg-muted px-1 py-0.5 rounded">
                  gh
                </code>{" "}
                CLI to enable GitHub features
              </span>
            )}
            {authStatus.installed && !authStatus.authenticated && (
              <span>
                Run{" "}
                <code className="text-[10px] bg-muted px-1 py-0.5 rounded">
                  gh auth login
                </code>{" "}
                to authenticate
              </span>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRecheck}
          loading={recheckLoading}
          leftIcon={
            recheckLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )
          }
        >
          Re-check
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Label Color Dot ──

function LabelColorDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2.5 rounded-full shrink-0 ring-1 ring-border/40"
      style={{ backgroundColor: `#${color}` }}
    />
  );
}

// ── Label Mapping Table ──

const ALL_TASK_STATUSES: TaskStatus[] = [
  "backlog",
  "ready",
  "in-progress",
  "in-review",
  "done",
  "archived",
];

const DEFAULT_LABEL_PRESETS: Record<TaskStatus, string> = {
  "backlog": "status:backlog",
  "ready": "status:ready",
  "in-progress": "status:in-progress",
  "in-review": "status:in-review",
  "done": "status:done",
  "archived": "status:archived",
};

const DEFAULT_LABEL_COLORS: Record<TaskStatus, string> = {
  "backlog": "6B7280",
  "ready": "3B82F6",
  "in-progress": "F59E0B",
  "in-review": "8B5CF6",
  "done": "10B981",
  "archived": "9CA3AF",
};

function LabelMappingTable({
  labelMapping,
  repoLabels,
  fetchingLabels,
  creatingLabels,
  onFetchLabels,
  onLabelMappingChange,
  onCreateDefaultLabels,
}: {
  labelMapping: GitHubLabelMapping;
  repoLabels: GitHubLabelFull[];
  fetchingLabels: boolean;
  creatingLabels: boolean;
  onFetchLabels: () => void;
  onLabelMappingChange: (status: TaskStatus, label: string) => void;
  onCreateDefaultLabels: () => void;
}) {
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onFetchLabels}
          loading={fetchingLabels}
          leftIcon={
            fetchingLabels ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Tag className="size-3" />
            )
          }
        >
          {repoLabels.length > 0 ? "Refresh Labels" : "Fetch Labels"}
        </Button>
        {repoLabels.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {repoLabels.length} labels available
          </span>
        )}
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={onCreateDefaultLabels}
          loading={creatingLabels}
          leftIcon={
            creatingLabels ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plus className="size-3" />
            )
          }
          title="Create status:backlog, status:ready, etc. labels on GitHub and auto-map them"
        >
          Create default labels
        </Button>
      </div>

      {repoLabels.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {ALL_TASK_STATUSES.map((status) => {
            const currentLabel = labelMapping[status] ?? "";
            const matchedLabel = repoLabels.find(
              (l) => l.name === currentLabel,
            );

            return (
              <div key={status} className="flex items-center gap-3">
                <span className="text-[12px] text-dim-foreground w-24 shrink-0 capitalize">
                  {status}
                </span>
                <div className="flex-1 max-w-64">
                  <Select
                    value={currentLabel || "__none__"}
                    onValueChange={(val: string | null) =>
                      onLabelMappingChange(
                        status,
                        !val || val === "__none__" ? "" : val,
                      )
                    }
                    items={[
                      { value: "__none__", label: "None" },
                      ...repoLabels.map((l) => ({
                        value: l.name,
                        label: l.name,
                      })),
                    ]}
                  >
                    <SelectTrigger className="w-full h-7 text-xs">
                      {matchedLabel && (
                        <LabelColorDot color={matchedLabel.color} />
                      )}
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {repoLabels.map((l) => (
                        <SelectItem key={l.name} value={l.name}>
                          <span className="flex items-center gap-1.5">
                            <LabelColorDot color={l.color} />
                            {l.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {currentLabel && matchedLabel && (
                  <CheckCircle2 className="size-3 text-success shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {repoLabels.length === 0 && (
        <div className="text-[11px] text-muted-foreground py-2">
          Click &quot;Fetch Labels&quot; to load available labels from the
          repository, or &quot;Create default labels&quot; to set up a
          standard label set.
        </div>
      )}
    </div>
  );
}

// ── GitHub Tab ──

export function GitHubTab() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projects = useAppStore((s) => s.projects);
  const ghAuthStatus = useAppStore((s) => s.ghAuthStatus);
  const refreshGhAuth = useAppStore((s) => s.refreshGhAuth);

  const [recheckLoading, setRecheckLoading] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [autoClose, setAutoClose] = useState(true);
  const [autoReopen, setAutoReopen] = useState(true);
  const [prClosesRef, setPrClosesRef] = useState(true);
  const [labelSync, setLabelSync] = useState(false);
  const [mergeDetection, setMergeDetection] = useState(true);
  const [syncDefaultTitle, setSyncDefaultTitle] = useState(false);
  const [syncDefaultBody, setSyncDefaultBody] = useState(false);
  const [syncDefaultStatus, setSyncDefaultStatus] = useState(false);
  const [syncDefaultLabels, setSyncDefaultLabels] = useState(false);
  const [labelMapping, setLabelMapping] = useState<GitHubLabelMapping>({});
  const [repoLabels, setRepoLabels] = useState<GitHubLabelFull[]>([]);
  const [fetchingLabels, setFetchingLabels] = useState(false);
  const [creatingLabels, setCreatingLabels] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Load settings on mount or project change
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const get = (key: string) =>
          invoke<string | null>("get_project_setting", {
            projectId: activeProjectId,
            key,
          });

        const [se, ac, ar, pcr, ls, md, lm, sdt, sdb, sds, sdl] = await Promise.all([
          get("github_sync_enabled"),
          get("github_auto_close"),
          get("github_auto_reopen"),
          get("github_pr_closes_ref"),
          get("github_label_sync"),
          get("github_merge_detection"),
          get("github_label_mapping"),
          get("github_sync_default_title"),
          get("github_sync_default_body"),
          get("github_sync_default_status"),
          get("github_sync_default_labels"),
        ]);

        if (cancelled) return;
        setSyncEnabled(se === "true");
        setAutoClose(ac !== "false");
        setAutoReopen(ar !== "false");
        setPrClosesRef(pcr !== "false");
        setLabelSync(ls === "true");
        setMergeDetection(md !== "false");
        setSyncDefaultTitle(sdt === "true");
        setSyncDefaultBody(sdb === "true");
        setSyncDefaultStatus(sds === "true");
        setSyncDefaultLabels(sdl === "true");
        if (lm) {
          try {
            setLabelMapping(JSON.parse(lm));
          } catch {
            // ignore
          }
        } else {
          setLabelMapping({});
        }
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    setLoaded(false);
    setRepoLabels([]);
    load();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const saveSetting = useCallback(
    (key: string, value: string) => {
      if (!activeProjectId) return;
      invoke("set_project_setting", {
        projectId: activeProjectId,
        key,
        value,
      }).catch(() => {});
    },
    [activeProjectId],
  );

  const handleToggle = useCallback(
    (key: string, setter: (v: boolean) => void, value: boolean) => {
      setter(value);
      saveSetting(key, value ? "true" : "false");
    },
    [saveSetting],
  );

  const handleRecheck = useCallback(async () => {
    setRecheckLoading(true);
    try {
      await refreshGhAuth();
    } finally {
      setRecheckLoading(false);
    }
  }, [refreshGhAuth]);

  const handleFetchLabels = useCallback(async () => {
    if (!activeProjectId) return;
    setFetchingLabels(true);
    try {
      const labels = await invoke<GitHubLabelFull[]>("fetch_repo_labels", {
        projectId: activeProjectId,
      });
      setRepoLabels(labels);
    } catch {
      // ignore
    } finally {
      setFetchingLabels(false);
    }
  }, [activeProjectId]);

  const handleLabelMappingChange = useCallback(
    (status: TaskStatus, label: string) => {
      setLabelMapping((prev) => {
        const next = { ...prev };
        if (label) {
          next[status] = label;
        } else {
          delete next[status];
        }
        saveSetting("github_label_mapping", JSON.stringify(next));
        return next;
      });
    },
    [saveSetting],
  );

  const handleCreateDefaultLabels = useCallback(async () => {
    if (!activeProjectId) return;
    setCreatingLabels(true);
    try {
      // Create each label on GitHub
      for (const status of ALL_TASK_STATUSES) {
        const labelName = DEFAULT_LABEL_PRESETS[status];
        const color = DEFAULT_LABEL_COLORS[status];
        try {
          await invoke("create_repo_label", {
            projectId: activeProjectId,
            name: labelName,
            color,
            description: `Faber task status: ${status}`,
          });
        } catch {
          // Label might already exist, continue
        }
      }

      // Refresh labels from repo
      const labels = await invoke<GitHubLabelFull[]>("fetch_repo_labels", {
        projectId: activeProjectId,
      });
      setRepoLabels(labels);

      // Auto-map the created labels
      const newMapping: GitHubLabelMapping = {};
      for (const status of ALL_TASK_STATUSES) {
        const labelName = DEFAULT_LABEL_PRESETS[status];
        if (labels.some((l) => l.name === labelName)) {
          newMapping[status] = labelName;
        }
      }
      setLabelMapping(newMapping);
      saveSetting("github_label_mapping", JSON.stringify(newMapping));
    } catch {
      // ignore
    } finally {
      setCreatingLabels(false);
    }
  }, [activeProjectId, saveSetting]);

  // No active project
  if (!activeProjectId || !activeProject) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Github className="mb-3 size-10 opacity-30" />
        <p className="text-sm font-medium text-foreground">
          No project selected
        </p>
        <p className="mt-1 text-xs text-center max-w-xs">
          Open a project to configure its GitHub sync settings.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Project context */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          Settings for
        </span>
        <span className="text-[13px] font-medium text-foreground">
          {activeProject.name}
        </span>
      </div>

      {/* ── Authentication Status ── */}
      <section>
        <div className={`${sectionHeadingClass} mb-2.5 flex items-center gap-2`}>
          <Shield className="size-3.5" />
          Authentication
        </div>
        <AuthStatusCard
          authStatus={ghAuthStatus}
          onRecheck={handleRecheck}
          recheckLoading={recheckLoading}
        />
      </section>

      <Separator />

      {/* ── Sync Settings ── */}
      <section>
        <div className={`${sectionHeadingClass} mb-2.5 flex items-center gap-2`}>
          <Github className="size-3.5" />
          Sync Settings
        </div>

        {!loaded ? (
          <div className="flex items-center gap-2 py-3">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Loading settings...
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <ToggleRow
              label="Enable GitHub Sync"
              description="Sync task status changes to linked GitHub issues"
              checked={syncEnabled}
              onChange={(v) =>
                handleToggle("github_sync_enabled", setSyncEnabled, v)
              }
            />

            {syncEnabled && (
              <div className="ml-3 border-l-2 border-border pl-4 flex flex-col gap-1 mt-1">
                <ToggleRow
                  label="Auto-close issues"
                  description="Close GitHub issue when task moves to Done (without a PR)"
                  checked={autoClose}
                  onChange={(v) =>
                    handleToggle("github_auto_close", setAutoClose, v)
                  }
                />
                <ToggleRow
                  label="Auto-reopen issues"
                  description="Reopen GitHub issue when task moves back from Done"
                  checked={autoReopen}
                  onChange={(v) =>
                    handleToggle("github_auto_reopen", setAutoReopen, v)
                  }
                />
                <ToggleRow
                  label='Add "Closes #N" to PR body'
                  description="Pre-populate PR description with close reference"
                  checked={prClosesRef}
                  onChange={(v) =>
                    handleToggle("github_pr_closes_ref", setPrClosesRef, v)
                  }
                />
                <ToggleRow
                  label="Auto-detect merged PRs"
                  description="Check PR status on Review refresh"
                  checked={mergeDetection}
                  onChange={(v) =>
                    handleToggle("github_merge_detection", setMergeDetection, v)
                  }
                />
              </div>
            )}
          </div>
        )}
      </section>

      <Separator />

      {/* ── Manual Sync Defaults ── */}
      <section>
        <div className={`${sectionHeadingClass} mb-2.5 flex items-center gap-2`}>
          <Settings2 className="size-3.5" />
          Manual Sync Defaults
        </div>

        <p className="text-[11px] text-muted-foreground mb-3">
          Pre-checked options when opening the Sync to GitHub dialog.
        </p>

        <div className="flex flex-col gap-1">
          <ToggleRow
            label="Title"
            description="Pre-check title sync by default"
            checked={syncDefaultTitle}
            onChange={(v) =>
              handleToggle("github_sync_default_title", setSyncDefaultTitle, v)
            }
          />
          <ToggleRow
            label="Body"
            description="Pre-check body sync by default"
            checked={syncDefaultBody}
            onChange={(v) =>
              handleToggle("github_sync_default_body", setSyncDefaultBody, v)
            }
          />
          <ToggleRow
            label="Status"
            description="Pre-check status (close/reopen) sync by default"
            checked={syncDefaultStatus}
            onChange={(v) =>
              handleToggle("github_sync_default_status", setSyncDefaultStatus, v)
            }
          />
          <ToggleRow
            label="Labels"
            description="Pre-check labels sync by default"
            checked={syncDefaultLabels}
            onChange={(v) =>
              handleToggle("github_sync_default_labels", setSyncDefaultLabels, v)
            }
          />
        </div>
      </section>

      <Separator />

      {/* ── Label Mapping ── */}
      <section>
        <div className={`${sectionHeadingClass} mb-2.5 flex items-center gap-2`}>
          <Tag className="size-3.5" />
          Label Mapping
        </div>

        <ToggleRow
          label="Sync status labels"
          description="Add/remove labels on GitHub issues when task status changes"
          checked={labelSync}
          onChange={(v) =>
            handleToggle("github_label_sync", setLabelSync, v)
          }
          disabled={!syncEnabled}
        />

        {syncEnabled && labelSync && (
          <LabelMappingTable
            labelMapping={labelMapping}
            repoLabels={repoLabels}
            fetchingLabels={fetchingLabels}
            creatingLabels={creatingLabels}
            onFetchLabels={handleFetchLabels}
            onLabelMappingChange={handleLabelMappingChange}
            onCreateDefaultLabels={handleCreateDefaultLabels}
          />
        )}

        {!syncEnabled && (
          <div className="text-[11px] text-muted-foreground mt-1">
            Enable GitHub Sync above to configure label mapping.
          </div>
        )}
      </section>
    </div>
  );
}
