import { useState, useCallback } from "react";
import {
  X,
  Copy,
  Check,
  FilePlus2,
  FilePen,
  FileX2,
  FileSymlink,
  Loader2,
} from "lucide-react";
import { useTheme } from "../../contexts/ThemeContext";
import type { CommitDetail } from "../../types";
import { RAIL_COLORS } from "../../lib/graphLayout";
import type { GraphNode } from "../../lib/graphLayout";
import { glassStyles } from "../ui/orecus.io/lib/color-utils";

interface CommitDetailPanelProps {
  detail: CommitDetail | null;
  node: GraphNode | null;
  loading: boolean;
  onClose: () => void;
}

const STATUS_CONFIG: Record<
  string,
  { icon: typeof FilePlus2; color: string; label: string }
> = {
  added: {
    icon: FilePlus2,
    color: "var(--success)",
    label: "A",
  },
  modified: {
    icon: FilePen,
    color: "var(--primary)",
    label: "M",
  },
  deleted: {
    icon: FileX2,
    color: "var(--destructive)",
    label: "D",
  },
  renamed: {
    icon: FileSymlink,
    color: "#b5a3f5",
    label: "R",
  },
};

function formatTimestamp(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Group files by their parent directory. */
function groupByDirectory(
  files: { path: string; status: string }[],
): Map<string, typeof files> {
  const groups = new Map<string, typeof files>();
  for (const f of files) {
    const idx = f.path.lastIndexOf("/");
    const dir = idx >= 0 ? f.path.slice(0, idx) : ".";
    const existing = groups.get(dir);
    if (existing) {
      existing.push(f);
    } else {
      groups.set(dir, [f]);
    }
  }
  return groups;
}

export default function CommitDetailPanel({
  detail,
  node,
  loading,
  onClose,
}: CommitDetailPanelProps) {
  const { isGlass } = useTheme();
  const [copied, setCopied] = useState(false);

  const copyHash = useCallback(() => {
    if (!detail) return;
    navigator.clipboard.writeText(detail.hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [detail]);

  const railColor = node?.railColor ?? RAIL_COLORS[0];

  return (
    <div className={`w-[350px] shrink-0 flex flex-col border-l border-border overflow-hidden ${glassStyles[isGlass ? "normal" : "solid"]}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-foreground">
          Commit Detail
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Close detail panel"
        >
          <X size={14} />
        </button>
      </div>

      {loading && !detail && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {detail && (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {/* Hash + dot */}
          <div className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-full shrink-0"
              style={{ background: railColor }}
            />
            <code className="text-xs font-mono text-dim-foreground truncate flex-1">
              {detail.hash}
            </code>
            <button
              onClick={copyHash}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Copy full hash"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>

          {/* Author + date */}
          <div className="space-y-1">
            <div className="text-xs text-foreground">
              {detail.author_name}
            </div>
            <div className="text-xs text-muted-foreground">
              {detail.author_email}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatTimestamp(detail.timestamp)}
            </div>
          </div>

          {/* Commit message */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-foreground">
              {detail.subject}
            </div>
            {detail.body && (
              <div className="text-xs text-dim-foreground whitespace-pre-wrap leading-relaxed">
                {detail.body}
              </div>
            )}
          </div>

          {/* Parents */}
          {detail.parent_hashes.length > 0 && (
            <div className="space-y-1">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground">
                {detail.parent_hashes.length > 1 ? "Parents (merge)" : "Parent"}
              </div>
              <div className="flex flex-wrap gap-1">
                {detail.parent_hashes.map((ph) => (
                  <code
                    key={ph}
                    className="text-2xs font-mono px-1.5 py-0.5 rounded bg-popover text-dim-foreground"
                  >
                    {ph.slice(0, 12)}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Changed files */}
          {detail.files.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground">
                Files changed ({detail.files.length})
              </div>
              {Array.from(groupByDirectory(detail.files)).map(
                ([dir, files]) => (
                  <div key={dir}>
                    <div className="text-2xs text-muted-foreground mb-0.5 font-mono">
                      {dir}/
                    </div>
                    {files.map((f) => {
                      const cfg = STATUS_CONFIG[f.status] ?? STATUS_CONFIG.modified;
                      const Icon = cfg.icon;
                      const fileName = f.path.split("/").pop() ?? f.path;
                      return (
                        <div
                          key={f.path}
                          className="flex items-center gap-1.5 py-0.5 pl-3"
                        >
                          <Icon
                            size={11}
                            className="shrink-0"
                            style={{ color: cfg.color }}
                          />
                          <span className="text-xs text-dim-foreground truncate font-mono">
                            {fileName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
