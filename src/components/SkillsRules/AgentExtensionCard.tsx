import {
  AlertTriangle,
  ArrowUpCircle,
  Check,
  Download,
  ExternalLink,
  Globe,
  RotateCcw,
  Terminal,
  X,
} from "lucide-react";
import React from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { AGENT_DESCRIPTIONS } from "../../lib/agentDescriptions";
import { AgentIcon, getAgentColor } from "../../lib/agentIcons";
import type { AcpRegistryEntry, AgentInfo } from "../../types";
import {
  Card,
  CardContent,
} from "../ui/orecus.io/cards/card";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface AgentExtensionCardProps {
  agent: AgentInfo;
  installing: boolean;
  onInstallAdapter: (name: string, isUpdate: boolean) => void;
  /** Whether this agent was just updated in the current session. */
  justUpdated: boolean;
  /** Registry entry for this agent (if fetched). */
  registryEntry?: AcpRegistryEntry;
}

const AgentExtensionCard = React.memo(function AgentExtensionCard({
  agent,
  installing,
  onInstallAdapter,
  justUpdated,
  registryEntry,
}: AgentExtensionCardProps) {
  const { isGlass } = useTheme();
  const accentColor = getAgentColor(agent.name);
  const description = AGENT_DESCRIPTIONS[agent.name];

  const needsAdapter = agent.supports_acp && !!agent.acp_install_command;
  const hasNativeAcp = agent.supports_acp && !agent.acp_install_command;

  return (
    <Card
      type={isGlass ? "normal" : "solid"}
      radius="lg"
      className="flex flex-col"
    >
      <CardContent className="flex flex-col gap-3 p-4">
        {/* ── Header: icon + name + status ── */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Agent icon with brand-tinted background */}
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                backgroundColor: `color-mix(in oklch, ${accentColor} 12%, transparent)`,
              }}
            >
              <AgentIcon agent={agent.name} size={22} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold leading-tight text-foreground">
                {agent.display_name}
              </span>
              {description && (
                <span className="text-[11px] leading-tight text-muted-foreground">
                  {description}
                </span>
              )}
            </div>
          </div>

          {/* CLI status badge */}
          {agent.installed ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
              <span className="size-1.5 rounded-full bg-success" />
              Installed
            </span>
          ) : agent.cli_install_url ? (
            <a
              href={agent.cli_install_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/25"
            >
              <Download size={10} />
              Install CLI
            </a>
          ) : (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground/40" />
              Not Installed
            </span>
          )}
        </div>

        {/* ── Info chips: CLI command + default model + registry version ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-dim-foreground">
            <Terminal size={10} className="text-muted-foreground" />
            {agent.command}
          </span>
          {agent.default_model && (
            <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              {agent.default_model}
            </span>
          )}
          {justUpdated && registryEntry ? (
            <span className="flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 font-mono text-[11px] text-success">
              <Check size={9} strokeWidth={2.5} />
              v{registryEntry.registry_version}
            </span>
          ) : (
            <>
              {registryEntry?.installed_version && (
                <span
                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] ${
                    registryEntry.update_available
                      ? "bg-muted/60 text-muted-foreground line-through decoration-muted-foreground/40"
                      : "bg-primary/10 text-primary/80"
                  }`}
                >
                  <Globe size={9} className="opacity-60" />
                  v{registryEntry.installed_version}
                </span>
              )}
              {registryEntry?.update_available && (
                <span className="flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 font-mono text-[11px] text-warning">
                  <ArrowUpCircle size={9} />
                  v{registryEntry.registry_version}
                </span>
              )}
              {registryEntry && !registryEntry.installed_version && (
                <span className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary/80">
                  <Globe size={9} className="opacity-60" />
                  v{registryEntry.registry_version}
                </span>
              )}
            </>
          )}
        </div>

        {/* ── CLI Install hint (when not installed) ── */}
        {!agent.installed && agent.cli_install_hint && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <Terminal size={12} className="shrink-0 text-muted-foreground" />
            <code className="flex-1 select-all text-[11px] text-dim-foreground">
              {agent.cli_install_hint}
            </code>
            {agent.cli_install_url && (
              <a
                href={agent.cli_install_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                title="Open install page"
              >
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}

        {/* ── ACP Status ── */}
        <div className="border-t border-border/50 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Native ACP */}
              {hasNativeAcp && (
                <>
                  {agent.installed ? (
                    <Check
                      size={13}
                      className="shrink-0 text-success"
                      strokeWidth={2.5}
                    />
                  ) : (
                    <Check
                      size={13}
                      className="shrink-0 text-muted-foreground/40"
                      strokeWidth={2.5}
                    />
                  )}
                  <span
                    className={`text-[12px] ${agent.installed ? "text-dim-foreground" : "text-muted-foreground"}`}
                  >
                    Built-in ACP
                  </span>
                </>
              )}

              {/* Adapter-based ACP */}
              {needsAdapter && (
                <>
                  {agent.acp_installed ? (
                    <>
                      <Check
                        size={13}
                        className="shrink-0 text-success"
                        strokeWidth={2.5}
                      />
                      <div className="flex flex-col">
                        <span className="text-[12px] text-dim-foreground">
                          ACP Ready
                        </span>
                        {agent.acp_adapter_package && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {agent.acp_adapter_package}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertTriangle
                        size={13}
                        className="shrink-0 text-warning"
                      />
                      <span className="text-[12px] text-muted-foreground">
                        Adapter Not Installed
                      </span>
                    </>
                  )}
                </>
              )}

              {/* No ACP support */}
              {!agent.supports_acp && (
                <>
                  <X
                    size={13}
                    className="shrink-0 text-muted-foreground/40"
                    strokeWidth={2.5}
                  />
                  <span className="text-[12px] text-muted-foreground/60">
                    ACP not supported
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Update available / just updated */}
              {justUpdated ? (
                <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-medium text-success">
                  <RotateCcw size={11} />
                  Restart app to apply
                </span>
              ) : (
                registryEntry?.update_available && agent.acp_installed && (
                  <Button
                    variant="outline"
                    size="sm"
                    hoverEffect="none"
                    clickEffect="scale"
                    onClick={() => onInstallAdapter(agent.name, true)}
                    disabled={installing}
                    loading={installing}
                    leftIcon={!installing ? <ArrowUpCircle size={12} /> : undefined}
                    className="h-7 px-2.5 text-[11px] border-warning/40 text-warning hover:bg-warning/10 hover:text-warning cursor-pointer"
                  >
                    Update to v{registryEntry.registry_version}
                  </Button>
                )
              )}

              {/* Install adapter button */}
              {needsAdapter && !agent.acp_installed && !justUpdated && (
                <Button
                  variant="outline"
                  size="sm"
                  hoverEffect="none"
                  clickEffect="scale"
                  onClick={() => onInstallAdapter(agent.name, false)}
                  disabled={installing || !agent.installed}
                  loading={installing}
                  leftIcon={!installing ? <Download size={12} /> : undefined}
                  className="h-7 px-2.5 text-[11px]"
                >
                  Install Adapter
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── Registry info row ── */}
        {registryEntry && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {registryEntry.license && (
                <span className="rounded-md bg-muted/40 px-1.5 py-px text-[10px] text-muted-foreground">
                  {registryEntry.license}
                </span>
              )}
              {registryEntry.authors.length > 0 && (
                <span className="text-[10px] text-muted-foreground/70">
                  by {registryEntry.authors.join(", ")}
                </span>
              )}
            </div>
            {registryEntry.repository && (
              <a
                href={registryEntry.repository}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink size={9} />
                Repo
              </a>
            )}
          </div>
        )}

        {/* ── Supported models ── */}
        {agent.supported_models.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {agent.supported_models.map((model) => (
              <span
                key={model}
                className="rounded-md bg-muted/40 px-1.5 py-px text-[10px] text-muted-foreground"
              >
                {model}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

export default AgentExtensionCard;
