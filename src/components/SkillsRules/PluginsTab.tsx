import { invoke } from "@tauri-apps/api/core";
import { formatError } from "../../lib/errorMessages";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  Download,
  ExternalLink,
  Globe,
  Library,
  Loader2,
  Package,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Store,
  Terminal,
  Trash2,
  Unplug,
  Wand2,
  Webhook,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "../Review/ConfirmDialog";

import { open } from "@tauri-apps/plugin-shell";
import { Streamdown } from "streamdown";
import { useTheme } from "../../contexts/ThemeContext";
import { highlightMatch } from "../../lib/highlightMatch";
import {
  streamdownControls,
  streamdownPlugins,
  streamdownTheme,
} from "../../lib/markdown";
import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { CardSkeleton } from "../ui/orecus.io/cards/card/skeleton";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";

// ── Types matching Rust backend ──

interface PluginComponents {
  skills: number;
  agents: number;
  commands: number;
  hasHooks: boolean;
  hasMcp: boolean;
  hasLsp: boolean;
  hasSettings: boolean;
}

interface InstalledPlugin {
  name: string;
  marketplace: string;
  scope: string;
  version: string;
  installPath: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha: string;
  description: string;
  authorName: string;
  category: string;
  keywords: string[];
  extensionType: string;
  components: PluginComponents;
}

interface MarketplaceInfo {
  name: string;
  sourceRepo: string;
  installLocation: string;
  lastUpdated: string;
}

interface AvailablePlugin {
  name: string;
  marketplace: string;
  description: string;
  authorName: string;
  uniqueInstalls: number;
  isInstalled: boolean;
  isBlocked: boolean;
  category: string;
  keywords: string[];
  extensionType: string;
  components: PluginComponents;
}

interface PluginsOverview {
  installed: InstalledPlugin[];
  marketplaces: MarketplaceInfo[];
  available: AvailablePlugin[];
  claudeCliAvailable: boolean;
}

// Union type for any plugin we might select
type AnyPlugin =
  | { kind: "installed"; plugin: InstalledPlugin }
  | { kind: "available"; plugin: AvailablePlugin };

interface Props {
  projectId: string;
}

// ── Category definitions ──

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode }> = {
  all:            { label: "All",            icon: <Package size={12} /> },
  development:    { label: "Development",    icon: <Code2 size={12} /> },
  productivity:   { label: "Productivity",   icon: <Terminal size={12} /> },
  integration:    { label: "Integrations",   icon: <Plug size={12} /> },
  security:       { label: "Security",       icon: <ShieldAlert size={12} /> },
  testing:        { label: "Testing",        icon: <Terminal size={12} /> },
  design:         { label: "Design",         icon: <Wand2 size={12} /> },
  learning:       { label: "Learning",       icon: <Sparkles size={12} /> },
  database:       { label: "Database",       icon: <Package size={12} /> },
  monitoring:     { label: "Monitoring",     icon: <Package size={12} /> },
  deployment:     { label: "Deployment",     icon: <Package size={12} /> },
  infrastructure: { label: "Infrastructure", icon: <Terminal size={12} /> },
  orchestration:  { label: "Orchestration",  icon: <Bot size={12} /> },
  quality:        { label: "Quality",        icon: <ShieldAlert size={12} /> },
  data:           { label: "Data & AI",      icon: <Sparkles size={12} /> },
  tooling:        { label: "Tooling",        icon: <Terminal size={12} /> },
  specialized:    { label: "Specialized",    icon: <Webhook size={12} /> },
  business:       { label: "Business",       icon: <Package size={12} /> },
  research:       { label: "Research",       icon: <Sparkles size={12} /> },
  general:        { label: "General",        icon: <Package size={12} /> },
};

// ── Extension type definitions ──

const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  all:     { label: "All Types",  icon: <Package size={12} /> },
  plugin:  { label: "Plugins",    icon: <Package size={12} /> },
  skill:   { label: "Skills",     icon: <Sparkles size={12} /> },
  agent:   { label: "Agents",     icon: <Bot size={12} /> },
  lsp:     { label: "LSP",        icon: <Code2 size={12} /> },
  mcp:     { label: "MCP",        icon: <Plug size={12} /> },
  hook:    { label: "Hooks",      icon: <Webhook size={12} /> },
  command: { label: "Commands",   icon: <Terminal size={12} /> },
  mixed:   { label: "Mixed",      icon: <Package size={12} /> },
};

