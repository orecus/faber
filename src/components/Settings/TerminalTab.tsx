import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  usePersistedNumber,
  usePersistedString,
} from "../../hooks/usePersistedState";
import { useAppStore } from "../../store/appStore";
import { Badge } from "../ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { sectionHeadingClass } from "./shared";

// ── Font types (mirrors Rust AvailableFont) ──

interface AvailableFont {
  family: string;
  is_nerd_font: boolean;
  is_monospace: boolean;
}

interface FontEntry {
  name: string;
  /** CSS font-family value (with fallbacks) */
  family: string;
  category: "embedded" | "nerd" | "system";
}

const EMBEDDED_FONT = "JetBrains Mono";

/** Convert backend AvailableFont list into categorized FontEntry list */
function buildFontList(detected: AvailableFont[]): FontEntry[] {
  const entries: FontEntry[] = [
    // Embedded font is always available
    { name: EMBEDDED_FONT, family: `'${EMBEDDED_FONT}', monospace`, category: "embedded" },
  ];

  for (const font of detected) {
    // Skip the embedded font (already added)
    if (font.family === EMBEDDED_FONT) continue;

    const category: FontEntry["category"] = font.is_nerd_font ? "nerd" : "system";
    entries.push({
      name: font.family,
      family: `'${font.family}', monospace`,
      category,
    });
  }

  return entries;
}

const CATEGORY_LABELS: Record<string, string> = {
  embedded: "Embedded",
  nerd: "Nerd Fonts",
  system: "System Fonts",
};

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200];

const DEFAULTS = {
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontSize: 14,
  lineHeight: 1.0,
  zoom: 100,
};

// ── Slider ──

