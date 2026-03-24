import { Bot, Loader2, MessageCircle } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";

import { Shimmer } from "@/components/ai-elements/shimmer";

import { usePersistedBoolean, usePersistedString } from "../../hooks/usePersistedState";
import { useAppStore } from "../../store/appStore";
import ChatInput from "./ChatInput";
import ChatPlanQueue from "./ChatPlanQueue";
import ChatMessage from "./ChatMessage";
import GitContextBar from "./GitContextBar";
import PermissionDialog from "./PermissionDialog";
import WaitingCard from "./WaitingCard";
import AgentTurnBlock from "./AgentTurnBlock";

import type { AcpEntry, AcpUserMessage, AcpAgentText, AcpToolCallEntry, AcpThinkingEntry } from "../../types";

// ── Display modes ──

/** Chat display mode — pure view-layer transform over the same flat entry data. */
export type ChatDisplayMode = "linear" | "grouped" | "single-response";

// ── Constants ──

const EMPTY_ENTRIES: AcpEntry[] = [];

// ── Timeline types ──

type AgentEntry = AcpAgentText | AcpToolCallEntry | AcpThinkingEntry;

/** A grouped agent turn: consecutive non-user entries between user messages. */
interface AgentTurnGroup {
  entries: AgentEntry[];
  /** Whether this is the last agent turn in the timeline (for streaming indicator). */
  isLastTurn: boolean;
}

type TimelineItem =
  | { type: "user-message"; data: AcpUserMessage }
  | { type: "agent-turn"; turn: AgentTurnGroup };

// ── Component ──

interface ChatPaneProps {
  sessionId: string;
  sessionStatus: string;
}

export default React.memo(function ChatPane({
  sessionId,
  sessionStatus,
}: ChatPaneProps) {
  const [showThinkingBlocks] = usePersistedBoolean("show_thinking_blocks", true);
  const [displayMode] = usePersistedString("chat_display_mode", "grouped") as [ChatDisplayMode, (v: ChatDisplayMode) => void, boolean];
  const entries = useAppStore(
    (s) => s.acpEntries[sessionId] ?? EMPTY_ENTRIES,
  );
  const promptPending = useAppStore(
    (s) => s.acpPromptPending[sessionId] ?? false,
  );
  const isStarting = sessionStatus === "starting";
  const isRunning = sessionStatus === "running";
  const inputDisabled = !isRunning;

  // Edit & resend state
  const [editResendText, setEditResendText] = useState<string | undefined>();
  const handleEditResend = useCallback((text: string) => {
    setEditResendText(text);
  }, []);
  const handleEditResendConsumed = useCallback(() => {
    setEditResendText(undefined);
  }, []);

  // ── Build timeline from flat entries ──
  const timeline = useMemo<TimelineItem[]>(() => {
    switch (displayMode) {
      case "linear":
        return buildTimelineLinear(entries, showThinkingBlocks);
      case "single-response":
        return buildTimelineSingleResponse(entries, showThinkingBlocks);
      case "grouped":
      default:
        return buildTimelineGrouped(entries, showThinkingBlocks);
    }
  }, [entries, showThinkingBlocks, displayMode]);

  const isEmpty = timeline.length === 0;

  // Check if the agent is actively working (for working indicator)
  const isAgentWorking = promptPending && (
    isEmpty ||
    (entries.length > 0 && entries[entries.length - 1].type === "user-message")
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <PermissionDialog sessionId={sessionId} />

      <div className="flex-1 min-h-0 relative flex flex-col">
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="gap-3 px-3 py-3">
          {isEmpty && isStarting ? (
            <ConversationEmptyState
              title="Starting..."
              description="Connecting to the agent"
              icon={<Loader2 className="size-8 animate-spin text-primary" strokeWidth={1.5} />}
            />
          ) : isEmpty && !promptPending ? (
            <ConversationEmptyState
              title={isRunning ? "Ready to chat" : "No messages yet"}
              description={
                isRunning
                  ? "Ask anything about your project"
                  : "Start a new session to begin"
              }
              icon={isRunning
                ? <MessageCircle className="size-8 text-primary" strokeWidth={1.5} />
                : <Bot className="size-8" strokeWidth={1.5} />
              }
            />
          ) : (
            <>
              {timeline.map((item, idx) => {
                if (item.type === "user-message") {
                  return (
                    <ChatMessage
                      key={item.data.id}
                      message={{
                        id: item.data.id,
                        role: "user",
                        text: item.data.text,
                        timestamp: item.data.timestamp,
                        attachments: item.data.attachments,
                      }}
                      onEditResend={handleEditResend}
                    />
                  );
                }
                if (item.type === "agent-turn") {
                  return (
                    <AgentTurnBlock
                      key={`turn-${idx}`}
                      entries={item.turn.entries}
                      isStreaming={item.turn.isLastTurn && promptPending}
                      sessionId={sessionId}
                      showThinking={showThinkingBlocks}
                    />
                  );
                }
                return null;
              })}

              {/* Working indicator — shown when agent is active but hasn't produced anything yet */}
              {isAgentWorking && <WorkingIndicator />}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <ChatPlanQueue sessionId={sessionId} />
      </div>

      <WaitingCard sessionId={sessionId} />

      <ChatInput
        sessionId={sessionId}
        disabled={inputDisabled}
        placeholder={isStarting ? "Connecting to agent..." : undefined}
        initialText={editResendText}
        onInitialTextConsumed={handleEditResendConsumed}
      />

      <GitContextBar sessionId={sessionId} />
    </div>
  );
});

// ── Timeline builders ──

/**
 * Grouped (default): splits agent entries into turns at agent-text boundaries.
 * Each agent-text is the "response" at the bottom of its turn, with preceding
 * tool calls and thinking steps above it. Good for following multi-step work.
 *
 * Example: [thinking, text-1, tool-1, tool-2, text-2, tool-3, text-3]
 *   → Turn 1: [thinking, text-1]
 *   → Turn 2: [tool-1, tool-2, text-2]
 *   → Turn 3: [tool-3, text-3]
 */
function buildTimelineGrouped(entries: AcpEntry[], showThinking: boolean): TimelineItem[] {
  const result: TimelineItem[] = [];
  let currentTurnEntries: AgentEntry[] = [];

  const flushTurn = (isLast: boolean) => {
    if (currentTurnEntries.length > 0) {
      result.push({
        type: "agent-turn",
        turn: { entries: currentTurnEntries, isLastTurn: isLast },
      });
      currentTurnEntries = [];
    }
  };

  for (const entry of entries) {
    if (entry.type === "user-message") {
      flushTurn(false);
      result.push({ type: "user-message", data: entry });
    } else if (entry.type === "thinking" && !showThinking) {
      continue;
    } else {
      currentTurnEntries.push(entry);
      // Flush after each agent-text — it's the "response" that closes a turn
      if (entry.type === "agent-text") {
        flushTurn(false);
      }
    }
  }

  // Flush remaining entries (e.g. in-progress tool calls with no text yet)
  flushTurn(true);

  // Fix isLastTurn: mark the actual last agent-turn
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].type === "agent-turn") {
      (result[i] as { type: "agent-turn"; turn: AgentTurnGroup }).turn.isLastTurn = true;
      break;
    }
  }

  return result;
}

