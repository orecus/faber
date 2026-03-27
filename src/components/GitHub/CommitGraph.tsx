import { useRef, useCallback, useEffect, useState } from "react";
import type { GraphNode } from "../../lib/graphLayout";
import {
  ROW_HEIGHT,
  GRAPH_PADDING,
  RAIL_WIDTH,
  maxColumn,
} from "../../lib/graphLayout";
import type { RefInfo } from "../../types";
import GraphCanvas from "./GraphCanvas";
import CommitRow from "./CommitRow";
import { Skeleton } from "../ui/skeleton";

interface CommitGraphProps {
  nodes: GraphNode[];
  headHash: string | null;
  refs: Map<string, RefInfo>;
  selectedCommitHash: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onSelect: (hash: string) => void;
  onLoadMore: () => void;
  onVisibleCommits: (hashes: string[]) => void;
}

export default function CommitGraph({
  nodes,
  headHash,
  refs,
  selectedCommitHash,
  loading,
  loadingMore,
  hasMore,
  onSelect,
  onLoadMore,
  onVisibleCommits,
}: CommitGraphProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 30 });

  const maxCol = maxColumn(nodes);
  const graphWidth = GRAPH_PADDING * 2 + (maxCol + 1) * RAIL_WIDTH;
  const clampedGraphWidth = Math.max(graphWidth, 40);
  const totalHeight = nodes.length * ROW_HEIGHT;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const scrollTop = el.scrollTop;
    const clientHeight = el.clientHeight;
    const start = Math.floor(scrollTop / ROW_HEIGHT);
    const end = Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT);
    setVisibleRange({ start, end });

    // Infinite scroll
    if (
      hasMore &&
      !loadingMore &&
      scrollTop + clientHeight >= el.scrollHeight - 200
    ) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  // Fetch refs for visible commits
  useEffect(() => {
    const hashes = nodes
      .slice(visibleRange.start, visibleRange.end)
      .map((n) => n.commit.hash);
    if (hashes.length > 0) {
      onVisibleCommits(hashes);
    }
  }, [visibleRange.start, visibleRange.end, nodes, onVisibleCommits]);

  // Initial scroll listener
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    handleScroll();
  }, [handleScroll]);

  if (loading && nodes.length === 0) {
    return (
      <div className="flex-1 overflow-hidden">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center border-b border-transparent"
            style={{ height: ROW_HEIGHT }}
          >
            {/* Graph dot placeholder */}
            <div className="shrink-0 flex items-center justify-center" style={{ width: clampedGraphWidth }}>
              <Skeleton className="size-2 rounded-full" />
            </div>
            {/* Message placeholder */}
            <div className="flex-1 min-w-0 pr-2">
              <Skeleton className="h-3" style={{ width: `${55 + (i % 4) * 10}%` }} />
            </div>
            {/* Hash + time placeholder */}
            <div className="shrink-0 flex items-center gap-2 pr-3">
              <Skeleton className="h-3 w-[52px]" />
              <Skeleton className="h-3 w-[28px]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
    >
      <div className="relative" style={{ height: totalHeight }}>
        {/* SVG connection lines */}
        <GraphCanvas
          nodes={nodes}
          totalHeight={totalHeight}
          graphWidth={clampedGraphWidth}
          visibleStart={visibleRange.start}
          visibleEnd={visibleRange.end}
        />
        {/* Commit rows */}
        {nodes.map((node) => (
          <CommitRow
            key={node.commit.hash}
            node={node}
            isHead={node.commit.hash === headHash}
            isSelected={node.commit.hash === selectedCommitHash}
            refs={refs.get(node.commit.hash)}
            graphWidth={clampedGraphWidth}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Load more indicator — skeleton rows for infinite scroll */}
      {loadingMore && (
        <div className="py-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center border-b border-transparent"
              style={{ height: ROW_HEIGHT }}
            >
              <div className="shrink-0 flex items-center justify-center" style={{ width: clampedGraphWidth }}>
                <Skeleton className="size-2 rounded-full" />
              </div>
              <div className="flex-1 min-w-0 pr-2">
                <Skeleton className="h-3" style={{ width: `${45 + (i % 3) * 15}%` }} />
              </div>
              <div className="shrink-0 flex items-center gap-2 pr-3">
                <Skeleton className="h-3 w-[52px]" />
                <Skeleton className="h-3 w-[28px]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!hasMore && nodes.length > 0 && (
        <div className="py-3 text-center text-xs text-muted-foreground">
          End of history
        </div>
      )}
    </div>
  );
}
