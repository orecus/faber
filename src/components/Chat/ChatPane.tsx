import { Bot, Loader2, MessageCircle } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";

import { Shimmer } from "@/components/ai-elements/shimmer";

import { useAppStore } from "../../store/appStore";
import ChatInput from "./ChatInput";
import ChatPlanQueue from "./ChatPlanQueue";
import ChatMessage from "./ChatMessage";
import PermissionDialog from "./PermissionDialog";
import WaitingCard from "./WaitingCard";
import { isHiddenToolCall, isWaitingToolCall } from "./ToolCallCard";
import AgentTurnBlock from "./AgentTurnBlock";

import type { AcpChatMessage, AcpThinkingBlock, AcpToolCallState } from "../../types";

// ── Debug mode — set to true to show component borders and diagnostic info ──
const DEBUG_CHAT_TIMELINE = false;

// ── Timeline types ──

/** An agent turn groups thinking, tool calls + the agent's response into one cohesive block. */
interface AgentTurn {
  toolCalls: AcpToolCallState[];
  thinkingBlocks: AcpThinkingBlock[];
  agentMessage: AcpChatMessage | null;
  /** Narration messages to render inline between tool steps (Option B only). */
  narrations?: AcpChatMessage[];
  isLastAgent: boolean;
}

/** Narration rendering mode. */
export type NarrationMode = "split-turns" | "inline";

/** A user→agent cycle: one user message followed by 0+ agent messages. */
interface MessageCycle {
  userMsg: AcpChatMessage | null;
  agentMsgs: { msg: AcpChatMessage; idx: number }[];
  startTime: number;
  endTime: number;
}

type TimelineItem =
  | { type: "user-message"; data: AcpChatMessage }
  | { type: "agent-turn"; turn: AgentTurn };

interface ChatPaneProps {
  sessionId: string;
  sessionStatus: string;
  narrationMode?: NarrationMode;
}

