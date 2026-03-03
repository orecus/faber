import { GitBranch, GitFork, Loader2, RefreshCw } from "lucide-react";

import { Button } from "../ui/orecus.io/components/enhanced-button";

interface BranchFilterProps {
  allBranches: boolean;
  onToggle: (allBranches: boolean) => void;
  onRefresh: () => void;
  loading: boolean;
  commitCount: number;
}

export default function BranchFilter({
  allBranches,
  onToggle,
  onRefresh,
  loading,
  commitCount,
}: BranchFilterProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
      {/* Commit count */}
      <span className="text-xs text-muted-foreground">
        {commitCount} commit{commitCount !== 1 ? "s" : ""}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Branch toggle */}
      <div className="flex items-center rounded-[var(--radius-element)] border border-border overflow-hidden">
        <button
          onClick={() => onToggle(true)}
          title="Show all branches"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] transition-colors ${
            allBranches
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-dim-foreground"
          }`}
        >
          <GitFork size={11} />
          All
        </button>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={() => onToggle(false)}
          title="Show current branch only"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] transition-colors ${
            !allBranches
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-dim-foreground"
          }`}
        >
          <GitBranch size={11} />
          Current
        </button>
      </div>

      {/* Refresh */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        leftIcon={
          loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )
        }
        hoverEffect="scale"
        clickEffect="scale"
        className="text-dim-foreground hover:text-foreground"
        title="Refresh commit history"
      >
        Refresh
      </Button>
    </div>
  );
}
