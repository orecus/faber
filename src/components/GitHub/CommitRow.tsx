import React from "react";
import { GitMerge } from "lucide-react";
import type { GraphNode } from "../../lib/graphLayout";
import { columnToX, ROW_HEIGHT } from "../../lib/graphLayout";
import type { RefInfo } from "../../types";

interface CommitRowProps {
  node: GraphNode;
  isHead: boolean;
  isSelected: boolean;
  refs: RefInfo | undefined;
  graphWidth: number;
  onSelect: (hash: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo`;
  return `${Math.floor(diff / 31536000)}y`;
}

function CommitRowInner({
  node,
  isHead,
  isSelected,
  refs,
  graphWidth,
  onSelect,
}: CommitRowProps) {
  const { commit, column, railColor } = node;
  const isMerge = commit.parent_hashes.length > 1;
  const cx = columnToX(column);
  const cy = ROW_HEIGHT / 2;
  const dotRadius = isMerge ? 5 : 4;

  return (
    <div
      onClick={() => onSelect(commit.hash)}
      className={`flex items-center cursor-pointer border-b border-transparent hover:bg-accent ${
        isSelected
          ? "bg-accent border-b-border"
          : ""
      }`}
      style={{ height: ROW_HEIGHT, minHeight: ROW_HEIGHT }}
    >
      {/* Graph dot area */}
      <div className="shrink-0 relative" style={{ width: graphWidth }}>
        <svg width={graphWidth} height={ROW_HEIGHT} className="block">
          {/* Merge inner circle */}
          {isMerge && (
            <circle
              cx={cx}
              cy={cy}
              r={dotRadius}
              fill="var(--background)"
              stroke={railColor}
              strokeWidth={2.5}
            />
          )}
          {/* Main dot */}
          {!isMerge && (
            <circle cx={cx} cy={cy} r={dotRadius} fill={railColor} />
          )}
          {/* HEAD ring */}
          {isHead && (
            <circle
              cx={cx}
              cy={cy}
              r={dotRadius + 3}
              fill="none"
              stroke="var(--foreground)"
              strokeWidth={1.5}
              opacity={0.8}
            />
          )}
        </svg>
      </div>

      {/* Refs + message */}
      <div className="flex-1 flex items-center gap-1.5 min-w-0 pr-2">
        {/* Branch refs */}
        {refs?.branches.map((b) => (
          <span
            key={b}
            className="shrink-0 inline-flex items-center rounded-[3px] px-1.5 py-px text-[10px] font-medium leading-tight max-w-[120px] truncate bg-[color-mix(in_oklch,var(--primary)_15%,transparent)] text-primary border border-[color-mix(in_oklch,var(--primary)_25%,transparent)]"
          >
            {b}
          </span>
        ))}
        {/* Tag refs */}
        {refs?.tags.map((t) => (
          <span
            key={t}
            className="shrink-0 inline-flex items-center rounded-[3px] px-1.5 py-px text-[10px] font-medium leading-tight max-w-[90px] truncate bg-[color-mix(in_oklch,var(--warning)_15%,transparent)] text-warning border border-[color-mix(in_oklch,var(--warning)_25%,transparent)]"
          >
            {t}
          </span>
        ))}
        {/* Subject */}
        <span className="truncate text-xs text-foreground">
          {commit.subject}
        </span>
      </div>

      {/* Right: merge indicator, hash, time */}
      <div className="shrink-0 flex items-center gap-2 pr-3">
        {isMerge && (
          <GitMerge
            size={11}
            className="text-muted-foreground shrink-0"
          />
        )}
        <span className="text-[11px] font-mono text-muted-foreground w-[52px] text-right">
          {commit.short_hash}
        </span>
        <span className="text-[10px] text-muted-foreground w-[28px] text-right tabular-nums">
          {formatRelativeTime(commit.timestamp)}
        </span>
      </div>
    </div>
  );
}

const CommitRow = React.memo(CommitRowInner);
export default CommitRow;
