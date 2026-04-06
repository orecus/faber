/**
 * Shared diff renderer — pure React + Tailwind, no dangerouslySetInnerHTML.
 *
 * Supports:
 * - Unified (line-by-line) view
 * - Side-by-side (split) view
 * - Context collapsing (configurable threshold)
 * - Word-level highlighting within changed lines
 * - Multi-file diffs
 */

import { diffWordsWithSpace } from "diff";
import { ChevronsUpDown } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import type { DiffFile, DiffLine } from "./types";

// ── Public API ──

export type DiffViewMode = "unified" | "side-by-side";

interface DiffRendererProps {
  files: DiffFile[];
  viewMode?: DiffViewMode;
  /** Maximum consecutive context lines before collapsing (0 = no collapsing). */
  contextThreshold?: number;
  /** Show the per-file header bar with path and stats. */
  showFileHeaders?: boolean;
  /** CSS class applied to the outermost wrapper. */
  className?: string;
}

export default React.memo(function DiffRenderer({
  files,
  viewMode = "unified",
  contextThreshold = 4,
  showFileHeaders = true,
  className = "",
}: DiffRendererProps) {
  if (files.length === 0) return null;

  return (
    <div className={className}>
      {files.map((file, i) => (
        <FileDiff
          key={`${file.path}-${i}`}
          file={file}
          viewMode={viewMode}
          contextThreshold={contextThreshold}
          showHeader={showFileHeaders}
          isLast={i === files.length - 1}
        />
      ))}
    </div>
  );
});

// ── Per-File Renderer ──

