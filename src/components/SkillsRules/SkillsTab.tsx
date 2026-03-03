import { invoke } from "@tauri-apps/api/core";
import {
  Download,
  ExternalLink,
  Loader2,
  Package,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-shell";

import { useTheme } from "../../contexts/ThemeContext";
import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";
import InstalledSkillsList from "./InstalledSkillsList";

interface SkillSearchResult {
  id: string;
  skill_id: string;
  name: string;
  installs: number;
  source: string;
}

interface Props {
  projectId: string;
}

export default function SkillsTab({ projectId }: Props) {
  const { isGlass } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await invoke<SkillSearchResult[]>("search_skills", {
        query: q.trim(),
      });
      setResults(res);
    } catch (e) {
      console.error("Skills search failed:", e);
      setSearchError(String(e));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  const handleInstall = useCallback(
    async (skill: SkillSearchResult) => {
      const { addBackgroundTask, removeBackgroundTask, setActiveView } =
        useAppStore.getState();
      const taskLabel = `Installing skill: ${skill.name}`;
      addBackgroundTask(taskLabel);
      setInstalling(skill.id);
      try {
        await invoke("start_skill_install_session", {
          projectId,
          source: skill.source,
          skillName: skill.name,
        });
        setActiveView("sessions");
      } catch (e) {
        console.error("Skill install failed:", e);
        useAppStore.getState().flashError(`Install failed: ${e}`);
      } finally {
        setInstalling(null);
        removeBackgroundTask(taskLabel);
      }
    },
    [projectId],
  );

  const handleRemove = useCallback(
    async (skillName: string, global: boolean) => {
      const { addBackgroundTask, removeBackgroundTask } =
        useAppStore.getState();
      const taskLabel = `Removing skill: ${skillName}`;
      addBackgroundTask(taskLabel);
      try {
        await invoke("remove_skill", {
          projectId,
          skillName,
          global,
        });
        setRefreshKey((k) => k + 1);
      } catch (e) {
        console.error("Skill remove failed:", e);
        useAppStore.getState().flashError(`Remove failed: ${e}`);
      } finally {
        removeBackgroundTask(taskLabel);
      }
    },
    [projectId],
  );

  return (
    <div
      className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 flex flex-col ${glassStyles[isGlass ? "normal" : "solid"]}`}
    >
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50 shrink-0">
        <Search size={14} className="text-muted-foreground shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills on skills.sh..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {searching && (
          <Loader2
            size={14}
            className="animate-spin text-muted-foreground shrink-0"
          />
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Search results */}
        {query.trim() && (
          <div className="border-b border-border/30">
            <div className="px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Search Results
              </span>
            </div>

            {searchError && (
              <div className="px-3 py-2 text-xs text-destructive">
                {searchError}
              </div>
            )}

            {!searching && results.length === 0 && !searchError && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No skills found for &quot;{query}&quot;
              </div>
            )}

            <div className="px-3 pb-3 space-y-2">
              {results.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-start gap-3 p-3 rounded-md bg-accent/30 hover:bg-accent/50 transition-colors"
                >
                  <Package
                    size={16}
                    className="text-muted-foreground mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => open(`https://skills.sh/${skill.id}`)}
                        className="text-sm font-medium text-foreground hover:text-primary truncate transition-colors inline-flex items-center gap-1"
                        title={`View on skills.sh`}
                      >
                        {skill.name}
                        <ExternalLink
                          size={11}
                          className="opacity-50 shrink-0"
                        />
                      </button>
                      {skill.installs > 0 && (
                        <span className="text-[10px] text-muted-foreground bg-accent/60 px-1.5 py-0.5 rounded-full">
                          {skill.installs.toLocaleString()} installs
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-dim-foreground truncate">
                        {skill.source}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleInstall(skill)}
                    disabled={installing === skill.id}
                    leftIcon={
                      installing === skill.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Download className="size-3" />
                      )
                    }
                    hoverEffect="scale"
                    clickEffect="scale"
                  >
                    Install
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Installed skills */}
        <InstalledSkillsList
          projectId={projectId}
          refreshKey={refreshKey}
          onRemove={handleRemove}
        />
      </div>
    </div>
  );
}