function TypeFilterChip({
  id,
  active,
  count,
  onClick,
}: {
  id: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const meta = TYPE_META[id] ?? { label: id, icon: <Package size={12} /> };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors whitespace-nowrap ${
        active
          ? "bg-primary/15 text-primary ring-1 ring-primary/30"
          : "bg-accent/40 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
      }`}
    >
      {meta.icon}
      <span>{meta.label}</span>
      <span className="text-2xs opacity-60">{count}</span>
    </button>
  );
}

// ── Helpers ──

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ── Small UI pieces ──

function ComponentBadges({ c }: { c: PluginComponents }) {
  const items: string[] = [];
  if (c.skills > 0) items.push(`${c.skills} skill${c.skills > 1 ? "s" : ""}`);
  if (c.agents > 0) items.push(`${c.agents} agent${c.agents > 1 ? "s" : ""}`);
  if (c.commands > 0) items.push(`${c.commands} cmd${c.commands > 1 ? "s" : ""}`);
  if (c.hasHooks) items.push("hooks");
  if (c.hasMcp) items.push("MCP");
  if (c.hasLsp) items.push("LSP");
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((label) => (
        <span
          key={label}
          className="text-2xs leading-tight px-1.5 py-[2px] rounded-[4px] bg-accent/60 text-muted-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function ScopeBadge({ scope }: { scope: string }) {
  return (
    <span className="inline-flex items-center gap-[3px] text-2xs px-1.5 py-[2px] rounded-[4px] bg-primary/10 text-primary/80">
      {scope === "user" ? <Globe size={9} /> : <Library size={9} />}
      {scope}
    </span>
  );
}

function CategoryChip({
  id,
  active,
  count,
  onClick,
}: {
  id: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const meta = CATEGORY_META[id] ?? { label: id.charAt(0).toUpperCase() + id.slice(1), icon: <Package size={12} /> };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors whitespace-nowrap ${
        active
          ? "bg-primary/15 text-primary ring-1 ring-primary/30"
          : "bg-accent/40 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
      }`}
    >
      {meta.icon}
      <span>{meta.label}</span>
      <span className="text-2xs opacity-60">{count}</span>
    </button>
  );
}

// ── Plugin card for the grid ──

