import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  Brain,
  FileText,
  FolderOpen,
  Hash,
  ImageIcon,
  Layers,
  List,
  ListChecks,
  Loader2,
  Paperclip,
  Rows3,
  SendIcon,
  Sparkles,
  SquareIcon,
  Terminal,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { usePersistedBoolean, usePersistedString } from "../../hooks/usePersistedState";
import { useAppStore } from "../../store/appStore";
import { cn } from "@/lib/utils";
import ConfigOptionsPopover from "./ConfigOptionsPopover";
import ContextUsageIndicator from "./ContextUsageIndicator";
import ModeSelector from "./ModeSelector";
import ModelSelector from "./ModelSelector";
import ThoughtLevelSelector from "./ThoughtLevelSelector";

import type { ChatDisplayMode } from "./ChatPane";
import type { AcpAvailableCommand, AcpMessageAttachment, AgentCapabilities, FileEntry } from "../../types";

// ── Slash Commands ──

interface SlashCommand {
  name: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  /** Text to insert when selected (replaces the /trigger). */
  insertText?: string;
  /** Whether this command came from the agent (via ACP AvailableCommandsUpdate). */
  isAgentCommand?: boolean;
  /** Input hint from the agent (e.g., "Enter a search query"). */
  inputHint?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "plan",
    label: "/plan",
    description: "Ask the agent to create a plan",
    icon: <ListChecks size={14} className="text-primary" />,
    insertText: "Create a plan for: ",
  },
  {
    name: "status",
    label: "/status",
    description: "Ask for current progress status",
    icon: <Hash size={14} className="text-success" />,
    insertText: "What is the current status and progress?",
  },
  {
    name: "files",
    label: "/files",
    description: "Ask about files in the project",
    icon: <FolderOpen size={14} className="text-warning" />,
    insertText: "What files have been changed or are relevant to this task?",
  },
];

/** Convert ACP available commands to the SlashCommand format used by the overlay. */
function agentCommandToSlash(cmd: AcpAvailableCommand): SlashCommand {
  return {
    name: cmd.name,
    label: `/${cmd.name}`,
    description: cmd.description,
    icon: <Terminal size={14} className="text-primary/70" />,
    insertText: cmd.input_hint ? `/${cmd.name} ` : `/${cmd.name}`,
    isAgentCommand: true,
    inputHint: cmd.input_hint,
  };
}

// ── Component ──

interface ChatInputProps {
  sessionId: string;
  disabled?: boolean;
  /** Optional placeholder override (e.g. for "Connecting..." during startup) */
  placeholder?: string;
  /** Pre-fill the input (e.g. for message re-send). */
  initialText?: string;
  /** Called when initialText has been consumed. */
  onInitialTextConsumed?: () => void;
}

