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
import { Loader2 } from "lucide-react";

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
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
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

      {/* Load more indicator */}
      {loadingMore && (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">
            Loading more commits...
          </span>
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