const PluginCard = React.memo(function PluginCard({
  plugin,
  isInstalled,
  installedScope,
  isBlocked,
  onSelect,
  onInstall,
  onUninstall,
  actionLoading,
  searchQuery,
}: {
  plugin: AvailablePlugin | InstalledPlugin;
  isInstalled: boolean;
  installedScope?: string;
  isBlocked: boolean;
  onSelect: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  actionLoading: string | null;
  searchQuery?: string;
}) {
  const key = `${plugin.name}@${plugin.marketplace}`;
  const installKey = `install:${key}`;
  const uninstallKey = `uninstall:${key}`;
  const isInstalling = actionLoading === installKey;
  const isUninstalling = actionLoading === uninstallKey;
  const uniqueInstalls = (plugin as AvailablePlugin).uniqueInstalls ?? 0;

  return (
    <div
      className={`group relative flex flex-col gap-2 p-3 rounded-lg ring-1 transition-all cursor-pointer hover:ring-primary/30 hover:bg-accent/30 ${
        isBlocked
          ? "ring-destructive/20 opacity-60"
          : isInstalled
            ? "ring-primary/20 bg-primary/[0.03]"
            : "ring-border/40"
      }`}
      onClick={onSelect}
    >
      {/* Top row: icon + name + action */}
      <div className="flex items-start gap-2.5">
        <div
          className={`size-8 rounded-md flex items-center justify-center shrink-0 ${
            isInstalled ? "bg-primary/10" : "bg-accent/50"
          }`}
        >
          {isBlocked ? (
            <ShieldAlert size={15} className="text-destructive/60" />
          ) : (
            <Package
              size={15}
              className={isInstalled ? "text-primary/70" : "text-muted-foreground/60"}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground truncate">
              {searchQuery ? highlightMatch(plugin.name, searchQuery) : plugin.name}
            </span>
            {isInstalled && (
              <Check size={12} className="text-success shrink-0" />
            )}
            {isBlocked && (
              <span className="text-2xs px-1 py-[1px] rounded bg-destructive/15 text-destructive font-medium shrink-0">
                blocked
              </span>
            )}
          </div>
          {plugin.authorName && (
            <span className="text-xs text-muted-foreground/70">
              {plugin.authorName}
            </span>
          )}
        </div>

        {/* Action button — only show on hover or when loading */}
        <div
          className={`shrink-0 ${isInstalling || isUninstalling ? "opacity-100" : "opacity-30 group-hover:opacity-100 group-focus-within:opacity-100"} transition-opacity`}
          onClick={(e) => e.stopPropagation()}
        >
          {isInstalled ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onUninstall}
              disabled={isUninstalling}
              className="!px-1.5 !py-1 text-destructive/60 hover:text-destructive"
              hoverEffect="scale"
              clickEffect="scale"
            >
              {isUninstalling ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onInstall}
              disabled={isBlocked || isInstalling}
              className="!px-1.5 !py-1"
              hoverEffect="scale"
              clickEffect="scale"
            >
              {isInstalling ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Download className="size-3" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Description */}
      {plugin.description && (
        <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
          {searchQuery ? highlightMatch(plugin.description, searchQuery) : plugin.description}
        </p>
      )}

      {/* Bottom row: type + components + installs + scope */}
      <div className="flex items-center gap-2 flex-wrap mt-auto">
        {(plugin as AvailablePlugin).extensionType &&
          (plugin as AvailablePlugin).extensionType !== "plugin" && (
          <span className="text-2xs leading-tight px-1.5 py-[2px] rounded-[4px] bg-primary/8 text-primary/70 font-medium">
            {TYPE_META[(plugin as AvailablePlugin).extensionType]?.label ??
              (plugin as AvailablePlugin).extensionType}
          </span>
        )}
        <ComponentBadges c={plugin.components} />
        <div className="flex-1" />
        {installedScope && <ScopeBadge scope={installedScope} />}
        {uniqueInstalls > 0 && (
          <span className="text-2xs text-muted-foreground/50 flex items-center gap-0.5">
            <Download size={9} className="opacity-60" />
            {formatInstalls(uniqueInstalls)}
          </span>
        )}
      </div>
    </div>
  );
});

// ── Detail drawer / panel ──

function PluginDetailDrawer({
  selected,
  onClose,
  onInstall,
  onUninstall,
  onUpdate,
  actionLoading,
}: {
  selected: AnyPlugin;
  onClose: () => void;
  onInstall: (name: string, marketplace: string) => void;
  onUninstall: (name: string, marketplace: string, scope: string) => void;
  onUpdate: (name: string, marketplace: string, scope: string) => void;
  actionLoading: string | null;
}) {
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isInstalled = selected.kind === "installed";
  const p = selected.plugin;
  const pluginKey = `${p.name}@${p.marketplace}`;

  useEffect(() => {
    setReadmeLoading(true);
    setReadme(null);
    invoke<string>("get_plugin_readme", {
      marketplace: p.marketplace,
      pluginName: p.name,
    })
      .then(setReadme)
      .catch(() => setReadme(null))
      .finally(() => setReadmeLoading(false));

    // Scroll to top when selection changes
    panelRef.current?.scrollTo(0, 0);
  }, [p.name, p.marketplace]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky header */}
      <div className="shrink-0 px-4 py-3 border-b border-border/40">
        {/* Back / close */}
        <div className="flex items-center gap-2 mb-2.5">
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 -ml-1"
          >
            <ArrowLeft size={15} />
          </button>
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
            Extension Details
          </span>
        </div>

        {/* Plugin identity */}
        <div className="flex items-start gap-3">
          <div
            className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${
              isInstalled ? "bg-primary/10" : "bg-accent/50"
            }`}
          >
            <Package size={20} className={isInstalled ? "text-primary/70" : "text-muted-foreground/60"} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {p.name}
            </h3>
            {p.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3">
                {p.description}
              </p>
            )}

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {p.authorName && (
                <span className="text-xs text-dim-foreground">
                  {p.authorName}
                </span>
              )}
              <span className="text-2xs text-muted-foreground/50">
                {p.marketplace}
              </span>
              {isInstalled && <ScopeBadge scope={(p as InstalledPlugin).scope} />}
              {!isInstalled && (p as AvailablePlugin).uniqueInstalls > 0 && (
                <span className="text-2xs text-muted-foreground/50 flex items-center gap-0.5">
                  <Download size={9} />
                  {formatInstalls((p as AvailablePlugin).uniqueInstalls)}
                </span>
              )}
            </div>

            <div className="mt-2">
              <ComponentBadges c={p.components} />
            </div>

            {p.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {p.keywords.map((kw) => (
                  <span key={kw} className="text-2xs px-1.5 py-[1px] rounded-full bg-accent/60 text-muted-foreground/70">
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-3">
          {isInstalled ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onUpdate(p.name, p.marketplace, (p as InstalledPlugin).scope)
                }
                disabled={actionLoading === `update:${pluginKey}`}
                leftIcon={
                  actionLoading === `update:${pluginKey}` ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )
                }
                hoverEffect="scale"
                clickEffect="scale"
              >
                Update
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onUninstall(p.name, p.marketplace, (p as InstalledPlugin).scope)
                }
                disabled={actionLoading === `uninstall:${pluginKey}`}
                leftIcon={
                  actionLoading === `uninstall:${pluginKey}` ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3" />
                  )
                }
                className="text-destructive/70 hover:text-destructive"
                hoverEffect="scale"
                clickEffect="scale"
              >
                Uninstall
              </Button>
              <div className="flex-1" />
              <span className="text-2xs text-muted-foreground/50">
                Updated {formatDate((p as InstalledPlugin).lastUpdated)}
              </span>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onInstall(p.name, p.marketplace)}
                disabled={
                  (p as AvailablePlugin).isBlocked ||
                  (p as AvailablePlugin).isInstalled ||
                  actionLoading === `install:${pluginKey}`
                }
                leftIcon={
                  actionLoading === `install:${pluginKey}` ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (p as AvailablePlugin).isInstalled ? (
                    <Check className="size-3" />
                  ) : (
                    <Download className="size-3" />
                  )
                }
                hoverEffect="scale"
                clickEffect="scale"
              >
                {(p as AvailablePlugin).isInstalled ? "Installed" : "Install"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* README */}
      <div
        ref={panelRef}
        className="relative flex-1 min-h-0 overflow-y-auto"
        onScroll={(e) => setShowScrollTop(e.currentTarget.scrollTop > 200)}
      >
        {readmeLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!readmeLoading && readme && (
          <div className="markdown-preview px-4 py-3">
            <Streamdown
              mode="static"
              plugins={streamdownPlugins}
              shikiTheme={streamdownTheme}
              controls={streamdownControls}
            >
              {readme}
            </Streamdown>
          </div>
        )}
        {!readmeLoading && !readme && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <Package className="size-6 opacity-15" />
            <p className="text-xs">No README available</p>
            <button
              onClick={() =>
                open(
                  `https://github.com/${p.marketplace === "claude-plugins-official" ? "anthropics/claude-plugins-official" : p.marketplace}`,
                )
              }
              className="text-xs text-primary/70 hover:text-primary inline-flex items-center gap-1 transition-colors"
            >
              View on GitHub <ExternalLink size={10} />
            </button>
          </div>
        )}

        {showScrollTop && (
          <button
            onClick={() => panelRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="sticky bottom-3 float-right mr-3 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium text-foreground bg-card/90 backdrop-blur ring-1 ring-border/40 shadow-md hover:ring-primary/30 transition-all"
          >
            <ChevronUp size={12} />
            Top
          </button>
        )}
      </div>
    </div>
  );
}