/**
 * Linear: each entry is its own turn — most transparent view.
 * Every text segment, tool call, and thinking block is a separate item.
 * Good for debugging and understanding exact agent flow.
 */
function buildTimelineLinear(entries: AcpEntry[], showThinking: boolean): TimelineItem[] {
  const result: TimelineItem[] = [];
  const total = entries.length;

  for (let i = 0; i < total; i++) {
    const entry = entries[i];
    if (entry.type === "user-message") {
      result.push({ type: "user-message", data: entry });
    } else if (entry.type === "thinking" && !showThinking) {
      continue;
    } else {
      const isLast = i === total - 1 || entries.slice(i + 1).every(
        (e) => e.type === "user-message" || (e.type === "thinking" && !showThinking),
      );
      result.push({
        type: "agent-turn",
        turn: { entries: [entry], isLastTurn: isLast },
      });
    }
  }

  return result;
}

/**
 * Single response: one turn per user→agent cycle — most compact.
 * ALL agent entries between two user messages are grouped into a single turn.
 * All tool calls shown as chain-of-thought steps, with only the final text
 * rendered as the response.
 */
function buildTimelineSingleResponse(entries: AcpEntry[], showThinking: boolean): TimelineItem[] {
  const result: TimelineItem[] = [];
  let currentTurnEntries: AgentEntry[] = [];

  const flushTurn = (isLast: boolean) => {
    if (currentTurnEntries.length > 0) {
      result.push({
        type: "agent-turn",
        turn: { entries: currentTurnEntries, isLastTurn: isLast },
      });
      currentTurnEntries = [];
    }
  };

  for (const entry of entries) {
    if (entry.type === "user-message") {
      flushTurn(false);
      result.push({ type: "user-message", data: entry });
    } else if (entry.type === "thinking" && !showThinking) {
      continue;
    } else {
      currentTurnEntries.push(entry);
    }
  }

  flushTurn(true);
  return result;
}

// ── Sub-components ──

function WorkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-2 px-1">
      <Loader2 className="size-3.5 animate-spin text-primary" />
      <span className="text-xs text-muted-foreground">
        <Shimmer duration={2}>Working...</Shimmer>
      </span>
    </div>
  );
}
