import { invoke } from "@tauri-apps/api/core";
import { Check, Cloud, GitBranch, Loader2, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { BranchList } from "../../types";

interface BranchSwitcherProps {
  projectId: string;
  currentBranch: string | null;
  onBranchChanged: () => void;
  children: React.ReactNode;
}

export default function BranchSwitcher({
  projectId,
  currentBranch,
  onBranchChanged,
  children,
}: BranchSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch branches when opened
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSearch("");
    invoke<BranchList>("list_all_branches", { projectId })
      .then(setBranches)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const filteredLocal = useMemo(() => {
    if (!branches) return [];
    const q = search.toLowerCase();
    return branches.local.filter((b) => b.toLowerCase().includes(q));
  }, [branches, search]);

  const filteredRemote = useMemo(() => {
    if (!branches) return [];
    const q = search.toLowerCase();
    return branches.remote.filter((b) => b.toLowerCase().includes(q));
  }, [branches, search]);

  const handleCheckout = useCallback(
    async (branch: string, isRemote: boolean) => {
      if (branch === currentBranch) return;
      setCheckingOut(branch);
      setError(null);
      try {
        await invoke("checkout_branch", { projectId, branch, isRemote });
        setOpen(false);
        onBranchChanged();
      } catch (e) {
        setError(String(e));
      } finally {
        setCheckingOut(null);
      }
    },
    [projectId, currentBranch, onBranchChanged],
  );

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center cursor-pointer"
        title="Switch branch"
      >
        {children}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-[280px] rounded-md border border-border bg-popover shadow-lg ring-1 ring-foreground/10 overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-100">
          {/* Search */}
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
            <Search className="size-3 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a branch…"
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="px-2.5 py-1.5 text-[11px] text-destructive bg-[color-mix(in_oklch,var(--destructive)_8%,transparent)] border-b border-border">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Branch list */}
          {!loading && branches && (
            <div className="max-h-[280px] overflow-y-auto py-1">
              {/* Local branches */}
              {filteredLocal.length > 0 && (
                <>
                  <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Local
                  </div>
                  {filteredLocal.map((b) => {
                    const isCurrent = b === currentBranch;
                    const isLoading = checkingOut === b;
                    return (
                      <button
                        key={`local-${b}`}
                        onClick={() => handleCheckout(b, false)}
                        disabled={isCurrent || checkingOut !== null}
                        className={`flex items-center gap-2 w-full px-2.5 py-1 text-xs transition-colors ${
                          isCurrent
                            ? "text-foreground bg-accent"
                            : "text-dim-foreground hover:text-foreground hover:bg-accent"
                        } ${checkingOut !== null && !isLoading ? "opacity-50" : ""}`}
                      >
                        <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-left font-mono text-[11px]">
                          {b}
                        </span>
                        {isLoading && (
                          <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
                        )}
                        {isCurrent && !isLoading && (
                          <Check className="size-3 text-success shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </>
              )}

              {/* Remote branches */}
              {filteredRemote.length > 0 && (
                <>
                  {filteredLocal.length > 0 && (
                    <div className="mx-2 my-1 h-px bg-border" />
                  )}
                  <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Remote
                  </div>
                  {filteredRemote.map((b) => {
                    const isLoading = checkingOut === b;
                    return (
                      <button
                        key={`remote-${b}`}
                        onClick={() => handleCheckout(b, true)}
                        disabled={checkingOut !== null}
                        className={`flex items-center gap-2 w-full px-2.5 py-1 text-xs transition-colors text-dim-foreground hover:text-foreground hover:bg-accent ${
                          checkingOut !== null && !isLoading ? "opacity-50" : ""
                        }`}
                      >
                        <Cloud className="size-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-left font-mono text-[11px]">
                          {b}
                        </span>
                        {isLoading && (
                          <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </>
              )}

              {/* Empty filtered state */}
              {filteredLocal.length === 0 && filteredRemote.length === 0 && (
                <div className="px-2.5 py-4 text-center text-[11px] text-muted-foreground">
                  No branches match "{search}"
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
