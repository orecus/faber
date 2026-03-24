import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ChevronDown,
  Cloud,
  GitBranch,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { BranchList } from "../../types";

interface BranchSelectProps {
  projectId: string;
  currentBranch: string | null;
  mode: "checkout" | "select";
  /** For select mode — the selected base branch (empty string = Current HEAD) */
  value?: string;
  /** For select mode — called when user picks a branch */
  onChange?: (branch: string) => void;
  /** For checkout mode — called after successful checkout */
  onBranchChanged?: () => void;
  triggerClassName?: string;
  /** "badge" for toolbar use, "select" for form fields */
  triggerVariant?: "badge" | "select";
  /** Open dropdown above the trigger instead of below */
  dropUp?: boolean;
}

export default function BranchSelect({
  projectId,
  currentBranch,
  mode,
  value,
  onChange,
  onBranchChanged,
  triggerClassName,
  triggerVariant = "badge",
  dropUp,
}: BranchSelectProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Fetch branches when opened
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSearch("");
    setCreatingBranch(false);
    setNewBranchName("");
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

  // Focus create input when entering create mode
  useEffect(() => {
    if (creatingBranch) {
      requestAnimationFrame(() => createInputRef.current?.focus());
    }
  }, [creatingBranch]);

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
      if (e.key === "Escape") {
        if (creatingBranch) {
          setCreatingBranch(false);
          setNewBranchName("");
        } else {
          setOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, creatingBranch]);

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

  const handleSelect = useCallback(
    async (branch: string, isRemote: boolean) => {
      if (mode === "checkout") {
        if (branch === currentBranch) return;
        setActionLoading(branch);
        setError(null);
        try {
          await invoke("checkout_branch", { projectId, branch, isRemote });
          setOpen(false);
          onBranchChanged?.();
        } catch (e) {
          setError(String(e));
        } finally {
          setActionLoading(null);
        }
      } else {
        // select mode
        onChange?.(branch);
        setOpen(false);
      }
    },
    [projectId, currentBranch, mode, onChange, onBranchChanged],
  );

  const handleSelectCurrentHead = useCallback(() => {
    if (mode === "select") {
      onChange?.("");
      setOpen(false);
    }
  }, [mode, onChange]);

  const handleCreateBranch = useCallback(async () => {
    const name = newBranchName.trim();
    if (!name) return;
    setActionLoading(name);
    setError(null);
    try {
      await invoke("create_branch", { projectId, branchName: name });
      if (mode === "checkout") {
        await invoke("checkout_branch", {
          projectId,
          branch: name,
          isRemote: false,
        });
        setOpen(false);
        onBranchChanged?.();
      } else {
        onChange?.(name);
        setOpen(false);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading(null);
    }
  }, [projectId, newBranchName, mode, onChange, onBranchChanged]);

  // Display label for trigger
  const displayLabel = useMemo(() => {
    if (mode === "checkout") {
      return currentBranch ?? "No branch";
    }
    // select mode
    return value || "Current HEAD";
  }, [mode, currentBranch, value]);

  // Determine which branch is "active" (checked) in the list
  const activeBranch = mode === "checkout" ? currentBranch : value;

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger */}
      {triggerVariant === "badge" ? (
        <button
          onClick={() => setOpen((prev) => !prev)}
          className={`flex items-center gap-1 rounded-md bg-popover px-2 py-1 text-xs font-mono text-dim-foreground cursor-pointer hover:bg-accent transition-colors border border-border ${triggerClassName ?? ""}`}
          title={mode === "checkout" ? "Switch branch" : "Select base branch"}
        >
          <GitBranch className="size-3" />
          <span className="truncate max-w-[160px]">{displayLabel}</span>
          <ChevronDown className="size-2.5 text-muted-foreground" />
        </button>
      ) : (
        <button
          onClick={() => setOpen((prev) => !prev)}
          className={`flex items-center justify-between w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer hover:bg-accent/50 transition-colors ${triggerClassName ?? ""}`}
          title={mode === "checkout" ? "Switch branch" : "Select base branch"}
        >
          <span className="flex items-center gap-2 truncate text-foreground">
            <GitBranch className="size-3.5 text-muted-foreground" />
            {displayLabel}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      )}

      {/* Dropdown panel */}
      {open && (
        <div
          className={`absolute ${triggerVariant === "select" ? "left-0 right-0" : "left-0 w-[280px]"} ${dropUp ? "bottom-full mb-1 slide-in-from-bottom-2" : "top-full mt-1 slide-in-from-top-2"} z-50 rounded-md border border-border bg-popover shadow-lg ring-1 ring-foreground/10 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100`}
        >
          {/* Search */}
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
            <Search className="size-3 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a branch..."
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
              {/* Current HEAD option (select mode only) */}
              {mode === "select" && !search && (
                <>
                  <button
                    onClick={handleSelectCurrentHead}
                    className={`flex items-center gap-2 w-full px-2.5 py-1 text-xs transition-colors ${
                      !activeBranch
                        ? "text-foreground bg-accent"
                        : "text-dim-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate text-left text-[11px]">
                      Current HEAD
                    </span>
                    {!activeBranch && (
                      <Check className="size-3 text-success shrink-0" />
                    )}
                  </button>
                  <div className="mx-2 my-1 h-px bg-border" />
                </>
              )}

              {/* Local branches */}
              {filteredLocal.length > 0 && (
                <>
                  <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Local
                  </div>
                  {filteredLocal.map((b) => {
                    const isActive =
                      mode === "checkout"
                        ? b === currentBranch
                        : b === activeBranch;
                    const isLoading = actionLoading === b;
                    return (
                      <button
                        key={`local-${b}`}
                        onClick={() => handleSelect(b, false)}
                        disabled={
                          (mode === "checkout" && isActive) ||
                          actionLoading !== null
                        }
                        className={`flex items-center gap-2 w-full px-2.5 py-1 text-xs transition-colors ${
                          isActive
                            ? "text-foreground bg-accent"
                            : "text-dim-foreground hover:text-foreground hover:bg-accent"
                        } ${actionLoading !== null && !isLoading ? "opacity-50" : ""}`}
                      >
                        <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-left font-mono text-[11px]">
                          {b}
                        </span>
                        {isLoading && (
                          <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
                        )}
                        {isActive && !isLoading && (
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
                    const isActive = mode === "select" && b === activeBranch;
                    const isLoading = actionLoading === b;
                    return (
                      <button
                        key={`remote-${b}`}
                        onClick={() => handleSelect(b, true)}
                        disabled={actionLoading !== null}
                        className={`flex items-center gap-2 w-full px-2.5 py-1 text-xs transition-colors ${
                          isActive
                            ? "text-foreground bg-accent"
                            : "text-dim-foreground hover:text-foreground hover:bg-accent"
                        } ${actionLoading !== null && !isLoading ? "opacity-50" : ""}`}
                      >
                        <Cloud className="size-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-left font-mono text-[11px]">
                          {b}
                        </span>
                        {isLoading && (
                          <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
                        )}
                        {isActive && !isLoading && (
                          <Check className="size-3 text-success shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </>
              )}

              {/* Empty filtered state */}
              {filteredLocal.length === 0 &&
                filteredRemote.length === 0 &&
                !(mode === "select" && !search) && (
                  <div className="px-2.5 py-4 text-center text-[11px] text-muted-foreground">
                    No branches match &quot;{search}&quot;
                  </div>
                )}
            </div>
          )}

          {/* Create branch */}
          {!loading && branches && (
            <div className="border-t border-border">
              {!creatingBranch ? (
                <button
                  onClick={() => setCreatingBranch(true)}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-dim-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Plus className="size-3 shrink-0" />
                  <span>Create branch</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                  <input
                    ref={createInputRef}
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateBranch();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setCreatingBranch(false);
                        setNewBranchName("");
                      }
                    }}
                    placeholder="new-branch-name"
                    className="flex-1 bg-transparent text-xs text-foreground font-mono placeholder:text-muted-foreground outline-none"
                  />
                  <button
                    onClick={handleCreateBranch}
                    disabled={
                      !newBranchName.trim() || actionLoading !== null
                    }
                    className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Plus className="size-3" />
                    )}
                    Create
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
