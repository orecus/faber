import { Bot, Loader2, MessageCircle } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

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
  isLastAgent: boolean;
}

type TimelineItem =
  | { type: "user-message"; data: AcpChatMessage }
  | { type: "agent-turn"; turn: AgentTurn };

interface ChatPaneProps {
  sessionId: string;
  sessionStatus: string;
}

export default React.memo(function ChatPane({
  sessionId,
  sessionStatus,
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

  // ── Build turn-based timeline ──
  // A "turn" is one complete agent response cycle: tool calls + agent message.
  // The agent message is INSIDE the turn block, not a separate timeline item.
  //
  // Strategy: Walk through messages in array order. Messages alternate user/agent.
  // For each user→agent pair, find tool calls that belong to that turn.
  //
  // Tool call assignment: messageIndex is unreliable (can point to stale indexes).
  // Instead, we assign tool calls to the turn whose user message PRECEDES them
  // in timestamp. A tool call belongs to a turn if its timestamp is >= the user
  // message's timestamp AND < the next user message's timestamp.
  const timeline = useMemo<TimelineItem[]>(() => {
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

    // ── Build turns from message pairs ──
    // Walk messages and create turns. Each turn is:
    //   - A user message (standalone)
    //   - Followed by an agent turn (tool calls + agent message)
    //
    // Tool calls are assigned based on timestamp boundaries:
    //   Turn N gets tool calls where: userMsg[N].timestamp <= tc.timestamp
    //   AND (no next user message OR tc.timestamp < userMsg[N+1].timestamp)
    const result: TimelineItem[] = [];

    // Collect user message timestamps for boundary detection
    const userMsgTimestamps: { index: number; timestamp: number }[] = [];
    for (let i = 0; i < allMessages.length; i++) {
      if (allMessages[i].role === "user") {
        userMsgTimestamps.push({ index: i, timestamp: allMessages[i].timestamp });
      }
    }

    // Assign each tool call to a turn based on timestamp boundaries
    const toolCallsByTurn = new Map<number, AcpToolCallState[]>();
    for (const tc of visibleToolCalls) {
      // Find which user message this tool call comes after
      let assignedTurnIdx = -1;
      for (let u = userMsgTimestamps.length - 1; u >= 0; u--) {
        if (tc.timestamp >= userMsgTimestamps[u].timestamp) {
          assignedTurnIdx = userMsgTimestamps[u].index;
          break;
        }
      }
      const arr = toolCallsByTurn.get(assignedTurnIdx) ?? [];
      arr.push(tc);
      toolCallsByTurn.set(assignedTurnIdx, arr);
    }

    // Assign thinking blocks to turns using same timestamp boundary logic
    const thinkingByTurn = new Map<number, AcpThinkingBlock[]>();
    for (const tb of thinkingBlocks) {
      let assignedTurnIdx = -1;
      for (let u = userMsgTimestamps.length - 1; u >= 0; u--) {
        if (tb.timestamp >= userMsgTimestamps[u].timestamp) {
          assignedTurnIdx = userMsgTimestamps[u].index;
          break;
        }
      }
      const arr = thinkingByTurn.get(assignedTurnIdx) ?? [];
      arr.push(tb);
      thinkingByTurn.set(assignedTurnIdx, arr);
    }

    // Walk messages and build timeline
    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];

      if (msg.role === "user") {
        result.push({ type: "user-message", data: msg });
      } else {
        // Agent message — find the preceding user message to get this turn's tool calls
        // Look backwards for the nearest user message
        let precedingUserIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
          if (allMessages[j].role === "user") {
            precedingUserIdx = j;
            break;
          }
        }

        const turnToolCalls = toolCallsByTurn.get(precedingUserIdx) ?? [];
        const turnThinking = thinkingByTurn.get(precedingUserIdx) ?? [];
        result.push({
          type: "agent-turn",
          turn: {
            toolCalls: turnToolCalls,
            thinkingBlocks: turnThinking,
            agentMessage: msg,
            isLastAgent: i === lastAgentIdx,
          },
        });
        // Remove so they aren't reused
        toolCallsByTurn.delete(precedingUserIdx);
        thinkingByTurn.delete(precedingUserIdx);
      }
    }

    // Handle orphan tool calls / thinking blocks (no agent message yet for the current turn)
    const remainingTcs: AcpToolCallState[] = [];
    for (const [, tcs] of toolCallsByTurn) {
      remainingTcs.push(...tcs);
    }
    const remainingThinking: AcpThinkingBlock[] = [];
    for (const [, tbs] of thinkingByTurn) {
      remainingThinking.push(...tbs);
    }
    if (remainingTcs.length > 0 || remainingThinking.length > 0) {
      remainingTcs.sort((a, b) => a.timestamp - b.timestamp);
      result.push({
        type: "agent-turn",
        turn: { toolCalls: remainingTcs, thinkingBlocks: remainingThinking, agentMessage: null, isLastAgent: false },
      });
    }

    return result;
  }, [messages, toolCalls, thinkingBlocks]);

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