export default React.memo(function ChatPane({
  sessionId,
  sessionStatus,
  narrationMode = "split-turns",
}: ChatPaneProps) {
  const messages = useAppStore(
    (s) => s.acpMessages[sessionId] ?? EMPTY_MESSAGES,
  );
  const toolCalls = useAppStore(
    (s) => s.acpToolCalls[sessionId] ?? EMPTY_TOOL_CALLS,
  );
  const thinkingBlocks = useAppStore(
    (s) => s.acpThinkingBlocks[sessionId] ?? EMPTY_THINKING_BLOCKS,
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

  // ── Stable narration mode ──
  // The persisted setting may load a tick after mount, causing a prop change
  // from the default to the saved value. To avoid a layout flash, we use a ref
  // for the mode inside useMemo (no dep on the prop). A counter state triggers
  // rebuilds only when messages change or the user explicitly toggles the mode.
  const modeRef = useRef(narrationMode);
  const prevModeRef = useRef(narrationMode);
  const [modeVersion, setModeVersion] = useState(0);
  if (narrationMode !== prevModeRef.current) {
    prevModeRef.current = narrationMode;
    modeRef.current = narrationMode;
    // Only bump version (trigger rebuild) if we already have messages.
    // When empty, the next message arrival will rebuild anyway.
    if (messages.length > 0) {
      setModeVersion((v) => v + 1);
    }
  }

  // ── Build turn-based timeline ──
  const timeline = useMemo<TimelineItem[]>(() => {
    const mode = modeRef.current;
    const allMessages: AcpChatMessage[] = [...messages];

    // Convert report_waiting tool calls to agent messages
    const waitingToolCallIds = new Set<string>();
    for (const tc of toolCalls) {
      const waiting = isWaitingToolCall(tc);
      if (waiting) {
        waitingToolCallIds.add(tc.tool_call_id);
        allMessages.push({
          id: `waiting_${tc.tool_call_id}`,
          role: "agent",
          text: waiting.question,
          timestamp: tc.timestamp,
        });
      }
    }

    // Collect visible tool calls sorted by timestamp
    const visibleToolCalls = toolCalls
      .filter((tc) => !isHiddenToolCall(tc) && !waitingToolCallIds.has(tc.tool_call_id))
      .sort((a, b) => a.timestamp - b.timestamp);

    // Find last agent message for streaming indicator
    let lastAgentIdx = -1;
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].role === "agent") {
        lastAgentIdx = i;
        break;
      }
    }

    // Build user→agent cycles (shared between both modes)
    const cycles = buildMessageCycles(allMessages);

    if (mode === "split-turns") {
      return buildTimelineSplitTurns(cycles, visibleToolCalls, thinkingBlocks, lastAgentIdx);
    } else {
      return buildTimelineInline(cycles, visibleToolCalls, thinkingBlocks, lastAgentIdx);
    }
    // modeVersion triggers rebuilds when the user toggles the setting (not on initial load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, toolCalls, thinkingBlocks, modeVersion]);

  const isEmpty = timeline.length === 0;

  // Check if the agent is actively working (for working indicator)
  const isAgentWorking = promptPending && (
    isEmpty ||
    (messages.length > 0 && messages[messages.length - 1].role === "user" &&
      toolCalls.filter((tc) => !isHiddenToolCall(tc)).length === 0)
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <PermissionDialog sessionId={sessionId} />

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
              {/* Debug: raw state summary */}
              {DEBUG_CHAT_TIMELINE && (
                <div className="text-[9px] font-mono text-orange-400/70 bg-orange-950/30 rounded px-2 py-1 mb-1">
                  msgs={messages.length} ({messages.map((m, i) => `${i}:${m.role}@${m.timestamp}`).join(", ")})
                  | tcs={toolCalls.length} (ts: {toolCalls.slice(0, 6).map((tc) => `${tc.tool_call_id.slice(0, 8)}@${tc.timestamp}`).join(", ")}{toolCalls.length > 6 ? "..." : ""})
                  | timeline={timeline.length} | pending={String(promptPending)}
                </div>
              )}
              {timeline.map((item, idx) => {
                if (item.type === "user-message") {
                  if (DEBUG_CHAT_TIMELINE) {
                    return (
                      <div key={item.data.id} className="relative border border-blue-500/50 rounded">
                        <span className="absolute -top-2.5 left-2 text-[9px] bg-blue-500/80 text-white px-1 rounded z-10">
                          user-message (id:{item.data.id.slice(0, 15)})
                        </span>
                        <ChatMessage
                          message={item.data}
                          onEditResend={handleEditResend}
                        />
                      </div>
                    );
                  }
                  return (
                    <ChatMessage
                      key={item.data.id}
                      message={item.data}
                      onEditResend={handleEditResend}
                    />
                  );
                }
                if (item.type === "agent-turn") {
                  if (DEBUG_CHAT_TIMELINE) {
                    const tcMsgIdxs = item.turn.toolCalls.map((tc) => `${tc.tool_call_id.slice(0, 12)}:mi=${tc.messageIndex}`).join(", ");
                    return (
                      <div key={`turn-${idx}`} className="relative border border-green-500/50 rounded">
                        <span className="absolute -top-2.5 left-2 text-[9px] bg-green-500/80 text-white px-1 rounded z-10">
                          agent-turn #{idx} (tc={item.turn.toolCalls.length}, msg={item.turn.agentMessage ? "yes" : "none"})
                        </span>
                        {tcMsgIdxs && (
                          <div className="text-[8px] text-yellow-400/80 px-2 pt-3 pb-0 font-mono break-all">
                            TC messageIndexes: {tcMsgIdxs}
                          </div>
                        )}
                        <AgentTurnBlock
                          toolCalls={item.turn.toolCalls}
                          thinkingBlocks={item.turn.thinkingBlocks}
                          agentMessage={item.turn.agentMessage}
                          narrations={item.turn.narrations}
                          isStreaming={item.turn.isLastAgent && promptPending}
                          sessionId={sessionId}
                        />
                      </div>
                    );
                  }
                  return (
                    <AgentTurnBlock
                      key={`turn-${idx}`}
                      toolCalls={item.turn.toolCalls}
                      thinkingBlocks={item.turn.thinkingBlocks}
                      agentMessage={item.turn.agentMessage}
                      narrations={item.turn.narrations}
                      isStreaming={item.turn.isLastAgent && promptPending}
                      sessionId={sessionId}
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

      <WaitingCard sessionId={sessionId} />

      <ChatInput
        sessionId={sessionId}
        disabled={inputDisabled}
        placeholder={isStarting ? "Connecting to agent..." : undefined}
        initialText={editResendText}
        onInitialTextConsumed={handleEditResendConsumed}
      />
    </div>
  );
});

// ── Timeline builder helpers ──

/** Split messages into user→agent cycles based on user message boundaries. */
function buildMessageCycles(allMessages: AcpChatMessage[]): MessageCycle[] {
  const cycles: MessageCycle[] = [];
  let current: MessageCycle | null = null;

  for (let i = 0; i < allMessages.length; i++) {
    const msg = allMessages[i];
    if (msg.role === "user") {
      if (current) {
        current.endTime = msg.timestamp;
        cycles.push(current);
      }
      current = { userMsg: msg, agentMsgs: [], startTime: msg.timestamp, endTime: Infinity };
    } else {
      if (!current) {
        current = { userMsg: null, agentMsgs: [], startTime: 0, endTime: Infinity };
      }
      current.agentMsgs.push({ msg, idx: i });
    }
  }
  if (current) cycles.push(current);
  return cycles;
}

/**
 * Option A — Split turns: each agent message gets its own turn.
 * Tool calls are assigned by agent-message timestamp boundaries.
 */
function buildTimelineSplitTurns(
  cycles: MessageCycle[],
  visibleToolCalls: AcpToolCallState[],
  thinkingBlocks: AcpThinkingBlock[],
  lastAgentIdx: number,
): TimelineItem[] {
  const result: TimelineItem[] = [];

  for (const cycle of cycles) {
    if (cycle.userMsg) {
      result.push({ type: "user-message", data: cycle.userMsg });
    }

    // Items in this cycle's time window
    const cycleTcs = visibleToolCalls.filter(
      (tc) => tc.timestamp >= cycle.startTime && tc.timestamp < cycle.endTime,
    );
    const cycleTbs = thinkingBlocks.filter(
      (tb) => tb.timestamp >= cycle.startTime && tb.timestamp < cycle.endTime,
    );

    if (cycle.agentMsgs.length === 0) {
      // Orphan cycle — no agent messages yet, show in-progress turn
      if (cycleTcs.length > 0 || cycleTbs.length > 0) {
        result.push({
          type: "agent-turn",
          turn: { toolCalls: cycleTcs, thinkingBlocks: cycleTbs, agentMessage: null, isLastAgent: false },
        });
      }
      continue;
    }

    // Assign tool calls / thinking to each agent message by timestamp boundaries
    for (let a = 0; a < cycle.agentMsgs.length; a++) {
      // First agent msg gets everything from cycle start; subsequent msgs get from their own timestamp
      const lowerBound = a === 0 ? cycle.startTime : cycle.agentMsgs[a].msg.timestamp;
      const upperBound = a < cycle.agentMsgs.length - 1
        ? cycle.agentMsgs[a + 1].msg.timestamp
        : cycle.endTime;

      const turnTcs = cycleTcs.filter((tc) => tc.timestamp >= lowerBound && tc.timestamp < upperBound);
      const turnTbs = cycleTbs.filter((tb) => tb.timestamp >= lowerBound && tb.timestamp < upperBound);

      result.push({
        type: "agent-turn",
        turn: {
          toolCalls: turnTcs,
          thinkingBlocks: turnTbs,
          agentMessage: cycle.agentMsgs[a].msg,
          isLastAgent: cycle.agentMsgs[a].idx === lastAgentIdx,
        },
      });
    }
  }

  return result;
}

/**
 * Option B — Inline narration: single turn per cycle, narration messages
 * passed separately for inline rendering between tool call steps.
 */
function buildTimelineInline(
  cycles: MessageCycle[],
  visibleToolCalls: AcpToolCallState[],
  thinkingBlocks: AcpThinkingBlock[],
  lastAgentIdx: number,
): TimelineItem[] {
  const result: TimelineItem[] = [];

  for (const cycle of cycles) {
    if (cycle.userMsg) {
      result.push({ type: "user-message", data: cycle.userMsg });
    }

    const cycleTcs = visibleToolCalls.filter(
      (tc) => tc.timestamp >= cycle.startTime && tc.timestamp < cycle.endTime,
    );
    const cycleTbs = thinkingBlocks.filter(
      (tb) => tb.timestamp >= cycle.startTime && tb.timestamp < cycle.endTime,
    );

    if (cycle.agentMsgs.length === 0) {
      if (cycleTcs.length > 0 || cycleTbs.length > 0) {
        result.push({
          type: "agent-turn",
          turn: { toolCalls: cycleTcs, thinkingBlocks: cycleTbs, agentMessage: null, isLastAgent: false },
        });
      }
      continue;
    }

    // Last agent message is the "real" response; earlier ones are inline narrations
    const lastAgent = cycle.agentMsgs[cycle.agentMsgs.length - 1];
    const narrations = cycle.agentMsgs.length > 1
      ? cycle.agentMsgs.slice(0, -1).map((am) => am.msg)
      : undefined;

    result.push({
      type: "agent-turn",
      turn: {
        toolCalls: cycleTcs,
        thinkingBlocks: cycleTbs,
        agentMessage: lastAgent.msg,
        narrations,
        isLastAgent: lastAgent.idx === lastAgentIdx,
      },
    });
  }

  return result;
}

// ── Constants ──

const EMPTY_MESSAGES: AcpChatMessage[] = [];
const EMPTY_TOOL_CALLS: AcpToolCallState[] = [];
const EMPTY_THINKING_BLOCKS: AcpThinkingBlock[] = [];

// ── Sub-components ──

function WorkingIndicator() {
  return (
    <div className={DEBUG_CHAT_TIMELINE ? "relative border border-purple-500/50 rounded" : undefined}>
      {DEBUG_CHAT_TIMELINE && (
        <span className="absolute -top-2.5 left-2 text-[9px] bg-purple-500/80 text-white px-1 rounded z-10">
          WorkingIndicator
        </span>
      )}
      <div className="flex items-center gap-2 py-2 px-1">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">
          <Shimmer duration={2}>Working...</Shimmer>
        </span>
      </div>
    </div>
  );
}