function FileDiff({
  file,
  viewMode,
  contextThreshold,
  showHeader,
  isLast,
}: {
  file: DiffFile;
  viewMode: DiffViewMode;
  contextThreshold: number;
  showHeader: boolean;
  isLast: boolean;
}) {
  const [showAllContext, setShowAllContext] = useState(false);
  const toggleShowAll = useCallback(() => setShowAllContext((v) => !v), []);

  // Flatten all hunks into a single line array with separators between hunks
  const allLines = useMemo(() => {
    const result: DisplayItem[] = [];
    for (let hi = 0; hi < file.hunks.length; hi++) {
      if (hi > 0) {
        result.push({ kind: "hunk-sep" });
      }
      for (const line of file.hunks[hi].lines) {
        result.push({ kind: "line", line });
      }
    }
    return result;
  }, [file.hunks]);

  // Apply context collapsing
  const displayItems = useMemo(
    () =>
      contextThreshold > 0
        ? collapseContext(allLines, contextThreshold, showAllContext)
        : allLines,
    [allLines, contextThreshold, showAllContext],
  );

  const hasCollapsed = displayItems.some((d) => d.kind === "collapsed");

  // Compute word-diff pairings: maps a DiffLine → its paired line's text for word highlighting
  const wordPairMap = useMemo(() => buildWordPairMap(displayItems), [displayItems]);

  // Compute stats
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") added++;
        else if (line.type === "remove") removed++;
      }
    }
    return { added, removed };
  }, [file.hunks]);

  // Build paired lines for side-by-side view
  const sideBySidePairs = useMemo(
    () => (viewMode === "side-by-side" ? buildSideBySidePairs(displayItems) : null),
    [viewMode, displayItems],
  );

  return (
    <div
      className={`rounded-md border border-border/40 overflow-hidden font-mono text-xs ${isLast ? "" : "mb-2"}`}
    >
      {/* File header */}
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-muted/50 sticky top-0 z-10">
          <span
            className="text-2xs text-muted-foreground/70 truncate"
            title={file.path}
          >
            {file.path}
            {file.isNewFile && (
              <span className="ml-1.5 text-success/70">(new)</span>
            )}
            {file.isDeleted && (
              <span className="ml-1.5 text-destructive/70">(deleted)</span>
            )}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {stats.added > 0 && (
              <span className="text-2xs text-success/80">+{stats.added}</span>
            )}
            {stats.removed > 0 && (
              <span className="text-2xs text-destructive/80">
                &minus;{stats.removed}
              </span>
            )}
            {hasCollapsed && (
              <button
                type="button"
                onClick={toggleShowAll}
                className="text-2xs text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-0.5"
                title={showAllContext ? "Collapse context" : "Show all lines"}
              >
                <ChevronsUpDown size={10} />
                {showAllContext ? "Collapse" : "Expand all"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Diff content */}
      <div className="overflow-x-auto overflow-y-auto">
        {viewMode === "side-by-side" && sideBySidePairs ? (
          <SideBySideView pairs={sideBySidePairs} onExpandAll={toggleShowAll} />
        ) : (
          <UnifiedView items={displayItems} wordPairMap={wordPairMap} onExpandAll={toggleShowAll} />
        )}
      </div>
    </div>
  );
}

// ── Unified View ──

function UnifiedView({
  items,
  wordPairMap,
  onExpandAll,
}: {
  items: DisplayItem[];
  wordPairMap: Map<DiffLine, string>;
  onExpandAll: () => void;
}) {
  return (
    <pre className="leading-relaxed">
      {items.map((item, i) => {
        if (item.kind === "collapsed") {
          return (
            <CollapsedRow
              key={`c-${i}`}
              count={item.count}
              onClick={onExpandAll}
            />
          );
        }
        if (item.kind === "hunk-sep") {
          return <HunkSeparator key={`sep-${i}`} />;
        }
        const { line } = item;
        const pairText = wordPairMap.get(line);
        return (
          <div key={i} className={`flex ${LINE_STYLES[line.type]}`}>
            <LineNumberGutter
              oldLineNo={line.oldLineNo}
              newLineNo={line.newLineNo}
            />
            <span className="select-none text-muted-foreground/40 w-5 text-center shrink-0">
              {INDICATORS[line.type]}
            </span>
            <span className="flex-1 px-1 py-px whitespace-pre">
              {line.type === "context" ? (
                line.text
              ) : (
                <WordHighlightedText line={line} pairText={pairText} />
              )}
            </span>
          </div>
        );
      })}
    </pre>
  );
}

// ── Side-by-Side View ──

interface SidePair {
  kind: "pair";
  left: DiffLine | null;
  right: DiffLine | null;
}
interface SideCollapsed {
  kind: "collapsed";
  count: number;
}
interface SideSep {
  kind: "hunk-sep";
}
type SideItem = SidePair | SideCollapsed | SideSep;

function SideBySideView({
  pairs,
  onExpandAll,
}: {
  pairs: SideItem[];
  onExpandAll: () => void;
}) {
  return (
    <pre className="leading-relaxed">
      {pairs.map((item, i) => {
        if (item.kind === "collapsed") {
          return (
            <CollapsedRow
              key={`c-${i}`}
              count={item.count}
              onClick={onExpandAll}
            />
          );
        }
        if (item.kind === "hunk-sep") {
          return <HunkSeparator key={`sep-${i}`} />;
        }
        const { left, right } = item;
        // In side-by-side, paired lines provide each other's text for word highlighting
        const leftPairText = left && right && left.type === "remove" && right.type === "add" ? right.text : undefined;
        const rightPairText = left && right && left.type === "remove" && right.type === "add" ? left.text : undefined;
        return (
          <div key={i} className="flex">
            {/* Left side (old) */}
            <div
              className={`flex flex-1 min-w-0 ${left ? LINE_STYLES[left.type] : ""}`}
            >
              <span className="select-none text-2xs text-muted-foreground/25 w-8 text-right pr-1 shrink-0 border-r border-border/10 flex items-center justify-end">
                {left?.oldLineNo ?? ""}
              </span>
              <span className="select-none text-muted-foreground/40 w-5 text-center shrink-0">
                {left ? INDICATORS[left.type] : " "}
              </span>
              <span className="flex-1 px-1 py-px whitespace-pre overflow-hidden text-ellipsis">
                {left ? (
                  left.type === "context" ? (
                    left.text
                  ) : (
                    <WordHighlightedText line={left} pairText={leftPairText} />
                  )
                ) : null}
              </span>
            </div>
            {/* Divider */}
            <div className="w-px bg-border/30 shrink-0" />
            {/* Right side (new) */}
            <div
              className={`flex flex-1 min-w-0 ${right ? LINE_STYLES[right.type] : ""}`}
            >
              <span className="select-none text-2xs text-muted-foreground/25 w-8 text-right pr-1 shrink-0 border-r border-border/10 flex items-center justify-end">
                {right?.newLineNo ?? ""}
              </span>
              <span className="select-none text-muted-foreground/40 w-5 text-center shrink-0">
                {right ? INDICATORS[right.type] : " "}
              </span>
              <span className="flex-1 px-1 py-px whitespace-pre overflow-hidden text-ellipsis">
                {right ? (
                  right.type === "context" ? (
                    right.text
                  ) : (
                    <WordHighlightedText line={right} pairText={rightPairText} />
                  )
                ) : null}
              </span>
            </div>
          </div>
        );
      })}
    </pre>
  );
}

// ── Word-Level Highlighting ──

/**
 * Render a changed line with word-level highlighting.
 * When a `pairText` is provided (the corresponding add/remove line's text),
 * uses jsdiff to highlight the specific words that changed.
 */
function WordHighlightedText({
  line,
  pairText,
}: {
  line: DiffLine;
  pairText?: string;
}) {
  if (pairText === undefined) return <>{line.text}</>;

  const isAdd = line.type === "add";
  const oldText = isAdd ? pairText : line.text;
  const newText = isAdd ? line.text : pairText;

  const changes = diffWordsWithSpace(oldText, newText);

  return (
    <>
      {changes.map((change, i) => {
        // Show parts relevant to this side
        if (isAdd) {
          // For add lines: show added parts (highlighted) and unchanged parts
          if (change.removed) return null;
          if (change.added) {
            return (
              <span key={i} className="bg-success/20 rounded-[2px]">
                {change.value}
              </span>
            );
          }
          return <React.Fragment key={i}>{change.value}</React.Fragment>;
        }
        // For remove lines: show removed parts (highlighted) and unchanged parts
        if (change.added) return null;
        if (change.removed) {
          return (
            <span key={i} className="bg-destructive/20 rounded-[2px]">
              {change.value}
            </span>
          );
        }
        return <React.Fragment key={i}>{change.value}</React.Fragment>;
      })}
    </>
  );
}

// ── Shared Primitives ──

function LineNumberGutter({
  oldLineNo,
  newLineNo,
}: {
  oldLineNo: number | null;
  newLineNo: number | null;
}) {
  return (
    <>
      <span className="select-none text-2xs text-muted-foreground/25 w-8 text-right pr-1 shrink-0 border-r border-border/10 self-stretch flex items-center justify-end">
        {oldLineNo ?? ""}
      </span>
      <span className="select-none text-2xs text-muted-foreground/25 w-8 text-right pr-1 shrink-0 border-r border-border/10 self-stretch flex items-center justify-end">
        {newLineNo ?? ""}
      </span>
    </>
  );
}

function CollapsedRow({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1 bg-accent/20 border-y border-border/15 text-muted-foreground/40 text-2xs cursor-pointer hover:bg-accent/30 transition-colors"
      onClick={onClick}
    >
      <ChevronsUpDown size={10} />
      <span>
        {count} unchanged line{count !== 1 ? "s" : ""} hidden
      </span>
    </div>
  );
}

function HunkSeparator() {
  return (
    <div className="flex items-center px-3 py-0.5 bg-accent/10 border-y border-border/10 text-muted-foreground/30 text-2xs">
      <span className="flex-1 border-t border-border/15" />
    </div>
  );
}

// ── Style Constants ──

const LINE_STYLES: Record<DiffLine["type"], string> = {
  context: "text-dim-foreground",
  add: "bg-success/8 text-success",
  remove: "bg-destructive/8 text-destructive",
};

const INDICATORS: Record<DiffLine["type"], string> = {
  context: " ",
  add: "+",
  remove: "-",
};

// ── Display Item Types ──

type DisplayItem =
  | { kind: "line"; line: DiffLine }
  | { kind: "collapsed"; count: number }
  | { kind: "hunk-sep" };

// ── Context Collapsing Logic ──

function collapseContext(
  items: DisplayItem[],
  threshold: number,
  showAll: boolean,
): DisplayItem[] {
  if (showAll) return items;

  const result: DisplayItem[] = [];
  let contextRun: DisplayItem[] = [];

  const flushContext = () => {
    if (contextRun.length <= threshold) {
      result.push(...contextRun);
    } else {
      // Show first 2, collapse middle, show last 2
      result.push(contextRun[0], contextRun[1]);
      result.push({ kind: "collapsed", count: contextRun.length - 4 });
      result.push(contextRun[contextRun.length - 2], contextRun[contextRun.length - 1]);
    }
    contextRun = [];
  };

  for (const item of items) {
    if (item.kind === "line" && item.line.type === "context") {
      contextRun.push(item);
    } else {
      if (contextRun.length > 0) flushContext();
      result.push(item);
    }
  }
  if (contextRun.length > 0) flushContext();

  return result;
}

// ── Word-Diff Pairing (Unified View) ──

/**
 * Build a map from each DiffLine to the text of its paired counterpart.
 * Adjacent remove/add blocks are paired 1:1 for word-level highlighting.
 */
function buildWordPairMap(items: DisplayItem[]): Map<DiffLine, string> {
  const map = new Map<DiffLine, string>();
  let i = 0;

  while (i < items.length) {
    const item = items[i];
    if (item.kind !== "line" || item.line.type !== "remove") {
      i++;
      continue;
    }

    // Collect consecutive removes
    const removes: DiffLine[] = [];
    while (i < items.length && items[i].kind === "line" && (items[i] as { kind: "line"; line: DiffLine }).line.type === "remove") {
      removes.push((items[i] as { kind: "line"; line: DiffLine }).line);
      i++;
    }

    // Collect consecutive adds
    const adds: DiffLine[] = [];
    while (i < items.length && items[i].kind === "line" && (items[i] as { kind: "line"; line: DiffLine }).line.type === "add") {
      adds.push((items[i] as { kind: "line"; line: DiffLine }).line);
      i++;
    }

    // Pair 1:1 for word highlighting
    const pairCount = Math.min(removes.length, adds.length);
    for (let j = 0; j < pairCount; j++) {
      map.set(removes[j], adds[j].text);
      map.set(adds[j], removes[j].text);
    }
  }

  return map;
}

// ── Side-by-Side Pairing ──

/**
 * Convert display items into side-by-side pairs.
 * Adjacent remove/add blocks are paired; context lines appear on both sides.
 */
function buildSideBySidePairs(items: DisplayItem[]): SideItem[] {
  const result: SideItem[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];

    if (item.kind === "collapsed") {
      result.push({ kind: "collapsed", count: item.count });
      i++;
      continue;
    }

    if (item.kind === "hunk-sep") {
      result.push({ kind: "hunk-sep" });
      i++;
      continue;
    }

    const { line } = item;

    if (line.type === "context") {
      result.push({ kind: "pair", left: line, right: line });
      i++;
      continue;
    }

    // Collect consecutive remove/add blocks for pairing
    const removes: DiffLine[] = [];
    const adds: DiffLine[] = [];

    while (
      i < items.length &&
      items[i].kind === "line" &&
      (items[i] as { kind: "line"; line: DiffLine }).line.type === "remove"
    ) {
      removes.push((items[i] as { kind: "line"; line: DiffLine }).line);
      i++;
    }
    while (
      i < items.length &&
      items[i].kind === "line" &&
      (items[i] as { kind: "line"; line: DiffLine }).line.type === "add"
    ) {
      adds.push((items[i] as { kind: "line"; line: DiffLine }).line);
      i++;
    }

    // Handle case where we started on an add line without removes before it
    if (removes.length === 0 && adds.length === 0) {
      if (line.type === "add") {
        result.push({ kind: "pair", left: null, right: line });
      } else {
        result.push({ kind: "pair", left: line, right: null });
      }
      i++;
      continue;
    }

    // Pair removes and adds
    const maxLen = Math.max(removes.length, adds.length);
    for (let j = 0; j < maxLen; j++) {
      result.push({
        kind: "pair",
        left: j < removes.length ? removes[j] : null,
        right: j < adds.length ? adds[j] : null,
      });
    }
  }

  return result;
}