function SettingsSlider({
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 h-8 flex items-center">
        {/* Track */}
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-muted" />
        {/* Filled track */}
        <div
          className="absolute left-0 h-1.5 rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
        {/* Thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-x-0 w-full h-8 opacity-0 cursor-pointer z-10"
        />
        <div
          className="absolute size-4 rounded-full bg-primary border-2 border-background shadow-sm pointer-events-none"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
      <span className="text-[13px] font-medium text-foreground tabular-nums min-w-[3.5rem] text-right">
        {formatValue ? formatValue(value) : value}
      </span>
    </div>
  );
}

// ── Terminal Tab ──

export function TerminalTab() {
  const shells = useAppStore((s) => s.shells);

  const [terminalShell, setTerminalShell] = usePersistedString("terminal_shell", "");
  const [fontFamily, setFontFamily] = usePersistedString("terminal_font_family", DEFAULTS.fontFamily);
  const [fontSize, setFontSize] = usePersistedNumber("terminal_font_size", DEFAULTS.fontSize);
  const [lineHeight, setLineHeight] = usePersistedNumber("terminal_line_height", DEFAULTS.lineHeight);
  const [zoom, setZoom] = usePersistedNumber("terminal_zoom", DEFAULTS.zoom);

  const [fontFilter, setFontFilter] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Detect which fonts are actually installed via the Rust backend
  const [fontList, setFontList] = useState<FontEntry[]>([
    { name: EMBEDDED_FONT, family: `'${EMBEDDED_FONT}', monospace`, category: "embedded" },
  ]);
  const [fontsLoading, setFontsLoading] = useState(true);

  const loadFonts = useCallback(async () => {
    setFontsLoading(true);
    try {
      const detected = await invoke<AvailableFont[]>("get_available_fonts");
      setFontList(buildFontList(detected));
    } catch {
      // Keep the embedded font as fallback
    } finally {
      setFontsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFonts();
  }, [loadFonts]);

  const shellOptions = [
    { value: "__default__", label: "System Default" },
    ...shells.map((s) => ({ value: s.path, label: `${s.name} (${s.path})` })),
  ];
  const currentShellValue = terminalShell || "__default__";

  // Resolve the currently selected font entry (if any)
  const selectedFont = useMemo(
    () => fontList.find((f) => fontFamily.includes(f.name)),
    [fontFamily, fontList],
  );

  // Filter font list by search
  const filteredFonts = useMemo(() => {
    if (!fontFilter) return fontList;
    const q = fontFilter.toLowerCase();
    return fontList.filter((f) => f.name.toLowerCase().includes(q));
  }, [fontFilter, fontList]);

  // Group by category
  const groupedFonts = useMemo(() => {
    const groups: Record<string, FontEntry[]> = {};
    for (const f of filteredFonts) {
      (groups[f.category] ??= []).push(f);
    }
    return groups;
  }, [filteredFonts]);

  const handleSelectFont = useCallback(
    (font: FontEntry) => {
      setFontFamily(font.family);
    },
    [setFontFamily],
  );

  const handleResetDefaults = useCallback(() => {
    setFontFamily(DEFAULTS.fontFamily);
    setFontSize(DEFAULTS.fontSize);
    setLineHeight(DEFAULTS.lineHeight);
    setZoom(DEFAULTS.zoom);
  }, [setFontFamily, setFontSize, setLineHeight, setZoom]);

  const isDefault =
    fontFamily === DEFAULTS.fontFamily &&
    fontSize === DEFAULTS.fontSize &&
    lineHeight === DEFAULTS.lineHeight &&
    zoom === DEFAULTS.zoom;

  return (
    <div className="flex flex-col gap-6">
      {/* Default Shell */}
      <section>
        <div className={sectionHeadingClass}>Default Shell</div>
        <Select
          value={currentShellValue}
          onValueChange={(val) =>
            setTerminalShell(!val || val === "__default__" ? "" : val)
          }
          items={shellOptions}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="System Default" />
          </SelectTrigger>
          <SelectContent>
            {shellOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-[11px] text-muted-foreground mt-1.5">
          Takes effect on new sessions. Existing sessions keep their current shell.
        </div>
      </section>

      {/* Font Family */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <div className={`${sectionHeadingClass} !mb-0`}>Font Family</div>
          <button
            onClick={loadFonts}
            disabled={fontsLoading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer transition-colors"
            title="Refresh font list"
          >
            {fontsLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
          </button>
        </div>
        <div className="rounded-[var(--radius-container)] border border-border overflow-hidden">
          {/* Search / filter */}
          <div className="border-b border-border px-3 py-2">
            <input
              type="text"
              value={fontFilter}
              onChange={(e) => setFontFilter(e.target.value)}
              placeholder="Search fonts..."
              className="w-full bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>

          {/* Scrollable font list */}
          <div ref={listRef} className="max-h-[180px] overflow-y-auto">
            {Object.entries(groupedFonts).map(([category, fonts]) => (
              <div key={category}>
                {/* Category header */}
                <div className="sticky top-0 z-10 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide bg-muted/80 backdrop-blur-sm border-b border-border/50">
                  {CATEGORY_LABELS[category] ?? category}
                </div>
                {fonts.map((font) => {
                  const isActive = selectedFont?.name === font.name;
                  return (
                    <button
                      key={font.name}
                      onClick={() => handleSelectFont(font)}
                      className={`w-full text-left px-3 py-1.5 text-[13px] cursor-pointer transition-colors duration-100 ${
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground hover:bg-accent"
                      }`}
                      style={{ fontFamily: font.family }}
                    >
                      {font.name}
                    </button>
                  );
                })}
              </div>
            ))}
            {filteredFonts.length === 0 && (
              <div className="px-3 py-4 text-[13px] text-muted-foreground text-center">
                No matching fonts
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="border-t border-border px-4 py-3">
            <div
              className="text-[15px] text-foreground leading-relaxed"
              style={{ fontFamily: fontFamily }}
            >
              The quick brown fox jumps over the lazy dog
            </div>
            <div
              className="text-[13px] text-muted-foreground mt-0.5"
              style={{ fontFamily: fontFamily }}
            >
              0123456789 !@#$%^&*()
            </div>
            {selectedFont && (
              <Badge
                variant="outline"
                className="mt-2 text-[10px] font-normal text-primary border-primary/30"
              >
                {CATEGORY_LABELS[selectedFont.category]}
              </Badge>
            )}
          </div>
        </div>
      </section>

      {/* Font Size */}
      <section>
        <div className={sectionHeadingClass}>Font Size</div>
        <SettingsSlider
          value={fontSize}
          min={8}
          max={32}
          step={1}
          onChange={setFontSize}
          formatValue={(v) => `${v}px`}
        />
      </section>

      {/* Zoom Level */}
      <section>
        <div className={sectionHeadingClass}>Zoom Level</div>
        <div className="flex gap-1.5">
          {ZOOM_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => setZoom(level)}
              className={`flex-1 py-1.5 text-[12px] font-medium rounded-[var(--radius-element)] cursor-pointer transition-colors duration-100 ${
                zoom === level
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {level}%
            </button>
          ))}
        </div>
      </section>

      {/* Line Height */}
      <section>
        <div className={sectionHeadingClass}>Line Height</div>
        <SettingsSlider
          value={lineHeight}
          min={1.0}
          max={2.0}
          step={0.1}
          onChange={setLineHeight}
          formatValue={(v) => v.toFixed(1)}
        />
      </section>

      {/* Reset */}
      <button
        onClick={handleResetDefaults}
        disabled={isDefault}
        className="flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors duration-100 py-2"
      >
        <RefreshCw className="size-3" />
        Reset to Defaults
      </button>
    </div>
  );
}
