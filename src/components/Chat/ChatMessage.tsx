import { Copy, Check, Pencil, AlertCircle } from "lucide-react";
import React, { useCallback, useState } from "react";

import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";


import type { AcpMessageAttachment } from "../../types";

/** Minimal message shape accepted by ChatMessage (works with both legacy and new entry types). */
export interface ChatMessageData {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
  attachments?: AcpMessageAttachment[];
  isError?: boolean;
}

interface ChatMessageProps {
  message: ChatMessageData;
  isStreaming?: boolean;
  /** Callback when user clicks "Edit & resend" on their own message. */
  onEditResend?: (text: string) => void;
}

export default React.memo(function ChatMessage({
  message,
  isStreaming = false,
  onEditResend,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.text]);

  const handleEditResend = useCallback(() => {
    onEditResend?.(message.text);
  }, [message.text, onEditResend]);

  // User messages: render actions inline beside the bubble
  if (isUser) {
    return (
      <Message from="user">
        <div className="flex items-center gap-1 ml-auto">
          {/* Edit & resend — inline beside the bubble */}
          {onEditResend && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <MessageAction
                tooltip="Edit & resend"
                onClick={handleEditResend}
              >
                <Pencil size={14} />
              </MessageAction>
            </div>
          )}
          <MessageContent className="group-[.is-user]:bg-card">
            {message.attachments && message.attachments.length > 0 && (
              <Attachments variant="inline" className="gap-1.5 flex-wrap mb-1.5">
                {message.attachments.map((att, i) => (
                  <Attachment
                    key={`${att.filename}-${i}`}
                    data={{
                      id: `${i}`,
                      type: "file" as const,
                      filename: att.filename,
                      mediaType: att.mediaType,
                      url: att.url,
                    }}
                  >
                    <AttachmentPreview />
                    <AttachmentInfo />
                  </Attachment>
                ))}
              </Attachments>
            )}
            <p className="text-sm whitespace-pre-wrap break-words">
              {message.text}
            </p>
          </MessageContent>
        </div>
      </Message>
    );
  }

  // Error messages: render with destructive styling
  if (message.isError) {
    return (
      <Message from="assistant">
        <MessageContent className="bg-destructive/10 border border-destructive/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-destructive mb-1">Error</p>
              <p className="text-sm text-destructive/90 whitespace-pre-wrap break-words font-mono">
                {message.text}
              </p>
            </div>
          </div>
        </MessageContent>
      </Message>
    );
  }

  // Assistant messages: actions below content
  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        <div className="min-w-0 rounded-lg bg-card px-4 py-3 ml-6">
          <MessageResponse mode={isStreaming ? "streaming" : "static"}>
            {message.text}
          </MessageResponse>
        </div>
      </MessageContent>

      {/* Actions — hover-visible */}
      {message.text.length > 0 && (
        <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
          <MessageAction
            tooltip="Copy message"
            onClick={handleCopy}
          >
            {copied ? (
              <Check size={14} className="text-success" />
            ) : (
              <Copy size={14} />
            )}
          </MessageAction>
        </MessageActions>
      )}
    </Message>
  );
});
