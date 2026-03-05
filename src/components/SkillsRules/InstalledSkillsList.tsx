import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Globe,
  Loader2,
  Package,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/orecus.io/components/enhanced-button";

interface SkillInfo {
  name: string;
  path: string;
  description: string;
  is_global: boolean;
}

interface InstalledSkillsResponse {
  project_skills: SkillInfo[];
  global_skills: SkillInfo[];
}

interface Props {
  projectId: string;
  refreshKey: number;
  onRemove: (skillName: string, global: boolean) => void;
}

export default function InstalledSkillsList({
  projectId,
  refreshKey,
  onRemove,
}: Props) {
  const [data, setData] = useState<InstalledSkillsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<InstalledSkillsResponse>(
        "list_installed_skills",
        { projectId }
      );
      setData(result);
    } catch (e) {
      console.error("Failed to list installed skills:", e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills, refreshKey]);

  const handleRemove = useCallback(
    async (skill: SkillInfo) => {
      setRemoving(skill.name);
      await onRemove(skill.name, skill.is_global);
      setRemoving(null);
    },
    [onRemove]
  );

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const projectSkills = data?.project_skills ?? [];
  const globalSkills = data?.global_skills ?? [];
  const hasAny = projectSkills.length > 0 || globalSkills.length > 0;

  if (!hasAny) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
        <Package className="size-8 opacity-30" />
        <p className="text-sm">No skills installed</p>
        <p className="text-xs opacity-70">
          Search above to find and install skills from skills.sh
        </p>
      </div>
    );
  }

  const renderSection = (
    sectionKey: string,
    title: string,
    icon: React.ReactNode,
    skills: SkillInfo[]
  ) => {
    if (skills.length === 0) return null;
    const isCollapsed = collapsedSections[sectionKey] ?? false;
    return (
      <div>
        <button
          type="button"
          className="w-full px-3 py-2 flex items-center gap-2 hover:bg-accent/30 transition-colors cursor-pointer"
          onClick={() => toggleSection(sectionKey)}
        >
          {isCollapsed ? (
            <ChevronRight size={12} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown size={12} className="text-muted-foreground shrink-0" />
          )}
          {icon}
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {title}
          </span>
          <span className="text-[10px] text-muted-foreground/70 bg-accent/40 px-1.5 py-0.5 rounded-full">
            {skills.length}
          </span>
        </button>
        {!isCollapsed && (
          <div className="px-3 pb-3 space-y-1.5">
            {skills.map((skill) => (
              <div
                key={skill.path}
                className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-accent/20 hover:bg-accent/40 transition-colors"
              >
                <Package size={13} className="text-primary/70 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">
                    {skill.name}
                  </span>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {skill.description}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(skill)}
                  disabled={removing === skill.name}
                  leftIcon={
                    removing === skill.name ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )
                  }
                  className="text-destructive/70 hover:text-destructive"
                  hoverEffect="scale"
                  clickEffect="scale"
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Installed Skills
        </span>
      </div>
      {renderSection(
        "project",
        "Project",
        <FolderOpen size={12} className="text-muted-foreground" />,
        projectSkills
      )}
      {renderSection(
        "global",
        "Global",
        <Globe size={12} className="text-muted-foreground" />,
        globalSkills
      )}
    </div>
  );
}
