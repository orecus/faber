import { Puzzle } from "lucide-react";
import { useState } from "react";

import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import { ViewLayout } from "../Shell/ViewLayout";
import { Tabs } from "../ui/orecus.io/navigation/tabs";
import RulesTab from "./RulesTab";
import SkillsTab from "./SkillsTab";

type SkillsRulesTab = "rules" | "skills";

export default function SkillsRulesView() {
  const accentColor = useProjectAccentColor();
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const [activeTab, setActiveTab] = useState<SkillsRulesTab>("rules");

  if (!activeProjectId) {
    return (
      <div
        className="flex flex-col items-center justify-center text-muted-foreground"
        style={{ gridArea: "content" }}
      >
        <Puzzle className="mb-3 size-10 opacity-30" />
        <p className="text-sm">Select a project to manage skills & rules</p>
        <p className="mt-1 text-xs opacity-60">
          Open a project tab to get started
        </p>
      </div>
    );
  }

  return (
    <ViewLayout>
      <ViewLayout.Toolbar>
        <span className="text-[13px] font-medium text-foreground mr-1">
          Skills & Rules
        </span>

        <Tabs<SkillsRulesTab>
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
        >
          <Tabs.Tab value="rules">Rules</Tabs.Tab>
          <Tabs.Tab value="skills">Skills</Tabs.Tab>
        </Tabs>

        <div className="flex-1" />
      </ViewLayout.Toolbar>

      {activeTab === "rules" && <RulesTab projectId={activeProjectId} />}
      {activeTab === "skills" && <SkillsTab projectId={activeProjectId} />}
    </ViewLayout>
  );
}
