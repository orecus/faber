import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Priority, TaskStatus } from "../../types";
import type { FilterState, FilterAction } from "../../hooks/useDashboardFilters";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { gradientHexColors } from "../ui/orecus.io/lib/color-utils";
import { Separator } from "../ui/separator";

const PRIORITIES: Priority[] = ["P0", "P1", "P2"];

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "ready", label: "Ready" },
  { value: "in-progress", label: "In Progress" },
  { value: "in-review", label: "In Review" },
  { value: "done", label: "Done" },
];

const PRIORITY_COLORS: Record<Priority, string> = {
  P0: "var(--destructive)",
  P1: "var(--warning)",
  P2: "var(--muted-foreground)",
};

interface FilterBarProps {
  filters: FilterState;
  dispatchFilter: (action: FilterAction) => void;
  hasActiveFilters: boolean;
  allLabels: string[];
  allAgents: string[];
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

function ToggleChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-[11px] font-semibold rounded-[var(--radius-element)] cursor-pointer transition-all duration-100 ${active ? "bg-accent" : "bg-transparent"}`}
      style={{
        border: active
          ? `1px solid ${color ?? "var(--primary)"}`
          : "1px solid var(--border)",
        color: active ? (color ?? "var(--foreground)") : "var(--muted-foreground)",
      }}
    >
      {label}
    </button>
  );
}

export default function FilterBar({
  filters,
  dispatchFilter,
  hasActiveFilters,
  allLabels,
  allAgents,
  searchInputRef,
}: FilterBarProps) {
  const accentColor = useProjectAccentColor();
  const accentHex = gradientHexColors[accentColor]?.start ?? "var(--primary)";

  // Debounced search input
  const [localSearch, setLocalSearch] = useState(filters.searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearchChange = useCallback(
    (value: string) => {
      setLocalSearch(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        dispatchFilter({ type: "SET_SEARCH", text: value });
      }, 250);
    },
    [dispatchFilter],
  );

  const clearSearch = useCallback(() => {
    setLocalSearch("");
    clearTimeout(debounceRef.current);
    dispatchFilter({ type: "SET_SEARCH", text: "" });
    searchInputRef?.current?.focus();
  }, [dispatchFilter, searchInputRef]);

  // Sync local state if cleared externally (e.g. "Clear filters")
  useEffect(() => {
    if (filters.searchQuery === "" && localSearch !== "") {
      setLocalSearch("");
    }
  }, [filters.searchQuery]);

  return (
    <div className="flex items-center gap-2 flex-wrap py-1.5">
      {/* Search input */}
      <div className="relative flex items-center">
        <Search className="absolute left-2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search tasks…"
          className="h-6 w-44 pl-7 pr-6 text-[11px] rounded-[var(--radius-element)] bg-transparent border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
        />
        {localSearch && (
          <button
            onClick={clearSearch}
            className="absolute right-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <Separator orientation="vertical" className="mx-0.5 h-4" />

      {/* Priority toggles */}
      <span className="text-[11px] text-muted-foreground mr-0.5">
        Priority:
      </span>
      {PRIORITIES.map((p) => (
        <ToggleChip
          key={p}
          label={p}
          active={filters.priorities.has(p)}
          color={PRIORITY_COLORS[p]}
          onClick={() => dispatchFilter({ type: "TOGGLE_PRIORITY", priority: p })}
        />
      ))}

      {/* Status toggles */}
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <span className="text-[11px] text-muted-foreground mr-0.5">
        Status:
      </span>
      {STATUSES.map((s) => (
        <ToggleChip
          key={s.value}
          label={s.label}
          active={filters.statuses.has(s.value)}
          color={accentHex}
          onClick={() => dispatchFilter({ type: "TOGGLE_STATUS", status: s.value })}
        />
      ))}

      {/* Label toggles */}
      {allLabels.length > 0 && (
        <>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <span className="text-[11px] text-muted-foreground mr-0.5">
            Label:
          </span>
          {allLabels.map((label) => (
            <ToggleChip
              key={label}
              label={label}
              active={filters.labels.has(label)}
              color={accentHex}
              onClick={() => dispatchFilter({ type: "TOGGLE_LABEL", label })}
            />
          ))}
        </>
      )}

      {/* Agent toggles */}
      {allAgents.length > 0 && (
        <>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <span className="text-[11px] text-muted-foreground mr-0.5">
            Agent:
          </span>
          {allAgents.map((agent) => (
            <ToggleChip
              key={agent}
              label={agent}
              active={filters.agents.has(agent)}
              color={accentHex}
              onClick={() => dispatchFilter({ type: "TOGGLE_AGENT", agent })}
            />
          ))}
        </>
      )}

      {/* Clear all */}
      <Button
        variant="link"
        size="xs"
        hoverEffect="none"
        clickEffect="none"
        onClick={() => dispatchFilter({ type: "CLEAR_ALL" })}
        className={`ml-auto transition-opacity duration-100 ${hasActiveFilters ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        Clear filters
      </Button>
    </div>
  );
}
