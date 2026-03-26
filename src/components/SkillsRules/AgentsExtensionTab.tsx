import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  Bot,
  Cloud,
  Loader2,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatError } from "../../lib/errorMessages";
import { useAppStore } from "../../store/appStore";
import type { AgentInfo } from "../../types";
import AgentExtensionCard from "./AgentExtensionCard";

interface AcpInstallEvent {
  agent_name: string;
  status: "installing" | "completed" | "failed";
  message: string;
}

export default function AgentsExtensionTab({
  projectId: _projectId,
}: {
  projectId: string;
}) {
  const agents = useAppStore((s) => s.agents);
  const acpRegistry = useAppStore((s) => s.acpRegistry);
  const acpRegistryLoading = useAppStore((s) => s.acpRegistryLoading);
  const acpRegistryError = useAppStore((s) => s.acpRegistryError);
  const fetchAcpRegistry = useAppStore((s) => s.fetchAcpRegistry);

  const [installingAdapter, setInstallingAdapter] = useState<string | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const installedCount = useMemo(
    () => agents.filter((a) => a.installed).length,
    [agents],
  );
  const acpReadyCount = useMemo(
    () => agents.filter((a) => a.acp_installed).length,
    [agents],
  );

  // Build a lookup map from faber agent name → registry entry
  const registryByAgent = useMemo(() => {
    const map = new Map<string, (typeof acpRegistry)[number]>();
    for (const entry of acpRegistry) {
      map.set(entry.faber_agent_name, entry);
    }
    return map;
  }, [acpRegistry]);

  // Fetch registry on first mount
  useEffect(() => {
    if (acpRegistry.length === 0 && !acpRegistryLoading) {
      fetchAcpRegistry();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for ACP adapter install progress events
  useEffect(() => {
    const unlisten = listen<AcpInstallEvent>(
      "acp-adapter-install-progress",
      (event) => {
        const { status, message } = event.payload;
        if (status === "completed" || status === "failed") {
          setInstallingAdapter(null);
          if (status === "failed") {
            setInstallError(message);
            setTimeout(() => setInstallError(null), 6000);
          }
        }
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Refresh both agents and registry in parallel
      const [updated] = await Promise.all([
        invoke<AgentInfo[]>("list_agents"),
        fetchAcpRegistry(true),
      ]);
      useAppStore.getState().setAgents(updated);
    } catch {
      // Refresh failures are non-critical
    } finally {
      setRefreshing(false);
    }
  }, [fetchAcpRegistry]);

  const handleInstallAdapter = useCallback(async (agentName: string, isUpdate: boolean = false) => {
    setInstallingAdapter(agentName);
    setInstallError(null);
    try {
      // When updating, pin to the exact registry version so npm installs that specific version
      const targetVersion = isUpdate
        ? registryByAgent.get(agentName)?.registry_version
        : undefined;
      const updated = await invoke<AgentInfo[]>("install_acp_adapter", {
        agentName,
        targetVersion,
      });
      useAppStore.getState().setAgents(updated);
      useAppStore.getState().flashSuccess(isUpdate ? `Updated ${agentName} adapter` : `Installed ${agentName} adapter`);

      // Re-fetch registry so update_available is recalculated with the new version
      // (backend caches were invalidated by install_acp_adapter)
      await fetchAcpRegistry(true);
    } catch (err) {
      setInstallError(formatError(err));
      setTimeout(() => setInstallError(null), 6000);
    } finally {
      setInstallingAdapter(null);
    }
  }, [fetchAcpRegistry, registryByAgent]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-muted-foreground" />
            <span className="text-[13px] font-medium text-foreground">
              {installedCount} of {agents.length} installed
            </span>
          </div>
          <span className="text-border">·</span>
          <div className="flex items-center gap-1.5">
            <Wifi size={12} className="text-muted-foreground" />
            <span className="text-[12px] text-muted-foreground">
              {acpReadyCount} ACP ready
            </span>
          </div>
          {acpRegistry.length > 0 && (
            <>
              <span className="text-border">·</span>
              <div className="flex items-center gap-1.5">
                <Cloud size={12} className="text-primary/60" />
                <span className="text-[12px] text-muted-foreground">
                  {acpRegistry.length} in registry
                </span>
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          Refresh
        </button>
      </div>

      {/* Error toasts */}
      {installError && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {installError}
        </div>
      )}
      {acpRegistryError && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <AlertCircle size={13} className="shrink-0" />
          <span>
            Registry unavailable — showing local data only.{" "}
            <span className="text-muted-foreground">
              {acpRegistryError}
            </span>
          </span>
        </div>
      )}

      {/* Registry loading indicator */}
      {acpRegistryLoading && acpRegistry.length === 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          Fetching ACP registry...
        </div>
      )}

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <AgentExtensionCard
            key={agent.name}
            agent={agent}
            installing={installingAdapter === agent.name}
            onInstallAdapter={handleInstallAdapter}
            registryEntry={registryByAgent.get(agent.name)}
          />
        ))}
      </div>
    </div>
  );
}
