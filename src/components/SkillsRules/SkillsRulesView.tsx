import { ArrowUpCircle, Blocks, Bot } from "lucide-react";
import { useMemo, useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { AgentIcon } from "../../lib/agentIcons";
import { useAppStore } from "../../store/appStore";
import { ViewLayout } from "../Shell/ViewLayout";
import { Tabs } from "../ui/orecus.io/navigation/tabs";
import AgentsExtensionTab from "./AgentsExtensionTab";
import PluginsTab from "./PluginsTab";
import RulesTab from "./RulesTab";
import SkillsTab from "./SkillsTab";

type ExtensionsTab = "rules" | "skills" | "plugins" | "agents";

export default function SkillsRulesView() {
  const accentColor = useProjectAccentColor();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const agents = useAppStore((s) => s.agents);
  const acpUpdatesAvailable = useAppStore((s) => s.acpUpdatesAvailable);
  const isClaudeInstalled = useMemo(
    () => agents.some((a) => a.name === "claude-code" && a.installed),
    [agents],
  );
  const [activeTab, setActiveTab] = useState<ExtensionsTab>(
    acpUpdatesAvailable > 0 ? "agents" : "rules",
  );

  if (!activeProjectId) {
    return (
      <div
        className="flex flex-col items-center justify-center text-muted-foreground"
        style={{ gridArea: "content" }}
      >
        <Blocks className="mb-3 size-10 opacity-30" />
        <p className="text-sm">Select a project to manage extensions</p>
        <p className="mt-1 text-xs opacity-60">
          Open a project tab to get started
        </p>
      </div>
    );
  }

  return (
    <ViewLayout>
      <ViewLayout.Toolbar>
        <span className="text-sm font-medium text-foreground mr-1">
          Extensions
        </span>

        <Tabs<ExtensionsTab>
          value={activeTab}
          onChange={setActiveTab}
          animation="slide"
          variant="none"
          indicatorVariant="color"
          size="sm"
          color={accentColor}
          align="start"
          barRadius="md"
          tabRadius="md"
          fullWidth={false}
          className="p-0"
        >
          <Tabs.Tab value="rules">Rules</Tabs.Tab>
          <Tabs.Tab value="skills">Skills</Tabs.Tab>
          <Tabs.Tab
            value="plugins"
            icon={<AgentIcon agent="claude-code" size={13} />}
            disabled={!isClaudeInstalled}
          >
            Plugins
          </Tabs.Tab>
          <Tabs.Tab
            value="agents"
            icon={<Bot size={13} />}
            badge={
              acpUpdatesAvailable > 0 ? (
                <span className="ml-0.5 flex items-center gap-1 rounded-full bg-warning/20 px-1.5 py-0.5 text-2xs font-bold text-warning">
                  <ArrowUpCircle size={9} />
                  {acpUpdatesAvailable} {acpUpdatesAvailable === 1 ? "update" : "updates"}
                </span>
              ) : undefined
            }
          >
            Agents
          </Tabs.Tab>
        </Tabs>

        <div className="flex-1" />
      </ViewLayout.Toolbar>

      <div className="flex flex-col flex-1 min-h-0">
        {activeTab === "rules" && <RulesTab projectId={activeProjectId} />}
        {activeTab === "skills" && <SkillsTab projectId={activeProjectId} />}
        {activeTab === "plugins" && <PluginsTab projectId={activeProjectId} />}
        {activeTab === "agents" && (
          <AgentsExtensionTab projectId={activeProjectId} />
        )}
      </div>
    </ViewLayout>
  );
}
