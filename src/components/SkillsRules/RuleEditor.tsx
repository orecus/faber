import {
  AlertTriangle,
  Check,
  FileText,
  Globe,
  Loader2,
  Plus,
  Save,
  Tag,
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useAppStore } from "../../store/appStore";
import type { RuleFileInfo } from "../../types";
import { Button } from "../ui/orecus.io/components/enhanced-button";

interface Props {
  file: RuleFileInfo | null;
  projectId: string;
  onFileCreated: () => void;
}

function RuleEditor({ file, projectId, onFileCreated }: Props) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty = content !== originalContent;

  // Load file content when selection changes
  useEffect(() => {
    if (!file || !file.exists || !file.path) {
      setContent("");
      setOriginalContent("");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const result = await invoke<string>("read_rule_file_content", {
          projectId,
          filePath: file.path,
        });
        if (!cancelled) {
          setContent(result);
          setOriginalContent(result);
        }
      } catch (e) {
        console.error("Failed to read rule file:", e);
        if (!cancelled) {
          setContent("");
          setOriginalContent("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file?.path, file?.exists, projectId]);

  const handleSave = useCallback(async () => {
    if (!file?.path || !isDirty) return;

    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Saving rule file");
    setSaving(true);
    try {
      await invoke("save_rule_file", {
        projectId,
        filePath: file.path,
        content,
      });
      setOriginalContent(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save rule file:", e);
      useAppStore.getState().flashError(`Failed to save: ${e}`);
    } finally {
      setSaving(false);
      removeBackgroundTask("Saving rule file");
    }
  }, [file?.path, isDirty, projectId, content]);

  const handleCreate = useCallback(async () => {
    if (!file) return;

    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Creating rule file");
    try {
      // For primary/local/override files, use save_instruction_file which creates in project root
      await invoke("save_instruction_file", {
        projectId,
        filename: file.relativePath,
        content: `# ${file.displayName.replace(/\.\w+$/, "")} Instructions\n\n`,
      });
      onFileCreated();
    } catch (e) {
      console.error("Failed to create rule file:", e);
      useAppStore.getState().flashError(`Failed to create: ${e}`);
    } finally {
      removeBackgroundTask("Creating rule file");
    }
  }, [file, projectId, onFileCreated]);

  // Ctrl+S save shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty) handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDirty, handleSave]);

  // Empty state — no file selected
  if (!file) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <FileText className="size-8 opacity-20" />
        <p className="text-sm">Select a rule file to edit</p>
        <p className="text-xs opacity-60">
          Choose a file from the tree on the left
        </p>
      </div>
    );
  }

  // File doesn't exist — create prompt
  if (!file.exists) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <FileText className="size-8 opacity-20" />
        <p className="text-sm">
          <span className="font-medium text-foreground">
            {file.relativePath}
          </span>{" "}
          doesn't exist yet
        </p>
        <p className="text-xs opacity-60">
          Create it to add instructions for this agent
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCreate}
          leftIcon={<Plus size={13} />}
          hoverEffect="scale"
          clickEffect="scale"
        >
          Create {file.displayName}
        </Button>
      </div>
    );
  }

  // File exists — editor
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Deprecation banner */}
      {file.deprecated && file.deprecationHint && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border-b border-warning/20 text-warning text-xs shrink-0">
          <AlertTriangle size={12} className="shrink-0" />
          <span>
            <span className="font-medium">{file.displayName}</span> is
            deprecated. {file.deprecationHint}
          </span>
        </div>
      )}

      {/* Frontmatter info bar */}
      {file.frontmatter && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border/30 text-xs text-muted-foreground shrink-0">
          {file.frontmatter.description && (
            <span className="truncate" title={file.frontmatter.description}>
              {file.frontmatter.description}
            </span>
          )}
          {file.frontmatter.globs && file.frontmatter.globs.length > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              <Tag size={10} className="opacity-60" />
              {file.frontmatter.globs.join(", ")}
            </span>
          )}
          {file.frontmatter.alwaysApply && (
            <span className="flex items-center gap-1 shrink-0 text-success">
              <Check size={10} />
              Always apply
            </span>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 shrink-0">
        <span className="text-xs text-muted-foreground flex-1 truncate flex items-center gap-1.5">
          {file.scope === "global" && (
            <Globe size={10} className="shrink-0 opacity-60" />
          )}
          {file.path ?? file.relativePath}
        </span>
        <Button
          variant={isDirty ? "default" : "outline"}
          size="sm"
          onClick={handleSave}
          disabled={!isDirty || saving}
          leftIcon={
            saving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : saved ? (
              <Check className="size-3" />
            ) : (
              <Save className="size-3" />
            )
          }
          hoverEffect="scale"
          clickEffect="scale"
        >
          {saving ? "Saving..." : saved ? "Saved" : "Save"}
        </Button>
      </div>

      {/* Editor textarea */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="flex-1 min-h-0 w-full resize-none bg-transparent px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        placeholder="Enter instructions for the agent..."
        spellCheck={false}
      />
    </div>
  );
}

export default React.memo(RuleEditor);
