import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Layers, Search, Tag, Terminal, X } from "lucide-react";
import type { TaskStatus } from "../../types";
import type { FilterState, FilterAction } from "../../hooks/useDashboardFilters";
import { useProjectAccentColor } from "../../hooks/useProjectAccentColor";
import { useAppStore } from "../../store/appStore";
import { DEFAULT_PRIORITIES, getPriorityCssVar } from "../../lib/priorities";
import { Button } from "../ui/orecus.io/components/enhanced-button";
import { gradientHexColors } from "../ui/orecus.io/lib/color-utils";
import { Separator } from "../ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "../ui/command";

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "ready", label: "Ready" },
  { value: "in-progress", label: "In Progress" },
  { value: "in-review", label: "In Review" },
  { value: "done", label: "Done" },
];

interface FilterBarProps {
  filters: FilterState;
  dispatchFilter: (action: FilterAction) => void;
  hasActiveFilters: boolean;
  allLabels: string[];
  allAgents: string[];
  allEpics?: { id: string; title: string }[];
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
      className={`h-6 px-2 text-xs font-semibold rounded-[var(--radius-element)] cursor-pointer transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-accent" : "bg-transparent"}`}
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

// ── Searchable multi-select filter dropdown ──

interface FilterDropdownProps {
  icon: React.ReactNode;
  label: string;
  items: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  placeholder?: string;
}

function FilterDropdown({
  icon,
  label,
  items,
  selected,
  onToggle,
  placeholder,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const count = selected.size;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={`inline-flex items-center gap-1.5 h-6 px-2 text-xs font-medium rounded-[var(--radius-element)] cursor-pointer transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring border ${
          count > 0
            ? "border-primary/60 bg-accent text-foreground"
            : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border/80"
        }`}
      >
        {icon}
        <span>{label}</span>
        {count > 0 && (
          <span className="inline-flex items-center justify-center size-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
            {count}
          </span>
        )}
        <ChevronDown className={`size-3 opacity-50 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-56 p-0"
      >
        <Command>
          <CommandInput placeholder={placeholder ?? `Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No {label.toLowerCase()} found
            </CommandEmpty>
            <CommandGroup>
              {items.map((item) => {
                const isSelected = selected.has(item.value);
                return (
                  <CommandItem
                    key={item.value}
                    value={item.label}
                    onSelect={() => onToggle(item.value)}
                    data-checked={isSelected || undefined}
                    className="gap-2 text-xs"
                  >
                    <div
                      className={`flex items-center justify-center size-3.5 shrink-0 rounded-sm border transition-colors ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {isSelected && <Check className="size-2.5" />}
                    </div>
                    <span className="truncate">{item.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Active filter pills (shown inline, dismissible) ──

function ActiveFilterPill({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-px text-2xs font-medium rounded-full bg-primary/10 text-foreground border border-primary/20">
      <span className="truncate max-w-[100px]">{label}</span>
      <button
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="inline-flex items-center justify-center size-3.5 rounded-full hover:bg-primary/20 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}

export default function FilterBar({
  filters,
  dispatchFilter,
  hasActiveFilters,
  allLabels,
  allAgents,
  allEpics = [],
  searchInputRef,
}: FilterBarProps) {
  const accentColor = useProjectAccentColor();
  const accentHex = gradientHexColors[accentColor]?.start ?? "var(--primary)";
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const priorities = useAppStore((s) =>
    activeProjectId ? (s.projectPriorities[activeProjectId] ?? DEFAULT_PRIORITIES) : DEFAULT_PRIORITIES
  );

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

  // Build dropdown items
  const labelItems = allLabels.map((l) => ({ value: l, label: l }));
  const agentItems = allAgents.map((a) => ({ value: a, label: a }));
  const epicItems = allEpics.map((e) => ({ value: e.id, label: e.title }));

  // Collect active dropdown filters for pill display
  const activePills: { key: string; label: string; onRemove: () => void }[] = [];
  for (const label of filters.labels) {
    activePills.push({
      key: `label:${label}`,
      label,
      onRemove: () => dispatchFilter({ type: "TOGGLE_LABEL", label }),
    });
  }
  for (const agent of filters.agents) {
    activePills.push({
      key: `agent:${agent}`,
      label: agent,
      onRemove: () => dispatchFilter({ type: "TOGGLE_AGENT", agent }),
    });
  }
  for (const epicId of filters.epics) {
    const epic = allEpics.find((e) => e.id === epicId);
    activePills.push({
      key: `epic:${epicId}`,
      label: epic?.title ?? epicId,
      onRemove: () => dispatchFilter({ type: "TOGGLE_EPIC", epicId }),
    });
  }

  const hasDropdownFilters = activePills.length > 0;

  return (
    <div className="flex flex-col gap-1">
      {/* Main filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search input */}
        <div className="relative flex items-center">
          <Search className="absolute left-2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search tasks…"
            className="h-6 w-44 pl-7 pr-6 text-xs rounded-[var(--radius-element)] bg-transparent border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
          />
          {localSearch && (
            <button
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-1.5 text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        {/* Priority toggles — grouped with separator so they wrap together */}
        <div className="flex items-center gap-2 shrink-0">
          <Separator orientation="vertical" className="mx-0.5 self-stretch" />
          <span className="text-xs text-muted-foreground mr-0.5">
            Priority:
          </span>
          {priorities.map((p) => (
            <ToggleChip
              key={p.id}
              label={p.id}
              active={filters.priorities.has(p.id)}
              color={getPriorityCssVar(p.id, priorities)}
              onClick={() => dispatchFilter({ type: "TOGGLE_PRIORITY", priority: p.id })}
            />
          ))}
        </div>

        {/* Status toggles — grouped with separator */}
        <div className="flex items-center gap-2 shrink-0">
          <Separator orientation="vertical" className="mx-0.5 self-stretch" />
          <span className="text-xs text-muted-foreground mr-0.5">
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
        </div>

        {/* Dropdown filters — grouped with separator */}
        {(allLabels.length > 0 || allAgents.length > 0 || allEpics.length > 0) && (
          <div className="flex items-center gap-2 shrink-0">
            <Separator orientation="vertical" className="mx-0.5 self-stretch" />

            {allLabels.length > 0 && (
              <FilterDropdown
                icon={<Tag className="size-3" />}
                label="Labels"
                items={labelItems}
                selected={filters.labels}
                onToggle={(label) => dispatchFilter({ type: "TOGGLE_LABEL", label })}
                placeholder="Search labels…"
              />
            )}

            {allAgents.length > 0 && (
              <FilterDropdown
                icon={<Terminal className="size-3" />}
                label="Agents"
                items={agentItems}
                selected={filters.agents}
                onToggle={(agent) => dispatchFilter({ type: "TOGGLE_AGENT", agent })}
                placeholder="Search agents…"
              />
            )}

            {allEpics.length > 0 && (
              <FilterDropdown
                icon={<Layers className="size-3" />}
                label="Epics"
                items={epicItems}
                selected={filters.epics}
                onToggle={(epicId) => dispatchFilter({ type: "TOGGLE_EPIC", epicId })}
                placeholder="Search epics…"
              />
            )}
          </div>
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

      {/* Active dropdown filter pills — shown below main row when any are active */}
      {hasDropdownFilters && (
        <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
          <span className="text-2xs text-muted-foreground">Active:</span>
          {activePills.map((pill) => (
            <ActiveFilterPill
              key={pill.key}
              label={pill.label}
              onRemove={pill.onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
