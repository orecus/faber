import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppStore } from "../../store/appStore";
import { Card, CardContent } from "../ui/orecus.io/cards/card";
import { getRecents, pushRecent } from "./commandRegistry";
import { useCommands } from "./useCommands";

import type { Command as CommandItem } from "./commandRegistry";

export default function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const close = useAppStore((s) => s.closeCommandPalette);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const onExecuted = useCallback(() => {
    close();
  }, [close]);

  const commands = useCommands(onExecuted);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setSearch("");
      // Small delay so cmdk mounts first
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleSelect = useCallback(
    (commandId: string) => {
      const cmd = commands.find((c) => c.id === commandId);
      if (cmd) {
        pushRecent(cmd.id);
        cmd.onSelect();
      }
    },
    [commands],
  );

  // Build recent commands for empty state
  const recentCommands = useMemo(() => {
    if (search.length > 0) return [];
    const recentIds = getRecents();
    const commandMap = new Map(commands.map((c) => [c.id, c]));
    return recentIds
      .map((id) => commandMap.get(id))
      .filter((c): c is CommandItem => c != null);
  }, [search, commands]);

  // Group commands by their group field
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    const order = ["Navigation", "Projects", "Tasks", "Sessions", "Actions"];
    for (const cmd of commands) {
      let list = map.get(cmd.group);
      if (!list) {
        list = [];
        map.set(cmd.group, list);
      }
      list.push(cmd);
    }
    // Return in defined order
    return order
      .filter((g) => map.has(g))
      .map((g) => ({ group: g, items: map.get(g)! }));
  }, [commands]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex items-start justify-center pt-[18vh] bg-black/60"
      onClick={close}
    >
      <Card
        type="solid"
        border
        radius="lg"
        shadow="lg"
        className="w-full max-w-[520px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent>
          <Command className="flex flex-col" shouldFilter={true} loop>
            {/* Search input */}
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search size={15} className="shrink-0 text-muted-foreground" />
              <Command.Input
                ref={inputRef}
                value={search}
                onValueChange={setSearch}
                placeholder="Type a command or search..."
                className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <kbd className="hidden shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium sm:inline-block bg-popover text-muted-foreground border border-border">
                ESC
              </kbd>
            </div>

            {/* Command list */}
            <Command.List className="max-h-[340px] overflow-y-auto p-1.5">
              <Command.Empty className="py-8 text-center text-xs text-muted-foreground">
                No results found.
              </Command.Empty>

              {/* Recent commands (shown when search is empty) */}
              {recentCommands.length > 0 && (
                <Command.Group
                  heading="Recent"
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider text-muted-foreground"
                >
                  {recentCommands.map((cmd) => (
                    <CommandRow
                      key={`recent:${cmd.id}`}
                      cmd={cmd}
                      onSelect={handleSelect}
                    />
                  ))}
                </Command.Group>
              )}

              {/* All command groups */}
              {grouped.map(({ group, items }) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider text-muted-foreground"
                >
                  {items.map((cmd) => (
                    <CommandRow
                      key={cmd.id}
                      cmd={cmd}
                      onSelect={handleSelect}
                    />
                  ))}
                </Command.Group>
              ))}
            </Command.List>

            {/* Footer hint */}
            <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded px-1 text-2xs font-medium bg-popover border border-border">
                  ↑
                </kbd>
                <kbd className="inline-flex h-4 items-center rounded px-1 text-2xs font-medium bg-popover border border-border">
                  ↓
                </kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded px-1 text-2xs font-medium bg-popover border border-border">
                  ↵
                </kbd>
                select
              </span>
            </div>
          </Command>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Command Row ──

function CommandRow({
  cmd,
  onSelect,
}: {
  cmd: CommandItem;
  onSelect: (id: string) => void;
}) {
  const Icon = cmd.icon;
  return (
    <Command.Item
      value={`${cmd.group} ${cmd.label}`}
      onSelect={() => onSelect(cmd.id)}
      className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-element)] px-2.5 py-2 text-sm text-dim-foreground aria-selected:bg-accent"
    >
      {Icon && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground">
          <Icon size={14} />
        </span>
      )}
      <span className="truncate">{cmd.label}</span>
      {cmd.shortcut && (
        <kbd className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium bg-popover text-muted-foreground border border-border">
          {cmd.shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}
