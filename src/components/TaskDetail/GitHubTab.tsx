import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import {
  AlertCircle,
  ExternalLink,
  Github,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import {
  streamdownControls,
  streamdownPlugins,
  streamdownTheme,
} from "../../lib/markdown";
import { formatError } from "../../lib/errorMessages";
import type { GitHubComment, GitHubIssue } from "../../types";

interface GitHubTabProps {
  githubIssue: string;
  projectId: string;
}

/** Parse issue number from a github_issue ref like "owner/repo#123" or just "123". */
function parseIssueNumber(githubIssue: string): number | null {
  const match = githubIssue.match(/#?(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/** Format an ISO timestamp into a relative string like "2h ago", "3d ago". */
function relativeTime(iso: string): string {
  try {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    const diffMo = Math.floor(diffDay / 30);
    if (diffMo < 12) return `${diffMo}mo ago`;
    return `${Math.floor(diffMo / 12)}y ago`;
  } catch {
    return "";
  }
}

export default function GitHubTab({
  githubIssue,
  projectId,
}: GitHubTabProps) {
  const issueNumber = useMemo(
    () => parseIssueNumber(githubIssue),
    [githubIssue],
  );

  // ── Issue body state ──
  const [issue, setIssue] = useState<GitHubIssue | null>(null);
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  // ── Comments state ──
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Fetch issue ──
  const fetchIssue = useCallback(() => {
    if (!issueNumber || !projectId) return;
    setIssueLoading(true);
    setIssueError(null);
    invoke<GitHubIssue>("fetch_github_issue", {
      projectId,
      issueNumber,
    })
      .then(setIssue)
      .catch((err) => {
        console.warn("Failed to fetch issue:", err);
        setIssueError(formatError(err) || "Failed to load issue");
      })
      .finally(() => setIssueLoading(false));
  }, [projectId, issueNumber]);

  // ── Fetch comments ──
  const fetchComments = useCallback(() => {
    if (!issueNumber || !projectId) return;
    setCommentsLoading(true);
    setCommentsError(null);
    invoke<GitHubComment[]>("fetch_issue_comments", {
      projectId,
      issueNumber,
    })
      .then(setComments)
      .catch((err) => {
        console.warn("Failed to fetch issue comments:", err);
        setCommentsError(formatError(err) || "Failed to load comments");
        setComments([]);
      })
      .finally(() => {
        setCommentsLoading(false);
        setRefreshing(false);
      });
  }, [projectId, issueNumber]);

  // Load on mount
  useEffect(() => {
    fetchIssue();
    fetchComments();
  }, [fetchIssue, fetchComments]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchIssue();
    fetchComments();
  }, [fetchIssue, fetchComments]);

  const handlePost = useCallback(() => {
    if (!issueNumber || !projectId || !commentBody.trim()) return;
    setPosting(true);
    invoke("post_issue_comment", {
      projectId,
      issueNumber,
      body: commentBody.trim(),
    })
      .then(() => {
        setCommentBody("");
        fetchComments();
      })
      .catch((err) => {
        console.warn("Failed to post comment:", err);
        setCommentsError(formatError(err) || "Failed to post comment");
      })
      .finally(() => setPosting(false));
  }, [projectId, issueNumber, commentBody, fetchComments]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handlePost();
      }
    },
    [handlePost],
  );

  const handleOpenOnGitHub = useCallback(() => {
    if (issue?.url) {
      open(issue.url);
    } else {
      const [slug, num] = githubIssue.split("#");
      if (slug && num) {
        open(`https://github.com/${slug}/issues/${num}`);
      }
    }
  }, [issue, githubIssue]);

  if (!githubIssue) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <Github size={20} className="opacity-40" />
        <p className="text-xs">No GitHub issue linked</p>
        <p className="text-[10px] opacity-60">
          Link a GitHub issue to see its details and comments
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {/* ── Issue Body Section ── */}
      <div className="flex flex-col gap-2">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase">
              Issue
            </span>
            {issue && (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  issue.state === "open"
                    ? "bg-success/15 text-success"
                    : "bg-destructive/15 text-destructive"
                }`}
              >
                {issue.state === "open" ? "Open" : "Closed"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw
                size={10}
                className={refreshing ? "animate-spin" : ""}
              />
            </button>
            <button
              onClick={handleOpenOnGitHub}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Open on GitHub"
            >
              <ExternalLink size={10} />
              <span>Open on GitHub</span>
            </button>
          </div>
        </div>

        {/* Issue content */}
        {issueLoading && !issue ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 size={18} className="animate-spin opacity-50" />
            <p className="text-xs">Loading issue...</p>
          </div>
        ) : issueError && !issue ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
            <AlertCircle size={18} className="opacity-50 text-destructive" />
            <p className="text-xs text-destructive/80">{issueError}</p>
            <button
              onClick={fetchIssue}
              className="mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-primary hover:bg-accent transition-colors"
            >
              <RefreshCw size={10} />
              Retry
            </button>
          </div>
        ) : issue ? (
          <div className="flex flex-col gap-2">
            {/* Issue title */}
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-medium text-foreground leading-snug">
                {issue.title}
              </h3>
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                #{issue.number}
              </span>
            </div>
            {/* Labels */}
            {issue.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {issue.labels.map((label) => (
                  <span
                    key={label.name}
                    className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-border/40"
                    style={
                      label.color
                        ? {
                            backgroundColor: `#${label.color}20`,
                            color: `#${label.color}`,
                            borderColor: `#${label.color}40`,
                          }
                        : undefined
                    }
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            )}
            {/* Issue body */}
            {issue.body ? (
              <div className="rounded-md bg-accent/30 px-3 py-2.5 issue-markdown">
                <Streamdown
                  mode="static"
                  plugins={streamdownPlugins}
                  shikiTheme={streamdownTheme}
                  controls={streamdownControls}
                >
                  {issue.body}
                </Streamdown>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60 italic py-2">
                No description provided
              </p>
            )}
            {/* Meta info */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
              <span>Created {relativeTime(issue.created_at)}</span>
              {issue.updated_at !== issue.created_at && (
                <span>Updated {relativeTime(issue.updated_at)}</span>
              )}
              {issue.assignees.length > 0 && (
                <span>
                  Assigned to {issue.assignees.map((a) => a.login).join(", ")}
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Divider ── */}
      <div className="border-t border-border/30" />

      {/* ── Comments Section ── */}
      <div className="flex flex-col gap-2">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase">
              Comments
            </span>
            {comments.length > 0 && (
              <span className="text-[10px] text-muted-foreground/50">
                ({comments.length})
              </span>
            )}
          </div>
        </div>

        {/* Comments loading */}
        {commentsLoading && comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 size={18} className="animate-spin opacity-50" />
            <p className="text-xs">Loading comments...</p>
          </div>
        ) : commentsError && comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
            <AlertCircle size={18} className="opacity-50 text-destructive" />
            <p className="text-xs text-destructive/80">{commentsError}</p>
            <button
              onClick={fetchComments}
              className="mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-primary hover:bg-accent transition-colors"
            >
              <RefreshCw size={10} />
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Error banner (non-blocking) */}
            {commentsError && (
              <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
                <AlertCircle size={10} className="shrink-0" />
                <span className="flex-1 truncate">{commentsError}</span>
              </div>
            )}

            {/* Comment list */}
            {comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-muted-foreground">
                <MessageCircle size={16} className="opacity-30" />
                <p className="text-xs">No comments yet</p>
                <p className="text-[10px] opacity-50">Be the first to comment</p>
              </div>
            ) : (
              <div className="flex flex-col gap-0 -mx-0.5 px-0.5">
                {comments.map((comment, i) => (
                  <React.Fragment key={comment.id}>
                    {i > 0 && <div className="border-t border-border/20 my-1.5" />}
                    <CommentEntry comment={comment} />
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
              <textarea
                ref={textareaRef}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write a comment..."
                rows={2}
                disabled={posting}
                className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
              />
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-muted-foreground/40">
                  {commentBody.trim() ? "\u2318\u21B5 to send" : ""}
                </span>
                <button
                  onClick={handlePost}
                  disabled={posting || !commentBody.trim()}
                  className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {posting ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Send size={10} />
                  )}
                  Comment
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Single Comment Entry ──

const CommentEntry = React.memo(function CommentEntry({
  comment,
}: {
  comment: GitHubComment;
}) {
  return (
    <div className="flex flex-col gap-1">
      {/* Author row */}
      <div className="flex items-center gap-1.5">
        {comment.author_avatar ? (
          <img
            src={comment.author_avatar}
            alt={comment.author}
            className="size-5 rounded-full ring-1 ring-border/30"
          />
        ) : (
          <div className="size-5 rounded-full bg-accent flex items-center justify-center">
            <span className="text-[9px] font-medium text-muted-foreground">
              {comment.author.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <span className="text-[11px] font-medium text-foreground">
          {comment.author}
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {relativeTime(comment.created_at)}
        </span>
      </div>
      {/* Comment body */}
      <div className="ml-[26px] comment-markdown">
        <Streamdown
          mode="static"
          plugins={streamdownPlugins}
          shikiTheme={streamdownTheme}
          controls={streamdownControls}
        >
          {comment.body}
        </Streamdown>
      </div>
    </div>
  );
});