export default React.memo(function ChatInput({
  sessionId,
  disabled,
  placeholder: placeholderOverride,
  initialText,
  onInitialTextConsumed,
}: ChatInputProps) {
  const addAcpUserMessage = useAppStore((s) => s.addAcpUserMessage);
  const setAcpPromptPending = useAppStore((s) => s.setAcpPromptPending);
  const setAcpDraftText = useAppStore((s) => s.setAcpDraftText);
  const setMcpStatus = useAppStore((s) => s.setMcpStatus);
  const draftText = useAppStore((s) => s.acpDraftText[sessionId] ?? "");
  const promptPending = useAppStore(
    (s) => s.acpPromptPending[sessionId] ?? false,
  );
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projects = useAppStore((s) => s.projects);
  const projectPath = useMemo(
    () => projects.find((p) => p.id === activeProjectId)?.path ?? null,
    [projects, activeProjectId],
  );

  // ── Display options (persisted) ──
  const [displayMode, setDisplayMode] = usePersistedString("chat_display_mode", "grouped") as [ChatDisplayMode, (v: ChatDisplayMode) => void, boolean];
  const [showThinkingBlocks, setShowThinkingBlocks] = usePersistedBoolean("show_thinking_blocks", true);

  // ── Agent-provided slash commands ──
  const agentCommands = useAppStore(
    (s) => s.acpAvailableCommands[sessionId],
  );
  const allSlashCommands = useMemo(() => {
    const agentSlash = (agentCommands ?? []).map(agentCommandToSlash);
    // Merge: built-in first, then agent commands (skip duplicates by name)
    const builtInNames = new Set(SLASH_COMMANDS.map((c) => c.name));
    const deduped = agentSlash.filter((c) => !builtInNames.has(c.name));
    return [...SLASH_COMMANDS, ...deduped];
  }, [agentCommands]);

  // ── Agent capabilities ──
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);

  useEffect(() => {
    if (disabled) return; // Don't fetch if session is not running
    let cancelled = false;
    invoke<AgentCapabilities>("get_acp_capabilities", { sessionId })
      .then((caps) => {
        if (!cancelled) setCapabilities(caps);
      })
      .catch(() => {
        // Not an ACP session or capabilities not available yet — graceful fallback
      });
    return () => { cancelled = true; };
  }, [sessionId, disabled]);

  // ── Stop & Send confirmation state ──
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  /** True while we're waiting for the agent to stop (after Stop or Stop & Send). */
  const [isStopping, setIsStopping] = useState(false);
  const pendingMessageRef = useRef<PromptInputMessage | null>(null);

  // Clear confirmation / stopping state when promptPending becomes false (agent finished/cancelled)
  useEffect(() => {
    if (!promptPending) {
      if (showStopConfirm) setShowStopConfirm(false);
      if (isStopping) setIsStopping(false);
    }
  }, [promptPending, showStopConfirm, isStopping]);

  // ── Suggestion overlay state ──
  const [suggestionType, setSuggestionType] = useState<"slash" | "file" | null>(
    null,
  );
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [fileSuggestions, setFileSuggestions] = useState<FileEntry[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suppressNextChange = useRef(false);
  const [isFocused, setIsFocused] = useState(false);

  // ── Initial text pre-fill ──
  useEffect(() => {
    if (initialText && textareaRef.current) {
      // Set value via native setter to trigger React's onChange
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textareaRef.current, initialText);
        textareaRef.current.dispatchEvent(
          new Event("input", { bubbles: true }),
        );
      }
      textareaRef.current.focus();
      onInitialTextConsumed?.();
    }
  }, [initialText, onInitialTextConsumed]);

  // ── Restore draft text on mount ──
  useEffect(() => {
    if (draftText && textareaRef.current && !initialText) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (setter) {
        setter.call(textareaRef.current, draftText);
        textareaRef.current.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    // Only restore on mount — not on every draftText change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Fetch file suggestions ──
  useEffect(() => {
    if (suggestionType !== "file" || !projectPath) return;

    let cancelled = false;
    const fetchFiles = async () => {
      try {
        const entries = await invoke<FileEntry[]>("list_directory", {
          path: projectPath,
          projectRoot: projectPath,
        });
        if (!cancelled) {
          setFileSuggestions(entries);
        }
      } catch (e) {
        console.error("Failed to list files:", e);
      }
    };
    fetchFiles();
    return () => {
      cancelled = true;
    };
  }, [suggestionType, projectPath]);

  // ── Filtered suggestions ──
  const filteredSlashCommands = useMemo(() => {
    if (suggestionType !== "slash") return [];
    const q = suggestionQuery.toLowerCase();
    return allSlashCommands.filter((cmd) => cmd.name.includes(q));
  }, [suggestionType, suggestionQuery, allSlashCommands]);

  const filteredFiles = useMemo(() => {
    if (suggestionType !== "file") return [];
    const q = suggestionQuery.toLowerCase();
    return fileSuggestions
      .filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
      .slice(0, 12);
  }, [suggestionType, suggestionQuery, fileSuggestions]);

  const suggestions =
    suggestionType === "slash"
      ? filteredSlashCommands
      : suggestionType === "file"
        ? filteredFiles
        : [];

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIdx(0);
  }, [suggestions.length]);

  // ── Handlers ──

  const closeSuggestions = useCallback(() => {
    setSuggestionType(null);
    setSuggestionQuery("");
    setSelectedIdx(0);
  }, []);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (suppressNextChange.current) {
        suppressNextChange.current = false;
        return;
      }

      const value = e.target.value;
      setAcpDraftText(sessionId, value);
      const cursorPos = e.target.selectionStart ?? value.length;

      // Check for `/` trigger at start of input
      if (value.startsWith("/")) {
        const query = value.slice(1, cursorPos);
        if (!query.includes(" ")) {
          setSuggestionType("slash");
          setSuggestionQuery(query);
          return;
        }
      }

      // Check for `@` trigger — find the last `@` before cursor
      const beforeCursor = value.slice(0, cursorPos);
      const lastAt = beforeCursor.lastIndexOf("@");
      if (lastAt >= 0) {
        const afterAt = beforeCursor.slice(lastAt + 1);
        // Only trigger if no spaces after @ (still typing the path)
        if (!afterAt.includes(" ") && afterAt.length < 50) {
          setSuggestionType("file");
          setSuggestionQuery(afterAt);
          return;
        }
      }

      // No trigger — close suggestions
      if (suggestionType) {
        closeSuggestions();
      }
    },
    [suggestionType, closeSuggestions, sessionId, setAcpDraftText],
  );

  const applySuggestion = useCallback(
    (index: number) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (suggestionType === "slash") {
        const cmd = filteredSlashCommands[index];
        if (!cmd) return;
        const newValue = cmd.insertText ?? `/${cmd.name} `;
        // Use native setter to update value
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        if (setter) {
          suppressNextChange.current = true;
          setter.call(textarea, newValue);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          textarea.setSelectionRange(newValue.length, newValue.length);
        }
      } else if (suggestionType === "file") {
        const file = filteredFiles[index];
        if (!file) return;
        const value = textarea.value;
        const cursorPos = textarea.selectionStart ?? value.length;
        const beforeCursor = value.slice(0, cursorPos);
        const lastAt = beforeCursor.lastIndexOf("@");
        if (lastAt >= 0) {
          const newValue =
            value.slice(0, lastAt) + `@${file.path} ` + value.slice(cursorPos);
          const newCursor = lastAt + file.path.length + 2;
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value",
          )?.set;
          if (setter) {
            suppressNextChange.current = true;
            setter.call(textarea, newValue);
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            textarea.setSelectionRange(newCursor, newCursor);
          }
        }
      }

      closeSuggestions();
      textarea.focus();
    },
    [
      suggestionType,
      filteredSlashCommands,
      filteredFiles,
      closeSuggestions,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!suggestionType || suggestions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Tab" || e.key === "Enter") {
        if (suggestionType) {
          e.preventDefault();
          e.stopPropagation();
          applySuggestion(selectedIdx);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeSuggestions();
      }
    },
    [suggestionType, suggestions.length, selectedIdx, applySuggestion, closeSuggestions],
  );

  /** Actually send a message (no guards — called after confirmation or when agent is idle). */
  const doSend = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      const hasFiles = message.files && message.files.length > 0;

      closeSuggestions();
      setAcpDraftText(sessionId, "");

      // Build lightweight attachment records for display in the chat message
      const messageAttachments: AcpMessageAttachment[] | undefined = hasFiles
        ? message.files.map((file) => ({
            filename: file.filename || "attachment",
            mediaType: file.mediaType || "application/octet-stream",
            // Keep data URL for images (for thumbnail display), omit for other files to save memory
            url: file.mediaType?.startsWith("image/") ? file.url : "",
          }))
        : undefined;

      addAcpUserMessage(sessionId, text || (hasFiles ? `[${message.files.length} attachment(s)]` : ""), messageAttachments);
      setAcpPromptPending(sessionId, true);

      // Clear waiting state immediately when user submits a response
      setMcpStatus(sessionId, {
        waiting: false,
        waiting_question: undefined,
      });

      try {
        // Convert FileUIPart[] to AttachmentPayload[] for the backend
        let attachments: { data: string; mime_type: string; filename: string; kind: string }[] | undefined;

        if (hasFiles) {
          attachments = message.files.map((file) => {
            // file.url is a data URL (blob URLs are converted by prompt-input on submit)
            const isImage = file.mediaType?.startsWith("image/");
            return {
              data: file.url, // data URL — backend will strip the prefix
              mime_type: file.mediaType || "application/octet-stream",
              filename: file.filename || "attachment",
              kind: isImage ? "image" : "file",
            };
          });
        }

        await invoke("send_acp_message", { sessionId, text, attachments });
      } catch (e) {
        console.error("Failed to send ACP message:", e);
        setAcpPromptPending(sessionId, false);
      }
    },
    [sessionId, addAcpUserMessage, setAcpPromptPending, setMcpStatus, setAcpDraftText, closeSuggestions],
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      const hasFiles = message.files && message.files.length > 0;
      if ((!text && !hasFiles) || disabled) return;

      // Block while we're waiting for a stop/stop-and-send to complete
      if (isStopping) return;

      // If agent is currently working, show confirmation instead of sending
      if (promptPending) {
        pendingMessageRef.current = message;
        setShowStopConfirm(true);
        return;
      }

      doSend(message);
    },
    [disabled, promptPending, isStopping, doSend],
  );

  /** User confirmed "Stop & Send" — cancel the agent, queue the message, then send. */
  const handleStopAndSend = useCallback(async () => {
    const message = pendingMessageRef.current;
    if (!message) return;

    setShowStopConfirm(false);
    pendingMessageRef.current = null;
    setIsStopping(true);

    // Cancel the current agent work
    try {
      await invoke("cancel_acp_session", { sessionId });
    } catch (e) {
      console.error("Failed to cancel ACP session:", e);
    }

    // Wait for promptPending to clear (cancel triggers acp-prompt-complete/error event).
    // Timeout after 5s to avoid polling forever if the cancel event is lost.
    const waitForIdle = () =>
      new Promise<void>((resolve) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          const pending = useAppStore.getState().acpPromptPending[sessionId] ?? false;
          if (!pending || Date.now() >= deadline) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        // Start checking after a small delay to let the cancel propagate
        setTimeout(check, 100);
      });

    await waitForIdle();
    setIsStopping(false);
    doSend(message);
  }, [sessionId, doSend]);

  /** User dismissed the confirmation bar. */
  const handleDismissStopConfirm = useCallback(() => {
    setShowStopConfirm(false);
    pendingMessageRef.current = null;
    textareaRef.current?.focus();
  }, []);

  const handleStop = useCallback(async () => {
    setShowStopConfirm(false);
    pendingMessageRef.current = null;
    setIsStopping(true);
    try {
      await invoke("cancel_acp_session", { sessionId });
    } catch (e) {
      console.error("Failed to cancel ACP session:", e);
    }
    // isStopping clears when promptPending becomes false
  }, [sessionId]);

  const chatStatus = disabled
    ? promptPending
      ? "streaming"
      : "ready"
    : promptPending
      ? "streaming"
      : "ready";

  return (
    <div className="border-t border-border/40 px-3 py-2 relative">
      {/* Stop & Send confirmation bar */}
      {showStopConfirm && (
        <div className="absolute bottom-full left-3 right-3 mb-1 flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 shadow-lg z-50">
          <span className="text-xs text-muted-foreground flex-1">
            Agent is working. Stop and send your message?
          </span>
          <button
            type="button"
            onClick={handleStopAndSend}
            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <SendIcon size={12} />
            Stop &amp; Send
          </button>
          <button
            type="button"
            onClick={handleDismissStopConfirm}
            className="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Suggestion overlay */}
      {suggestionType && suggestions.length > 0 && !showStopConfirm && (
        <SuggestionOverlay
          type={suggestionType}
          suggestions={suggestions}
          selectedIdx={selectedIdx}
          onSelect={applySuggestion}
        />
      )}

      <PromptInput onSubmit={handleSubmit} className="rounded-lg">
        {/* Attachment previews (above textarea) */}
        <AttachmentPreviewBar disabled={disabled} />

        <PromptInputTextarea
          ref={textareaRef}
          placeholder={
            placeholderOverride
              ? placeholderOverride
              : disabled
                ? "Session ended"
                : (isStopping || promptPending)
                  ? " "
                  : "Send a message… (/ for commands, @ for files)"
          }
          disabled={(disabled && !promptPending) || isStopping}
          className="min-h-[36px] text-sm"
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {/* Shimmer working indicator — positioned after the textarea, same visual position as placeholder */}
        {promptPending && !placeholderOverride && !isFocused && !draftText && (
          <div className="flex items-center justify-start gap-2 px-3 py-2 -mt-9 pointer-events-none w-full">
            <Loader2 className="size-3.5 animate-spin text-primary shrink-0" />
            <Shimmer duration={2} className="text-sm">
              {isStopping ? "Stopping agent…" : "Agent is working..."}
            </Shimmer>
          </div>
        )}
        <PromptInputFooter className="justify-between cursor-default">
          {/* Attachment actions (left side) */}
          <div className="flex items-center gap-1">
            {(capabilities?.image || capabilities?.embedded_context) && !disabled && (
              <AttachmentActions capabilities={capabilities} />
            )}
            {/* Passive capability indicators when no capabilities */}
            {!capabilities?.image && !capabilities?.embedded_context && (
              <div className="flex items-center gap-1">
                {/* No attachment capabilities — show nothing */}
              </div>
            )}
          </div>

          {/* Mode + Model selectors + Display options + Context usage + Submit / Stop (right side) */}
          <div className="flex items-center gap-1.5">
            <ConfigOptionsPopover sessionId={sessionId} disabled={disabled} />
            <ModeSelector sessionId={sessionId} disabled={disabled} />
            <ModelSelector sessionId={sessionId} disabled={disabled} />
            <ThoughtLevelSelector sessionId={sessionId} disabled={disabled} />
            <ContextUsageIndicator sessionId={sessionId} />

            {/* Divider */}
            <div className="w-px h-4 bg-border/40" />

            {/* Display mode selector */}
            <div className="inline-flex items-center rounded-md ring-1 ring-border/40 overflow-hidden">
              <button
                type="button"
                onClick={() => setDisplayMode("linear")}
                className={cn(
                  "flex items-center justify-center size-7 transition-colors",
                  displayMode === "linear"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
                title="Linear — each entry rendered individually"
              >
                <List size={13} />
              </button>
              <div className="w-px h-4 bg-border/40" />
              <button
                type="button"
                onClick={() => setDisplayMode("grouped")}
                className={cn(
                  "flex items-center justify-center size-7 transition-colors",
                  displayMode === "grouped"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
                title="Grouped — tool calls grouped between text segments"
              >
                <Rows3 size={13} />
              </button>
              <div className="w-px h-4 bg-border/40" />
              <button
                type="button"
                onClick={() => setDisplayMode("single-response")}
                className={cn(
                  "flex items-center justify-center size-7 transition-colors",
                  displayMode === "single-response"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
                title="Single response — one block per agent cycle"
              >
                <Layers size={13} />
              </button>
            </div>

            {/* Thinking toggle */}
            <button
              type="button"
              onClick={() => setShowThinkingBlocks(!showThinkingBlocks)}
              className={cn(
                "flex items-center justify-center size-7 rounded transition-colors",
                showThinkingBlocks
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50",
              )}
              title={showThinkingBlocks ? "Hide thinking blocks" : "Show thinking blocks"}
            >
              <Brain size={13} />
            </button>

            {promptPending ? (
              <PromptInputSubmit
                status="streaming"
                onStop={handleStop}
                variant="destructive"
                size="icon-sm"
                disabled={isStopping}
                className={isStopping ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              >
                <SquareIcon className="size-3.5" />
              </PromptInputSubmit>
            ) : (
              <PromptInputSubmit
                disabled={disabled}
                status={chatStatus as "ready"}
                className="cursor-pointer"
              />
            )}
          </div>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
});

// ── Attachment Preview Bar ──

/** Shows attached files as inline pills above the textarea. */
function AttachmentPreviewBar({ disabled }: { disabled?: boolean }) {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) return null;

  return (
    <PromptInputHeader className="px-1 pt-1 pb-0">
      <Attachments variant="inline" className="gap-1.5 flex-wrap">
        {attachments.files.map((file) => (
          <Attachment
            key={file.id}
            data={file}
            onRemove={disabled ? undefined : () => attachments.remove(file.id)}
          >
            <AttachmentPreview />
            <AttachmentInfo />
            {!disabled && <AttachmentRemove />}
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

// ── Attachment Actions (+ menu) ──

/** Dropdown menu for adding files/images using Tauri's native file dialog. */
function AttachmentActions({ capabilities }: { capabilities: AgentCapabilities | null }) {
  const attachments = usePromptInputAttachments();

  const handleAddFiles = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        multiple: true,
        title: "Add files",
      });
      if (!selected) return;

      const paths: string[] = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        const filename = path.split(/[\\/]/).pop() || "file";
        const ext = filename.split(".").pop()?.toLowerCase() || "";
        const mime = extToMime(ext);

        try {
          const bytes = await readFile(path);
          const blob = new Blob([bytes], { type: mime });
          const file = new File([blob], filename, { type: mime });
          attachments.add([file]);
        } catch (e) {
          console.error(`Failed to read file ${path}:`, e);
        }
      }
    } catch (e) {
      console.error("File dialog failed:", e);
    }
  }, [attachments]);

  const handleAddImages = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        multiple: true,
        title: "Add images",
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
      });
      if (!selected) return;

      const paths: string[] = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        const filename = path.split(/[\\/]/).pop() || "image";
        const ext = filename.split(".").pop()?.toLowerCase() || "png";
        const mime = extToMime(ext);

        try {
          const bytes = await readFile(path);
          const blob = new Blob([bytes], { type: mime });
          const file = new File([blob], filename, { type: mime });
          attachments.add([file]);
        } catch (e) {
          console.error(`Failed to read image ${path}:`, e);
        }
      }
    } catch (e) {
      console.error("Image dialog failed:", e);
    }
  }, [attachments]);

  const showImageOption = capabilities?.image;
  const showFileOption = capabilities?.embedded_context;

  // If only one capability, show a single button instead of a menu
  if (showImageOption && !showFileOption) {
    return (
      <button
        type="button"
        onClick={handleAddImages}
        className="flex items-center justify-center size-6 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
        title="Add images"
      >
        <ImageIcon size={14} />
      </button>
    );
  }

  if (showFileOption && !showImageOption) {
    return (
      <button
        type="button"
        onClick={handleAddFiles}
        className="flex items-center justify-center size-6 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
        title="Add files"
      >
        <Paperclip size={14} />
      </button>
    );
  }

  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger
        className="size-6 text-muted-foreground/70 hover:text-foreground cursor-pointer"
        tooltip="Attach files"
      >
        <Paperclip size={14} />
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent className="min-w-[160px]">
        {showFileOption && (
          <PromptInputActionMenuItem onClick={handleAddFiles}>
            <FileText className="mr-2 size-4" /> Add files
          </PromptInputActionMenuItem>
        )}
        {showImageOption && (
          <PromptInputActionMenuItem onClick={handleAddImages}>
            <ImageIcon className="mr-2 size-4" /> Add images
          </PromptInputActionMenuItem>
        )}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

/** Map common file extensions to MIME types. */
function extToMime(ext: string): string {
  const map: Record<string, string> = {
    // Images
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
    // Text/Code
    txt: "text/plain", md: "text/markdown", html: "text/html", css: "text/css",
    js: "application/javascript", ts: "application/typescript", jsx: "application/javascript",
    tsx: "application/typescript", json: "application/json", xml: "application/xml",
    yaml: "application/x-yaml", yml: "application/x-yaml", toml: "application/toml",
    rs: "text/x-rust", py: "text/x-python", go: "text/x-go", java: "text/x-java",
    c: "text/x-c", cpp: "text/x-c++", h: "text/x-c", hpp: "text/x-c++",
    sh: "text/x-shellscript", bash: "text/x-shellscript", zsh: "text/x-shellscript",
    sql: "text/x-sql", csv: "text/csv", log: "text/plain",
    // Binary
    pdf: "application/pdf", zip: "application/zip", tar: "application/x-tar",
    gz: "application/gzip",
  };
  return map[ext] || "application/octet-stream";
}

// ── Suggestion Overlay ──

interface SuggestionOverlayProps {
  type: "slash" | "file";
  suggestions: (SlashCommand | FileEntry)[];
  selectedIdx: number;
  onSelect: (index: number) => void;
}

function SuggestionOverlay({
  type,
  suggestions,
  selectedIdx,
  onSelect,
}: SuggestionOverlayProps) {
  return (
    <div className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-border bg-popover shadow-lg overflow-hidden z-50 max-h-[240px] overflow-y-auto">
      <div className="py-1">
        {type === "slash"
          ? (suggestions as SlashCommand[]).map((cmd, i) => (
              <button
                key={cmd.name}
                className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors ${
                  i === selectedIdx
                    ? "bg-accent text-foreground"
                    : "text-dim-foreground hover:bg-accent/50"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(i);
                }}
                onMouseEnter={() => {
                  // Handled by keyboard, but hover feedback via CSS
                }}
              >
                {cmd.icon}
                <span className="text-xs font-medium">{cmd.label}</span>
                <span className="text-xs text-muted-foreground flex-1 truncate">
                  {cmd.description}
                </span>
                {cmd.isAgentCommand && (
                  <span className="flex items-center gap-0.5 text-2xs text-primary/60 shrink-0">
                    <Sparkles size={10} />
                    agent
                  </span>
                )}
              </button>
            ))
          : (suggestions as FileEntry[]).map((file, i) => (
              <button
                key={file.path}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors ${
                  i === selectedIdx
                    ? "bg-accent text-foreground"
                    : "text-dim-foreground hover:bg-accent/50"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(i);
                }}
              >
                {file.is_dir ? (
                  <FolderOpen size={13} className="text-warning shrink-0" />
                ) : (
                  <FileText size={13} className="text-muted-foreground shrink-0" />
                )}
                <span className="text-xs truncate">{file.path}</span>
                {file.is_dir && (
                  <span className="text-2xs text-muted-foreground/50 shrink-0">
                    dir
                  </span>
                )}
              </button>
            ))}
      </div>
    </div>
  );
}
