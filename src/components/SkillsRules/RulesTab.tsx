import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  FileText,
  Loader2,
  Plus,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useTheme } from "../../contexts/ThemeContext";
import { useAppStore } from "../../store/appStore";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";

interface InstructionFileInfo {
  agent_name: string;
  filename: string;
  path: string | null;
  exists: boolean;
}

interface Props {
  projectId: string;
}

export default function RulesTab({ projectId }: Props) {
  const { isGlass } = useTheme();
  const [files, setFiles] = useState<InstructionFileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty = content !== originalContent;

  // Load instruction files list
  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<InstructionFileInfo[]>(
        "list_instruction_files",
        { projectId }
      );
      setFiles(result);

      // Auto-select first existing file, or first file
      if (!selectedFile) {
        const existing = result.find((f) => f.exists);
        if (existing) {
          setSelectedFile(existing.filename);
        } else if (result.length > 0) {
          setSelectedFile(result[0].filename);
        }
      }
    } catch (e) {
      console.error("Failed to list instruction files:", e);
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedFile]);

  // Load file content when selection changes
  const loadContent = useCallback(async () => {
    if (!selectedFile) return;
    const file = files.find((f) => f.filename === selectedFile);
    if (!file?.exists || !file.path) {
      setContent("");
      setOriginalContent("");
      return;
    }

    try {
      const result = await invoke<string>("read_instruction_file_content", {
        projectId,
        filePath: file.path,
      });
      setContent(result);
      setOriginalContent(result);
    } catch (e) {
      console.error("Failed to read instruction file:", e);
      setContent("");
      setOriginalContent("");
    }
  }, [projectId, selectedFile, files]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const handleSave = useCallback(async () => {
    if (!selectedFile || !isDirty) return;
    const file = files.find((f) => f.filename === selectedFile);
    if (!file) return;

    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Saving instruction file");
    setSaving(true);
    try {
      await invoke("save_instruction_file", {
        projectId,
        filename: file.filename,
        content,
      });
      setOriginalContent(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Reload to pick up any path changes (file may have been created)
      await loadFiles();
    } catch (e) {
      console.error("Failed to save instruction file:", e);
      useAppStore.getState().flashError(`Failed to save: ${e}`);
    } finally {
      setSaving(false);
      removeBackgroundTask("Saving instruction file");
    }
  }, [selectedFile, isDirty, files, projectId, content, loadFiles]);

  const handleCreate = useCallback(async () => {
    if (!selectedFile) return;
    const file = files.find((f) => f.filename === selectedFile);
    if (!file || file.exists) return;

    const { addBackgroundTask, removeBackgroundTask } = useAppStore.getState();
    addBackgroundTask("Creating instruction file");
    try {
      await invoke("save_instruction_file", {
        projectId,
        filename: file.filename,
        content: `# ${file.agent_name} Instructions\n\n`,
      });
      await loadFiles();
      // Content will reload via the loadContent effect
    } catch (e) {
      console.error("Failed to create instruction file:", e);
      useAppStore.getState().flashError(`Failed to create: ${e}`);
    } finally {
      removeBackgroundTask("Creating instruction file");
    }
  }, [selectedFile, files, projectId, loadFiles]);

  // Keyboard shortcut for save
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

  const selectedFileInfo = files.find((f) => f.filename === selectedFile);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={`flex-1 min-h-0 overflow-hidden rounded-lg ring-1 ring-border/40 flex flex-col ${glassStyles[isGlass ? "normal" : "solid"]}`}
    >
      {/* File selector chips */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50 shrink-0">
        <span className="text-xs text-muted-foreground mr-1">Files:</span>
        {files.map((file) => (
          <button
            key={file.filename}
            onClick={() => {
              if (isDirty && !confirm("Discard unsaved changes?")) return;
              setSelectedFile(file.filename);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              selectedFile === file.filename
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : file.exists
                  ? "bg-accent/50 text-foreground hover:bg-accent"
                  : "bg-accent/20 text-muted-foreground hover:bg-accent/40"
            }`}
          >
            <FileText size={12} />
            {file.filename}
            {file.exists ? (
              <span className="size-1.5 rounded-full bg-success" />
            ) : (
              <span className="size-1.5 rounded-full bg-muted-foreground/40" />
            )}
          </button>
        ))}
      </div>

      {/* Editor or create prompt */}
      {selectedFileInfo && !selectedFileInfo.exists ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <FileText className="size-8 opacity-30" />
          <p className="text-sm">
            <span className="font-medium text-foreground">
              {selectedFileInfo.filename}
            </span>{" "}
            doesn't exist yet
          </p>
          <p className="text-xs opacity-70">
            Create it to add instructions for {selectedFileInfo.agent_name}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreate}
            leftIcon={<Plus size={13} />}
            hoverEffect="scale"
            clickEffect="scale"
          >
            Create {selectedFileInfo.filename}
          </Button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Save toolbar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 shrink-0">
            <span className="text-xs text-muted-foreground flex-1">
              {selectedFileInfo?.path ?? ""}
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

          {/* Textarea editor */}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 min-h-0 w-full resize-none bg-transparent px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            placeholder="Enter instructions for the agent..."
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}
