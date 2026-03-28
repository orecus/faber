import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import {
  BookOpen,
  Bot,
  CircleHelp,
  FileText,
  GitPullRequest,
  ListChecks,
  Loader2,
  MessageCircle,
  Puzzle,
  Shield,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Streamdown } from "streamdown";

import { useTheme } from "../../contexts/ThemeContext";
import {
  streamdownControls,
  streamdownPlugins,
  streamdownTheme,
} from "../../lib/markdown";
import { ViewLayout } from "../Shell/ViewLayout";
import SidePanel from "../ui/SidePanel";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";

import type { DocContent, DocEntry } from "../../types";
import type { LucideIcon } from "lucide-react";

// Map lucide icon names from frontmatter to components
const ICON_MAP: Record<string, LucideIcon> = {
  "git-pull-request": GitPullRequest,
  "file-text": FileText,
  "book-open": BookOpen,
  "circle-help": CircleHelp,
  "list-checks": ListChecks,
  "message-circle": MessageCircle,
  bot: Bot,
  puzzle: Puzzle,
  shield: Shield,
};

function DocIcon({ name, size = 14 }: { name: string; size?: number }) {
  const Icon = ICON_MAP[name] ?? FileText;
  return <Icon size={size} />;
}

export default function HelpView() {
  const { isGlass } = useTheme();
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [content, setContent] = useState<DocContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);

  // Load doc list on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<DocEntry[]>("list_docs");
        if (cancelled) return;
        setDocs(list);
        if (list.length > 0) {
          setActiveSlug(list[0].slug);
        }
      } catch (e) {
        console.error("Failed to list docs:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load doc content when activeSlug changes
  const loadContent = useCallback(async (slug: string) => {
    setContentLoading(true);
    try {
      const doc = await invoke<DocContent>("get_doc_content", { slug });
      setContent(doc);
    } catch (e) {
      console.error("Failed to load doc:", e);
      setContent(null);
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSlug) {
      loadContent(activeSlug);
    }
  }, [activeSlug, loadContent]);

  return (
    <ViewLayout>
      <ViewLayout.Toolbar>
        <CircleHelp size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">Documentation</h2>
      </ViewLayout.Toolbar>

      <div className="flex flex-1 min-h-0 gap-2">
        {/* Left panel — doc list */}
        <SidePanel side="left" width="narrow" className="rounded-lg ring-1 ring-border/40 border-r-0">
          <SidePanel.Header>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Guides
            </span>
          </SidePanel.Header>
          <SidePanel.Content className="p-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2
                  size={16}
                  className="animate-spin text-muted-foreground"
                />
              </div>
            ) : docs.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                No documentation found.
              </div>
            ) : (
              docs.map((doc) => (
                <button
                  key={doc.slug}
                  type="button"
                  onClick={() => setActiveSlug(doc.slug)}
                  className={`w-full text-left px-3 py-2 rounded-md flex items-start gap-2 transition-colors ${
                    activeSlug === doc.slug
                      ? "bg-accent text-foreground"
                      : "text-dim-foreground hover:bg-accent/50"
                  }`}
                >
                  <DocIcon
                    name={doc.icon}
                    size={14}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">
                      {doc.title}
                    </div>
                    {doc.description && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {doc.description}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </SidePanel.Content>
        </SidePanel>

        {/* Right panel — markdown reader */}
        <div className={`flex-1 min-w-0 flex flex-col rounded-lg overflow-hidden ring-1 ring-border/40 ${glassStyles[isGlass ? "normal" : "solid"]}`}>
          {contentLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2
                size={20}
                className="animate-spin text-muted-foreground"
              />
            </div>
          ) : content ? (
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="markdown-preview max-w-3xl">
                <Streamdown
                  mode="static"
                  plugins={streamdownPlugins}
                  shikiTheme={streamdownTheme}
                  controls={streamdownControls}
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        onClick={(e) => {
                          if (href?.startsWith("http")) {
                            e.preventDefault();
                            open(href);
                          }
                        }}
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {content.body}
                </Streamdown>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {docs.length > 0
                ? "Select a document to view"
                : "No documentation available"}
            </div>
          )}
        </div>
      </div>
    </ViewLayout>
  );
}