// ── Marketplace sources manager (collapsible footer) ──

function MarketplaceSources({
  marketplaces,
  onAdd,
  onRemove,
  onRefresh,
  addLoading,
  refreshLoading,
}: {
  marketplaces: MarketplaceInfo[];
  onAdd: (source: string) => void;
  onRemove: (name: string) => void;
  onRefresh: () => void;
  addLoading: boolean;
  refreshLoading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addInputOpen, setAddInputOpen] = useState(false);
  const [addValue, setAddValue] = useState("");

  return (
    <div className="border-t border-border/30">
      <button
        type="button"
        className="w-full px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Store size={11} />
        <span className="font-medium uppercase tracking-wider">
          Marketplace Sources
        </span>
        <span className="text-2xs opacity-50 bg-accent/40 px-1.5 py-0.5 rounded-full ml-auto">
          {marketplaces.length}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {marketplaces.map((m) => (
            <div
              key={m.name}
              className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/30 transition-colors"
            >
              <Globe size={11} className="text-muted-foreground/50 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-foreground truncate">{m.name}</div>
                <div className="text-2xs text-muted-foreground/40 truncate">{m.sourceRepo}</div>
              </div>
              <button
                onClick={() => onRemove(m.name)}
                className="opacity-30 group-hover:opacity-60 group-focus-within:opacity-60 hover:!opacity-100 text-destructive/60 hover:text-destructive transition-opacity"
                title="Remove"
              >
                <Unplug size={11} />
              </button>
            </div>
          ))}

          <div className="flex items-center gap-1 pt-1">
            {addInputOpen ? (
              <>
                <input
                  type="text"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && addValue.trim()) {
                      onAdd(addValue.trim());
                      setAddValue("");
                      setAddInputOpen(false);
                    }
                    if (e.key === "Escape") {
                      setAddInputOpen(false);
                      setAddValue("");
                    }
                  }}
                  placeholder="owner/repo or URL..."
                  className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 border border-border/60 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  autoFocus
                />
                <button
                  onClick={() => {
                    if (addValue.trim()) {
                      onAdd(addValue.trim());
                      setAddValue("");
                      setAddInputOpen(false);
                    }
                  }}
                  disabled={addLoading || !addValue.trim()}
                  className="text-primary/70 hover:text-primary disabled:opacity-30 p-1"
                >
                  {addLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                </button>
                <button
                  onClick={() => { setAddInputOpen(false); setAddValue(""); }}
                  className="text-muted-foreground/50 hover:text-foreground p-1"
                >
                  <X size={12} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setAddInputOpen(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                >
                  <Plus size={11} /> Add source
                </button>
                <div className="flex-1" />
                <button
                  onClick={onRefresh}
                  disabled={refreshLoading}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors px-2 py-1"
                >
                  <RefreshCw size={11} className={refreshLoading ? "animate-spin" : ""} />
                  Refresh
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main PluginsTab ──

export default function PluginsTab({ projectId: _projectId }: Props) {
  const { isGlass } = useTheme();

  const [data, setData] = useState<PluginsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeType, setActiveType] = useState("all");
  const [selected, setSelected] = useState<AnyPlugin | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [addMktLoading, setAddMktLoading] = useState(false);
  const [refreshMktLoading, setRefreshMktLoading] = useState(false);
  const [pendingUninstall, setPendingUninstall] = useState<{ name: string; marketplace: string; scope: string } | null>(null);
  const [pendingRemoveMkt, setPendingRemoveMkt] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadPlugins = useCallback(async () => {
    try {
      const result = await invoke<PluginsOverview>("list_plugins");
      setData(result);
    } catch (e) {
      console.error("Failed to list plugins:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  // Build a merged list: all available plugins + any installed plugins not in available
  const allPlugins = useMemo(() => {
    if (!data) return [];

    // Start with available (which already has isInstalled flag)
    const merged: Array<{
      plugin: AvailablePlugin;
      installedData: InstalledPlugin | null;
    }> = data.available.map((a) => ({
      plugin: a,
      installedData: data.installed.find(
        (i) => i.name === a.name && i.marketplace === a.marketplace,
      ) ?? null,
    }));

    // Add installed plugins that aren't in available (from other marketplaces, etc.)
    for (const inst of data.installed) {
      const alreadyMerged = merged.some(
        (m) => m.plugin.name === inst.name && m.plugin.marketplace === inst.marketplace,
      );
      if (!alreadyMerged) {
        merged.push({
          plugin: {
            name: inst.name,
            marketplace: inst.marketplace,
            description: inst.description,
            authorName: inst.authorName,
            uniqueInstalls: 0,
            isInstalled: true,
            isBlocked: false,
            category: inst.category,
            keywords: inst.keywords,
            extensionType: inst.extensionType,
            components: inst.components,
          },
          installedData: inst,
        });
      }
    }

    return merged;
  }, [data]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allPlugins.length };
    for (const { plugin } of allPlugins) {
      const cat = plugin.category || "general";
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [allPlugins]);

  // Type counts
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allPlugins.length };
    for (const { plugin } of allPlugins) {
      const t = plugin.extensionType || "plugin";
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [allPlugins]);

  // Visible types: "all" first, then only types with plugins, sorted by label
  const visibleTypes = useMemo(() => {
    const types = Object.entries(typeCounts)
      .filter(([id, count]) => id !== "all" && count > 0)
      .sort(([a], [b]) => {
        const labelA = (TYPE_META[a]?.label ?? a).toLowerCase();
        const labelB = (TYPE_META[b]?.label ?? b).toLowerCase();
        return labelA.localeCompare(labelB);
      })
      .map(([id]) => id);
    return ["all", ...types];
  }, [typeCounts]);

  // Visible categories: "all" first, then sorted alphabetically by label
  const visibleCategories = useMemo(() => {
    const cats = Object.entries(categoryCounts)
      .filter(([id, count]) => id !== "all" && count > 0)
      .sort(([a], [b]) => {
        const labelA = (CATEGORY_META[a]?.label ?? a).toLowerCase();
        const labelB = (CATEGORY_META[b]?.label ?? b).toLowerCase();
        return labelA.localeCompare(labelB);
      })
      .map(([id]) => id);
    return ["all", ...cats];
  }, [categoryCounts]);

  // Filtered + searched plugins
  const filteredPlugins = useMemo(() => {
    let result = allPlugins;

    // Type filter
    if (activeType !== "all") {
      result = result.filter((m) => (m.plugin.extensionType || "plugin") === activeType);
    }

    // Category filter
    if (activeCategory !== "all") {
      result = result.filter((m) => (m.plugin.category || "general") === activeCategory);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.plugin.name.toLowerCase().includes(q) ||
          m.plugin.description.toLowerCase().includes(q) ||
          m.plugin.authorName.toLowerCase().includes(q) ||
          m.plugin.keywords.some((kw) => kw.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [allPlugins, activeType, activeCategory, searchQuery]);

  // Separate installed from the filtered list for the "installed" callout
  const installedCount = data?.installed.length ?? 0;

  // Keep selection in sync after data reload
  useEffect(() => {
    if (!data || !selected) return;
    if (selected.kind === "installed") {
      const still = data.installed.find(
        (p) => p.name === selected.plugin.name && p.marketplace === selected.plugin.marketplace,
      );
      if (!still) {
        const avail = data.available.find(
          (p) => p.name === selected.plugin.name && p.marketplace === selected.plugin.marketplace,
        );
        if (avail) setSelected({ kind: "available", plugin: avail });
        else setSelected(null);
      } else {
        setSelected({ kind: "installed", plugin: still });
      }
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Action handlers ──

  const withBackground = useCallback(
    async (label: string, fn: () => Promise<void>, successMessage?: string) => {
      const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
      addBackgroundTask(label);
      try {
        await fn();
        await loadPlugins();
        if (successMessage) {
          useAppStore.getState().flashSuccess(successMessage);
        }
      } catch (e) {
        console.error(`${label} failed:`, e);
        useAppStore.getState().flashError(`${label} failed: ${formatError(e)}`);
      } finally {
        removeBackgroundTask(label);
      }
    },
    [loadPlugins],
  );

  const handleInstall = useCallback(
    async (name: string, marketplace: string) => {
      const key = `install:${name}@${marketplace}`;
      setActionLoading(key);
      await withBackground(`Installing ${name}`, async () => {
        await invoke("install_plugin", {
          pluginName: `${name}@${marketplace}`,
          scope: "user",
        });
      }, `Installed ${name}`);
      setActionLoading(null);
    },
    [withBackground],
  );

  const handleUninstall = useCallback(
    async (name: string, marketplace: string, scope: string) => {
      const key = `uninstall:${name}@${marketplace}`;
      setActionLoading(key);
      await withBackground(`Uninstalling ${name}`, async () => {
        await invoke("uninstall_plugin", {
          pluginName: `${name}@${marketplace}`,
          scope,
        });
      }, `Uninstalled ${name}`);
      setActionLoading(null);
    },
    [withBackground],
  );

  const handleUpdate = useCallback(
    async (name: string, marketplace: string, scope: string) => {
      const key = `update:${name}@${marketplace}`;
      setActionLoading(key);
      await withBackground(`Updating ${name}`, async () => {
        await invoke("update_plugin", {
          pluginName: `${name}@${marketplace}`,
          scope,
        });
      }, `Updated ${name}`);
      setActionLoading(null);
    },
    [withBackground],
  );

  const requestUninstall = useCallback(
    (name: string, marketplace: string, scope: string) => {
      setPendingUninstall({ name, marketplace, scope });
    },
    [],
  );

  const requestRemoveMarketplace = useCallback((name: string) => {
    setPendingRemoveMkt(name);
  }, []);

  const handleAddMarketplace = useCallback(
    async (source: string) => {
      setAddMktLoading(true);
      await withBackground(`Adding marketplace: ${source}`, async () => {
        await invoke("add_marketplace", { source, scope: "user" });
      });
      setAddMktLoading(false);
    },
    [withBackground],
  );

  const handleRemoveMarketplace = useCallback(
    async (name: string) => {
      await withBackground(`Removing marketplace: ${name}`, async () => {
        await invoke("remove_marketplace", { name });
      });
    },
    [withBackground],
  );

  const handleRefreshMarketplaces = useCallback(async () => {
    setRefreshMktLoading(true);
    await withBackground("Updating marketplace catalogs", async () => {
      await invoke("update_marketplaces");
    });
    setRefreshMktLoading(false);
  }, [withBackground]);

  // ── Render ──

  if (loading) {
    return (
      <div className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 p-4 ${glassStyles[isGlass ? "normal" : "solid"]}`}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} type={isGlass ? "normal" : "solid"} hasHeader lines={2} />
          ))}
        </div>
      </div>
    );
  }

  if (data && !data.claudeCliAvailable) {
    return (
      <div
        className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 flex flex-col items-center justify-center gap-3 text-muted-foreground ${glassStyles[isGlass ? "normal" : "solid"]}`}
      >
        <AlertTriangle className="size-8 opacity-30" />
        <p className="text-sm font-medium">Claude Code CLI not found</p>
        <p className="text-xs opacity-60 max-w-sm text-center">
          The plugin marketplace requires the Claude Code CLI to install and manage extensions.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => open("https://docs.anthropic.com/en/docs/claude-code")}
          leftIcon={<ExternalLink className="size-3" />}
          hoverEffect="scale"
          clickEffect="scale"
        >
          Install Claude Code
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 flex ${glassStyles[isGlass ? "normal" : "solid"]}`}
    >
      {/* Main content area */}
      <div className={`flex-1 min-w-0 flex flex-col overflow-hidden ${selected ? "hidden sm:flex" : "flex"}`}>
        {/* Toolbar: search + category chips */}
        <div className="shrink-0 px-3 pt-2.5 pb-2 space-y-2 border-b border-border/30">
          {/* Search row */}
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-1.5 bg-accent/30 rounded-md px-2.5 py-1.5 ring-1 ring-border/20 focus-within:ring-primary/40 transition-all">
              <Search size={13} className="text-muted-foreground shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search extensions..."
                className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    searchInputRef.current?.focus();
                  }}
                  className="text-muted-foreground/40 hover:text-foreground"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <button
              onClick={() => {
                setLoading(true);
                loadPlugins();
              }}
              className="text-muted-foreground/50 hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent/40"
              title="Refresh"
            >
              <RefreshCw size={13} />
            </button>
            {installedCount > 0 && (
              <span className="text-2xs text-primary/70 bg-primary/10 px-2 py-1 rounded-md whitespace-nowrap">
                {installedCount} installed
              </span>
            )}
          </div>

          {/* Type filter chips */}
          {visibleTypes.length > 2 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-2xs text-muted-foreground/50 uppercase tracking-wider mr-0.5">Type</span>
              {visibleTypes.map((id) => (
                <TypeFilterChip
                  key={id}
                  id={id}
                  active={activeType === id}
                  count={typeCounts[id] ?? 0}
                  onClick={() => setActiveType(id)}
                />
              ))}
            </div>
          )}

          {/* Category filter chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-2xs text-muted-foreground/50 uppercase tracking-wider mr-0.5">Category</span>
            {visibleCategories.map((id) => (
              <CategoryChip
                key={id}
                id={id}
                active={activeCategory === id}
                count={categoryCounts[id] ?? 0}
                onClick={() => setActiveCategory(id)}
              />
            ))}
          </div>
        </div>

        {/* Plugin grid */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {filteredPlugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Package className="size-8 opacity-15" />
              <p className="text-sm">
                {searchQuery
                  ? `No extensions matching "${searchQuery}"`
                  : "No extensions available"}
              </p>
              {!searchQuery && data?.marketplaces.length === 0 && (
                <p className="text-xs opacity-60">
                  Add a marketplace source to browse extensions
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {filteredPlugins.map(({ plugin, installedData }) => (
                <PluginCard
                  key={`${plugin.name}@${plugin.marketplace}`}
                  plugin={plugin}
                  isInstalled={plugin.isInstalled}
                  installedScope={installedData?.scope}
                  isBlocked={plugin.isBlocked}
                  onSelect={() => {
                    if (installedData) {
                      setSelected({ kind: "installed", plugin: installedData });
                    } else {
                      setSelected({ kind: "available", plugin });
                    }
                  }}
                  onInstall={() => handleInstall(plugin.name, plugin.marketplace)}
                  onUninstall={() =>
                    requestUninstall(
                      plugin.name,
                      plugin.marketplace,
                      installedData?.scope ?? "user",
                    )
                  }
                  actionLoading={actionLoading}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}
        </div>

        {/* Marketplace sources footer */}
        <MarketplaceSources
          marketplaces={data?.marketplaces ?? []}
          onAdd={handleAddMarketplace}
          onRemove={requestRemoveMarketplace}
          onRefresh={handleRefreshMarketplaces}
          addLoading={addMktLoading}
          refreshLoading={refreshMktLoading}
        />
      </div>

      {/* Detail panel — slides in from right */}
      {selected && (
        <div className="w-[380px] max-w-[40%] shrink-0 border-l border-border/40 overflow-hidden">
          <PluginDetailDrawer
            selected={selected}
            onClose={() => setSelected(null)}
            onInstall={handleInstall}
            onUninstall={requestUninstall}
            onUpdate={handleUpdate}
            actionLoading={actionLoading}
          />
        </div>
      )}

      {pendingUninstall && (
        <ConfirmDialog
          variant="danger"
          title="Uninstall plugin?"
          message={`This will uninstall "${pendingUninstall.name}" and remove its skills, agents, and hooks from your environment.`}
          confirmLabel="Uninstall"
          onConfirm={() => {
            const { name, marketplace, scope } = pendingUninstall;
            setPendingUninstall(null);
            handleUninstall(name, marketplace, scope);
          }}
          onCancel={() => setPendingUninstall(null)}
        />
      )}

      {pendingRemoveMkt && (
        <ConfirmDialog
          variant="danger"
          title="Remove marketplace?"
          message={`This will remove the "${pendingRemoveMkt}" marketplace source. Plugins already installed from it will remain, but you won't see new updates.`}
          confirmLabel="Remove"
          onConfirm={() => {
            const name = pendingRemoveMkt;
            setPendingRemoveMkt(null);
            handleRemoveMarketplace(name);
          }}
          onCancel={() => setPendingRemoveMkt(null)}
        />
      )}
    </div>
  );
}
