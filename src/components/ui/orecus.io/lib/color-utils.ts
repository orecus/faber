export type ThemeColor =
  | "primary"
  | "secondary"
  | "green"
  | "amber"
  | "red"
  | "blue"
  | "purple"
  | "pink"
  | "cyan"
  | "teal"
  | "orange"
  | "indigo"
  | "emerald"
  | "violet"
  | "rose"
  | "slate"
  // Extended colors
  | "lime"
  | "yellow"
  | "fuchsia"
  | "sky"
  // Gray neutrals
  | "gray"
  | "zinc"
  | "neutral"
  | "stone";

// ============================================================================
// Hover Effect Type
// ============================================================================

/**
 * Unified hover effect options for all card components.
 * Controls the primary transform/motion when users hover over cards.
 * 
 * For glow enhancement, use the separate `hoverGlow` boolean prop.
 * For ring/shadow, use the separate `hoverBorder` boolean prop.
 */
export type HoverEffect =
  | "none"   // No hover effect
  | "lift"   // Subtle lift (-translate-y) with shadow
  | "scale"  // Scale up (zoom)
  | "tilt";  // 3D tilt effect following mouse

// ============================================================================
// Color Style Interfaces
// ============================================================================

/**
 * Core color styles for gradient backgrounds, glow effects, borders, and text.
 * Used by components like Button, PillTabs for their active/gradient states.
 */
export interface ColorStyles {
  /** Gradient classes for bg-linear-to-r (e.g., "from-primary/80 to-primary") */
  gradient: string;
  /** Shadow color class (e.g., "shadow-primary/30") */
  glow: string;
  /** Hover shadow color class (e.g., "hover:shadow-primary/30") */
  hoverGlow: string;
  /** Border color class (e.g., "border-primary/50") */
  border: string;
  /** Text color class (e.g., "text-white") */
  text: string;
}

/**
 * Icon container styles with background, border, and text colors.
 * Used by components like EnhancedEmptyState for floating icons.
 */
export interface IconContainerStyles {
  /** Background color (e.g., "bg-blue-500/10") */
  bg: string;
  /** Border color (e.g., "border-blue-500/20") */
  border: string;
  /** Text/icon color (e.g., "text-blue-500") */
  text: string;
}

/**
 * Hex color pair for SVG gradients.
 * Used by components like StatRing for SVG linearGradient definitions.
 */
export interface GradientHexColors {
  /** Start color (e.g., "#3b82f6") */
  start: string;
  /** End color (e.g., "#60a5fa") */
  end: string;
}

// ============================================================================
// Core Color Style Mappings
// ============================================================================

/**
 * Core color styles for each theme color.
 * Used by enhanced-button, pill-tabs, and other gradient/glow components.
 */
export const colorStyles: Record<ThemeColor, ColorStyles> = {
  primary: {
    gradient: "from-primary/80 to-primary",
    glow: "shadow-primary/30",
    hoverGlow: "hover:shadow-primary/30",
    border: "border-primary/50",
    text: "text-primary-foreground dark:text-primary-foreground hover:text-primary-foreground",
  },
  secondary: {
    gradient: "from-secondary/80 to-secondary",
    glow: "shadow-secondary/30",
    hoverGlow: "hover:shadow-secondary/30",
    border: "border-secondary/50",
    text: "text-secondary-foreground dark:text-white hover:text-secondary-foreground",
  },
  green: {
    gradient: "from-green-500/80 to-green-400",
    glow: "shadow-green-500/30",
    hoverGlow: "hover:shadow-green-500/30",
    border: "border-green-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  amber: {
    gradient: "from-amber-500/80 to-amber-400",
    glow: "shadow-amber-500/30",
    hoverGlow: "hover:shadow-amber-500/30",
    border: "border-amber-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  red: {
    gradient: "from-red-500/80 to-red-400",
    glow: "shadow-red-500/30",
    hoverGlow: "hover:shadow-red-500/30",
    border: "border-red-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  blue: {
    gradient: "from-blue-500/80 to-blue-400",
    glow: "shadow-blue-500/30",
    hoverGlow: "hover:shadow-blue-500/30",
    border: "border-blue-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  purple: {
    gradient: "from-purple-500/80 to-purple-400",
    glow: "shadow-purple-500/30",
    hoverGlow: "hover:shadow-purple-500/30",
    border: "border-purple-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  pink: {
    gradient: "from-pink-500/80 to-pink-400",
    glow: "shadow-pink-500/30",
    hoverGlow: "hover:shadow-pink-500/30",
    border: "border-pink-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  cyan: {
    gradient: "from-cyan-500/80 to-cyan-400",
    glow: "shadow-cyan-500/30",
    hoverGlow: "hover:shadow-cyan-500/30",
    border: "border-cyan-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  teal: {
    gradient: "from-teal-500/80 to-teal-400",
    glow: "shadow-teal-500/30",
    hoverGlow: "hover:shadow-teal-500/30",
    border: "border-teal-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  orange: {
    gradient: "from-orange-500/80 to-orange-400",
    glow: "shadow-orange-500/30",
    hoverGlow: "hover:shadow-orange-500/30",
    border: "border-orange-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  indigo: {
    gradient: "from-indigo-500/80 to-indigo-400",
    glow: "shadow-indigo-500/30",
    hoverGlow: "hover:shadow-indigo-500/30",
    border: "border-indigo-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  emerald: {
    gradient: "from-emerald-500/80 to-emerald-400",
    glow: "shadow-emerald-500/30",
    hoverGlow: "hover:shadow-emerald-500/30",
    border: "border-emerald-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  violet: {
    gradient: "from-violet-500/80 to-violet-400",
    glow: "shadow-violet-500/30",
    hoverGlow: "hover:shadow-violet-500/30",
    border: "border-violet-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  rose: {
    gradient: "from-rose-500/80 to-rose-400",
    glow: "shadow-rose-500/30",
    hoverGlow: "hover:shadow-rose-500/30",
    border: "border-rose-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  slate: {
    gradient: "from-slate-500/80 to-slate-400",
    glow: "shadow-slate-500/30",
    hoverGlow: "hover:shadow-slate-500/30",
    border: "border-slate-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  // Extended colors
  lime: {
    gradient: "from-lime-500/80 to-lime-400",
    glow: "shadow-lime-500/30",
    hoverGlow: "hover:shadow-lime-500/30",
    border: "border-lime-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  yellow: {
    gradient: "from-yellow-500/80 to-yellow-400",
    glow: "shadow-yellow-500/30",
    hoverGlow: "hover:shadow-yellow-500/30",
    border: "border-yellow-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  fuchsia: {
    gradient: "from-fuchsia-500/80 to-fuchsia-400",
    glow: "shadow-fuchsia-500/30",
    hoverGlow: "hover:shadow-fuchsia-500/30",
    border: "border-fuchsia-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  sky: {
    gradient: "from-sky-500/80 to-sky-400",
    glow: "shadow-sky-500/30",
    hoverGlow: "hover:shadow-sky-500/30",
    border: "border-sky-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  // Gray neutrals
  gray: {
    gradient: "from-gray-500/80 to-gray-400",
    glow: "shadow-gray-500/30",
    hoverGlow: "hover:shadow-gray-500/30",
    border: "border-gray-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  zinc: {
    gradient: "from-zinc-500/80 to-zinc-400",
    glow: "shadow-zinc-500/30",
    hoverGlow: "hover:shadow-zinc-500/30",
    border: "border-zinc-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  neutral: {
    gradient: "from-neutral-500/80 to-neutral-400",
    glow: "shadow-neutral-500/30",
    hoverGlow: "hover:shadow-neutral-500/30",
    border: "border-neutral-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
  stone: {
    gradient: "from-stone-500/80 to-stone-400",
    glow: "shadow-stone-500/30",
    hoverGlow: "hover:shadow-stone-500/30",
    border: "border-stone-500/50",
    text: "text-white dark:text-white hover:text-white",
  },
};

// ============================================================================
// Simple Text/Background/Stroke Color Mappings
// ============================================================================

/**
 * Simple text color classes for each theme color.
 * Used for stat values, metric icons, and other text elements.
 */
export const textColors: Record<ThemeColor, string> = {
  primary: "text-primary",
  secondary: "text-secondary",
  green: "text-green-500",
  amber: "text-amber-500",
  red: "text-red-500",
  blue: "text-blue-500",
  purple: "text-purple-500",
  pink: "text-pink-500",
  cyan: "text-cyan-500",
  teal: "text-teal-500",
  orange: "text-orange-500",
  indigo: "text-indigo-500",
  emerald: "text-emerald-500",
  violet: "text-violet-500",
  rose: "text-rose-500",
  slate: "text-slate-500",
  lime: "text-lime-500",
  yellow: "text-yellow-500",
  fuchsia: "text-fuchsia-500",
  sky: "text-sky-500",
  gray: "text-gray-500",
  zinc: "text-zinc-500",
  neutral: "text-neutral-500",
  stone: "text-stone-500",
};

/**
 * Simple background color classes for each theme color.
 * Used for markers, badges, and solid fills.
 */
export const bgColors: Record<ThemeColor, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
  cyan: "bg-cyan-500",
  teal: "bg-teal-500",
  orange: "bg-orange-500",
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  slate: "bg-slate-500",
  lime: "bg-lime-500",
  yellow: "bg-yellow-500",
  fuchsia: "bg-fuchsia-500",
  sky: "bg-sky-500",
  gray: "bg-gray-500",
  zinc: "bg-zinc-500",
  neutral: "bg-neutral-500",
  stone: "bg-stone-500",
};

/**
 * Solid (flat) gradient stops for use with bg-linear-to-r.
 * Uses identical from/to stops to produce a flat color as background-image,
 * which layers above background-color (useful for overriding hover states).
 * Used by enhanced-button "color" variant and tabs "color" indicator.
 */
export const solidColorGradients: Record<ThemeColor, string> = {
  primary: "from-primary to-primary",
  secondary: "from-secondary to-secondary",
  green: "from-green-500 to-green-500",
  amber: "from-amber-500 to-amber-500",
  red: "from-red-500 to-red-500",
  blue: "from-blue-500 to-blue-500",
  purple: "from-purple-500 to-purple-500",
  pink: "from-pink-500 to-pink-500",
  cyan: "from-cyan-500 to-cyan-500",
  teal: "from-teal-500 to-teal-500",
  orange: "from-orange-500 to-orange-500",
  indigo: "from-indigo-500 to-indigo-500",
  emerald: "from-emerald-500 to-emerald-500",
  violet: "from-violet-500 to-violet-500",
  rose: "from-rose-500 to-rose-500",
  slate: "from-slate-500 to-slate-500",
  lime: "from-lime-500 to-lime-500",
  yellow: "from-yellow-500 to-yellow-500",
  fuchsia: "from-fuchsia-500 to-fuchsia-500",
  sky: "from-sky-500 to-sky-500",
  gray: "from-gray-500 to-gray-500",
  zinc: "from-zinc-500 to-zinc-500",
  neutral: "from-neutral-500 to-neutral-500",
  stone: "from-stone-500 to-stone-500",
};

/**
 * SVG stroke color classes for each theme color.
 * Used for progress rings, charts, and SVG elements.
 */
export const strokeColors: Record<ThemeColor, string> = {
  primary: "stroke-primary",
  secondary: "stroke-secondary",
  green: "stroke-green-500",
  amber: "stroke-amber-500",
  red: "stroke-red-500",
  blue: "stroke-blue-500",
  purple: "stroke-purple-500",
  pink: "stroke-pink-500",
  cyan: "stroke-cyan-500",
  teal: "stroke-teal-500",
  orange: "stroke-orange-500",
  indigo: "stroke-indigo-500",
  emerald: "stroke-emerald-500",
  violet: "stroke-violet-500",
  rose: "stroke-rose-500",
  slate: "stroke-slate-500",
  lime: "stroke-lime-500",
  yellow: "stroke-yellow-500",
  fuchsia: "stroke-fuchsia-500",
  sky: "stroke-sky-500",
  gray: "stroke-gray-500",
  zinc: "stroke-zinc-500",
  neutral: "stroke-neutral-500",
  stone: "stroke-stone-500",
};

/**
 * SVG stroke color with opacity for track backgrounds.
 * Used for ring chart backgrounds, progress tracks.
 */
export const strokeBgColors: Record<ThemeColor, string> = {
  primary: "stroke-primary/20",
  secondary: "stroke-secondary/20",
  green: "stroke-green-500/20",
  amber: "stroke-amber-500/20",
  red: "stroke-red-500/20",
  blue: "stroke-blue-500/20",
  purple: "stroke-purple-500/20",
  pink: "stroke-pink-500/20",
  cyan: "stroke-cyan-500/20",
  teal: "stroke-teal-500/20",
  orange: "stroke-orange-500/20",
  indigo: "stroke-indigo-500/20",
  emerald: "stroke-emerald-500/20",
  violet: "stroke-violet-500/20",
  rose: "stroke-rose-500/20",
  slate: "stroke-slate-500/20",
  lime: "stroke-lime-500/20",
  yellow: "stroke-yellow-500/20",
  fuchsia: "stroke-fuchsia-500/20",
  sky: "stroke-sky-500/20",
  gray: "stroke-gray-500/20",
  zinc: "stroke-zinc-500/20",
  neutral: "stroke-neutral-500/20",
  stone: "stroke-stone-500/20",
};

/**
 * SVG fill color with opacity for area fills.
 * Used for sparklines, area charts, and subtle fills.
 */
export const fillColors: Record<ThemeColor, string> = {
  primary: "fill-primary/10",
  secondary: "fill-secondary/10",
  green: "fill-green-500/10",
  amber: "fill-amber-500/10",
  red: "fill-red-500/10",
  blue: "fill-blue-500/10",
  purple: "fill-purple-500/10",
  pink: "fill-pink-500/10",
  cyan: "fill-cyan-500/10",
  teal: "fill-teal-500/10",
  orange: "fill-orange-500/10",
  indigo: "fill-indigo-500/10",
  emerald: "fill-emerald-500/10",
  violet: "fill-violet-500/10",
  rose: "fill-rose-500/10",
  slate: "fill-slate-500/10",
  lime: "fill-lime-500/10",
  yellow: "fill-yellow-500/10",
  fuchsia: "fill-fuchsia-500/10",
  sky: "fill-sky-500/10",
  gray: "fill-gray-500/10",
  zinc: "fill-zinc-500/10",
  neutral: "fill-neutral-500/10",
  stone: "fill-stone-500/10",
};

/**
 * Ring color classes for focus/selection indicators.
 * Used for focused panes, drop targets, and selection rings.
 */
export const ringColors: Record<ThemeColor, string> = {
  primary: "ring-primary",
  secondary: "ring-secondary",
  green: "ring-green-500",
  amber: "ring-amber-500",
  red: "ring-red-500",
  blue: "ring-blue-500",
  purple: "ring-purple-500",
  pink: "ring-pink-500",
  cyan: "ring-cyan-500",
  teal: "ring-teal-500",
  orange: "ring-orange-500",
  indigo: "ring-indigo-500",
  emerald: "ring-emerald-500",
  violet: "ring-violet-500",
  rose: "ring-rose-500",
  slate: "ring-slate-500",
  lime: "ring-lime-500",
  yellow: "ring-yellow-500",
  fuchsia: "ring-fuchsia-500",
  sky: "ring-sky-500",
  gray: "ring-gray-500",
  zinc: "ring-zinc-500",
  neutral: "ring-neutral-500",
  stone: "ring-stone-500",
};

/**
 * Border accent color classes for selection indicators.
 * Used for selected agent cards, drag overlays, etc.
 */
export const borderAccentColors: Record<ThemeColor, string> = {
  primary: "border-primary",
  secondary: "border-secondary",
  green: "border-green-500",
  amber: "border-amber-500",
  red: "border-red-500",
  blue: "border-blue-500",
  purple: "border-purple-500",
  pink: "border-pink-500",
  cyan: "border-cyan-500",
  teal: "border-teal-500",
  orange: "border-orange-500",
  indigo: "border-indigo-500",
  emerald: "border-emerald-500",
  violet: "border-violet-500",
  rose: "border-rose-500",
  slate: "border-slate-500",
  lime: "border-lime-500",
  yellow: "border-yellow-500",
  fuchsia: "border-fuchsia-500",
  sky: "border-sky-500",
  gray: "border-gray-500",
  zinc: "border-zinc-500",
  neutral: "border-neutral-500",
  stone: "border-stone-500",
};

// ============================================================================
// Component-Specific Color Mappings
// ============================================================================

/**
 * Icon container styles with subtle background, border, and text.
 * Used for floating icons in empty states, feature lists, etc.
 */
export const iconContainerColors: Record<ThemeColor, IconContainerStyles> = {
  primary: { bg: "bg-primary/10", border: "border-primary/20", text: "text-primary" },
  secondary: { bg: "bg-secondary/10", border: "border-secondary/20", text: "text-secondary" },
  green: { bg: "bg-green-500/10", border: "border-green-500/20", text: "text-green-500" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-500" },
  red: { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-500" },
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-500" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/20", text: "text-purple-500" },
  pink: { bg: "bg-pink-500/10", border: "border-pink-500/20", text: "text-pink-500" },
  cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-500" },
  teal: { bg: "bg-teal-500/10", border: "border-teal-500/20", text: "text-teal-500" },
  orange: { bg: "bg-orange-500/10", border: "border-orange-500/20", text: "text-orange-500" },
  indigo: { bg: "bg-indigo-500/10", border: "border-indigo-500/20", text: "text-indigo-500" },
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-500" },
  violet: { bg: "bg-violet-500/10", border: "border-violet-500/20", text: "text-violet-500" },
  rose: { bg: "bg-rose-500/10", border: "border-rose-500/20", text: "text-rose-500" },
  slate: { bg: "bg-slate-500/10", border: "border-slate-500/20", text: "text-slate-500" },
  lime: { bg: "bg-lime-500/10", border: "border-lime-500/20", text: "text-lime-500" },
  yellow: { bg: "bg-yellow-500/10", border: "border-yellow-500/20", text: "text-yellow-500" },
  fuchsia: { bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/20", text: "text-fuchsia-500" },
  sky: { bg: "bg-sky-500/10", border: "border-sky-500/20", text: "text-sky-500" },
  gray: { bg: "bg-gray-500/10", border: "border-gray-500/20", text: "text-gray-500" },
  zinc: { bg: "bg-zinc-500/10", border: "border-zinc-500/20", text: "text-zinc-500" },
  neutral: { bg: "bg-neutral-500/10", border: "border-neutral-500/20", text: "text-neutral-500" },
  stone: { bg: "bg-stone-500/10", border: "border-stone-500/20", text: "text-stone-500" },
};

/**
 * Accent bar gradient color classes (via-* for bg-gradient).
 * Used by Card component for top/bottom accent bars.
 */
export const accentBarStyles: Record<ThemeColor, string> = {
  primary: "via-primary",
  secondary: "via-secondary",
  green: "via-green-500",
  amber: "via-amber-500",
  red: "via-red-500",
  blue: "via-blue-500",
  purple: "via-purple-500",
  pink: "via-pink-500",
  cyan: "via-cyan-500",
  teal: "via-teal-500",
  orange: "via-orange-500",
  indigo: "via-indigo-500",
  emerald: "via-emerald-500",
  violet: "via-violet-500",
  rose: "via-rose-500",
  slate: "via-slate-500",
  lime: "via-lime-500",
  yellow: "via-yellow-500",
  fuchsia: "via-fuchsia-500",
  sky: "via-sky-500",
  gray: "via-gray-500",
  zinc: "via-zinc-500",
  neutral: "via-neutral-500",
  stone: "via-stone-500",
};

/**
 * Hover ring color classes for group-hover state.
 * Used by Card component for animated ring on hover.
 * Uses ring (box-shadow) instead of border to avoid stacking with glass borders.
 * Includes shadow-lg for base shadow size.
 */
export const hoverBorderStyles: Record<ThemeColor, string> = {
  primary: "group-hover:ring-primary/40 group-hover:shadow-lg group-hover:shadow-primary/10",
  secondary: "group-hover:ring-secondary/40 group-hover:shadow-lg group-hover:shadow-secondary/10",
  green: "group-hover:ring-green-500/40 group-hover:shadow-lg group-hover:shadow-green-500/10",
  amber: "group-hover:ring-amber-500/40 group-hover:shadow-lg group-hover:shadow-amber-500/10",
  red: "group-hover:ring-red-500/40 group-hover:shadow-lg group-hover:shadow-red-500/10",
  blue: "group-hover:ring-blue-500/40 group-hover:shadow-lg group-hover:shadow-blue-500/10",
  purple: "group-hover:ring-purple-500/40 group-hover:shadow-lg group-hover:shadow-purple-500/10",
  pink: "group-hover:ring-pink-500/40 group-hover:shadow-lg group-hover:shadow-pink-500/10",
  cyan: "group-hover:ring-cyan-500/40 group-hover:shadow-lg group-hover:shadow-cyan-500/10",
  teal: "group-hover:ring-teal-500/40 group-hover:shadow-lg group-hover:shadow-teal-500/10",
  orange: "group-hover:ring-orange-500/40 group-hover:shadow-lg group-hover:shadow-orange-500/10",
  indigo: "group-hover:ring-indigo-500/40 group-hover:shadow-lg group-hover:shadow-indigo-500/10",
  emerald: "group-hover:ring-emerald-500/40 group-hover:shadow-lg group-hover:shadow-emerald-500/10",
  violet: "group-hover:ring-violet-500/40 group-hover:shadow-lg group-hover:shadow-violet-500/10",
  rose: "group-hover:ring-rose-500/40 group-hover:shadow-lg group-hover:shadow-rose-500/10",
  slate: "group-hover:ring-slate-500/40 group-hover:shadow-lg group-hover:shadow-slate-500/10",
  lime: "group-hover:ring-lime-500/40 group-hover:shadow-lg group-hover:shadow-lime-500/10",
  yellow: "group-hover:ring-yellow-500/40 group-hover:shadow-lg group-hover:shadow-yellow-500/10",
  fuchsia: "group-hover:ring-fuchsia-500/40 group-hover:shadow-lg group-hover:shadow-fuchsia-500/10",
  sky: "group-hover:ring-sky-500/40 group-hover:shadow-lg group-hover:shadow-sky-500/10",
  gray: "group-hover:ring-gray-500/40 group-hover:shadow-lg group-hover:shadow-gray-500/10",
  zinc: "group-hover:ring-zinc-500/40 group-hover:shadow-lg group-hover:shadow-zinc-500/10",
  neutral: "group-hover:ring-neutral-500/40 group-hover:shadow-lg group-hover:shadow-neutral-500/10",
  stone: "group-hover:ring-stone-500/40 group-hover:shadow-lg group-hover:shadow-stone-500/10",
};

/**
 * Solid gradient styles for accent bars (full left-to-right gradient).
 * Used by Card component with accentBarVariant="solid".
 */
export const solidGradientStyles: Record<ThemeColor, string> = {
  primary: "from-primary/80 to-primary",
  secondary: "from-secondary/80 to-secondary",
  green: "from-green-400/80 to-teal-400",
  amber: "from-amber-400/80 to-orange-400",
  red: "from-red-400/80 to-rose-400",
  blue: "from-blue-400/80 to-cyan-400",
  purple: "from-purple-400/80 to-violet-400",
  pink: "from-pink-400/80 to-rose-400",
  cyan: "from-cyan-400/80 to-teal-400",
  teal: "from-teal-400/80 to-emerald-400",
  orange: "from-orange-400/80 to-amber-400",
  indigo: "from-indigo-400/80 to-blue-400",
  emerald: "from-emerald-400/80 to-green-400",
  violet: "from-violet-400/80 to-purple-400",
  rose: "from-rose-400/80 to-pink-400",
  slate: "from-slate-400/80 to-gray-400",
  lime: "from-lime-400/80 to-green-400",
  yellow: "from-yellow-400/80 to-amber-400",
  fuchsia: "from-fuchsia-400/80 to-pink-400",
  sky: "from-sky-400/80 to-blue-400",
  gray: "from-gray-400/80 to-slate-400",
  zinc: "from-zinc-400/80 to-gray-400",
  neutral: "from-neutral-400/80 to-stone-400",
  stone: "from-stone-400/80 to-neutral-400",
};

/**
 * Hover glow gradient classes for the glow effect.
 * Used by Card component for gradient background glow on hover.
 */
export const hoverGlowGradients: Record<ThemeColor, string> = {
  primary: "from-primary/30 via-purple-500/30 to-blue-500/30",
  secondary: "from-secondary/30 via-slate-500/30 to-gray-500/30",
  green: "from-green-500/30 via-emerald-500/30 to-teal-500/30",
  amber: "from-amber-500/30 via-orange-500/30 to-red-500/30",
  red: "from-red-500/30 via-rose-500/30 to-pink-500/30",
  blue: "from-blue-500/30 via-cyan-500/30 to-teal-500/30",
  purple: "from-purple-500/30 via-violet-500/30 to-indigo-500/30",
  pink: "from-pink-500/30 via-rose-500/30 to-red-500/30",
  cyan: "from-cyan-500/30 via-teal-500/30 to-blue-500/30",
  teal: "from-teal-500/30 via-emerald-500/30 to-green-500/30",
  orange: "from-orange-500/30 via-amber-500/30 to-yellow-500/30",
  indigo: "from-indigo-500/30 via-purple-500/30 to-violet-500/30",
  emerald: "from-emerald-500/30 via-green-500/30 to-teal-500/30",
  violet: "from-violet-500/30 via-purple-500/30 to-fuchsia-500/30",
  rose: "from-rose-500/30 via-pink-500/30 to-red-500/30",
  slate: "from-slate-500/30 via-gray-500/30 to-zinc-500/30",
  lime: "from-lime-500/30 via-green-500/30 to-emerald-500/30",
  yellow: "from-yellow-500/30 via-amber-500/30 to-orange-500/30",
  fuchsia: "from-fuchsia-500/30 via-pink-500/30 to-purple-500/30",
  sky: "from-sky-500/30 via-blue-500/30 to-cyan-500/30",
  gray: "from-gray-500/30 via-slate-500/30 to-zinc-500/30",
  zinc: "from-zinc-500/30 via-gray-500/30 to-slate-500/30",
  neutral: "from-neutral-500/30 via-stone-500/30 to-gray-500/30",
  stone: "from-stone-500/30 via-neutral-500/30 to-zinc-500/30",
};

/**
 * Hover shadow color classes for lift effect.
 * Used by Card components for the subtle shadow glow on hover.
 */
export const hoverShadowStyles: Record<ThemeColor, string> = {
  primary: "hover:shadow-primary/10",
  secondary: "hover:shadow-secondary/10",
  green: "hover:shadow-green-500/10",
  amber: "hover:shadow-amber-500/10",
  red: "hover:shadow-red-500/10",
  blue: "hover:shadow-blue-500/10",
  purple: "hover:shadow-purple-500/10",
  pink: "hover:shadow-pink-500/10",
  cyan: "hover:shadow-cyan-500/10",
  teal: "hover:shadow-teal-500/10",
  orange: "hover:shadow-orange-500/10",
  indigo: "hover:shadow-indigo-500/10",
  emerald: "hover:shadow-emerald-500/10",
  violet: "hover:shadow-violet-500/10",
  rose: "hover:shadow-rose-500/10",
  slate: "hover:shadow-slate-500/10",
  lime: "hover:shadow-lime-500/10",
  yellow: "hover:shadow-yellow-500/10",
  fuchsia: "hover:shadow-fuchsia-500/10",
  sky: "hover:shadow-sky-500/10",
  gray: "hover:shadow-gray-500/10",
  zinc: "hover:shadow-zinc-500/10",
  neutral: "hover:shadow-neutral-500/10",
  stone: "hover:shadow-stone-500/10",
};

// ============================================================================
// SVG Raw Color Values
// ============================================================================

/**
 * Hex color pairs for SVG gradient definitions.
 * Use for linearGradient/radialGradient stop colors in SVG elements.
 *
 * NOTE: primary and secondary use hardcoded fallback values since CSS variables
 * cannot be used in SVG gradients or motion animations. If your theme uses different
 * primary/secondary colors, update these hex values to match your globals.css.
 *
 * Current primary is based on oklch(0.45-0.60 0.14-0.2 230) - a blue hue.
 * Current secondary is based on oklch(0.27-0.97 0.003-0.033 ~264) - slate/gray.
 */
export const gradientHexColors: Record<ThemeColor, GradientHexColors> = {
  // Blue-based primary matching oklch hue 230 from globals.css
  primary: { start: "#2563eb", end: "#3b82f6" },
  // Slate gray matching the neutral secondary from globals.css
  secondary: { start: "#64748b", end: "#94a3b8" },
  green: { start: "#22c55e", end: "#10b981" },
  amber: { start: "#f59e0b", end: "#fbbf24" },
  red: { start: "#ef4444", end: "#f87171" },
  blue: { start: "#3b82f6", end: "#60a5fa" },
  purple: { start: "#a855f7", end: "#c084fc" },
  pink: { start: "#ec4899", end: "#f472b6" },
  cyan: { start: "#06b6d4", end: "#22d3ee" },
  teal: { start: "#14b8a6", end: "#2dd4bf" },
  orange: { start: "#f97316", end: "#fb923c" },
  indigo: { start: "#6366f1", end: "#818cf8" },
  emerald: { start: "#10b981", end: "#34d399" },
  violet: { start: "#8b5cf6", end: "#a78bfa" },
  rose: { start: "#f43f5e", end: "#fb7185" },
  slate: { start: "#64748b", end: "#94a3b8" },
  lime: { start: "#84cc16", end: "#a3e635" },
  yellow: { start: "#eab308", end: "#facc15" },
  fuchsia: { start: "#d946ef", end: "#e879f9" },
  sky: { start: "#0ea5e9", end: "#38bdf8" },
  gray: { start: "#6b7280", end: "#9ca3af" },
  zinc: { start: "#71717a", end: "#a1a1aa" },
  neutral: { start: "#737373", end: "#a3a3a3" },
  stone: { start: "#78716c", end: "#a8a29e" },
};

/**
 * RGBA color strings for SVG glow/shadow filter effects.
 * Use for feFlood floodColor in SVG filter definitions.
 */
export const glowRgbaColors: Record<ThemeColor, string> = {
  primary: "rgba(99, 102, 241, 0.5)",
  secondary: "rgba(100, 116, 139, 0.5)",
  green: "rgba(34, 197, 94, 0.5)",
  amber: "rgba(245, 158, 11, 0.5)",
  red: "rgba(239, 68, 68, 0.5)",
  blue: "rgba(59, 130, 246, 0.5)",
  purple: "rgba(168, 85, 247, 0.5)",
  pink: "rgba(236, 72, 153, 0.5)",
  cyan: "rgba(6, 182, 212, 0.5)",
  teal: "rgba(20, 184, 166, 0.5)",
  orange: "rgba(249, 115, 22, 0.5)",
  indigo: "rgba(99, 102, 241, 0.5)",
  emerald: "rgba(16, 185, 129, 0.5)",
  violet: "rgba(139, 92, 246, 0.5)",
  rose: "rgba(244, 63, 94, 0.5)",
  slate: "rgba(100, 116, 139, 0.5)",
  lime: "rgba(132, 204, 22, 0.5)",
  yellow: "rgba(234, 179, 8, 0.5)",
  fuchsia: "rgba(217, 70, 239, 0.5)",
  sky: "rgba(14, 165, 233, 0.5)",
  gray: "rgba(107, 114, 128, 0.5)",
  zinc: "rgba(113, 113, 122, 0.5)",
  neutral: "rgba(115, 115, 115, 0.5)",
  stone: "rgba(120, 113, 108, 0.5)",
};

// ============================================================================
// Glass Effect Styles
// ============================================================================

/**
 * Card type options for glass styling variants.
 * - 'normal': Standard glass effect
 * - 'subtle': Lighter glass for secondary elements
 * - 'strong': Stronger glass for modals/overlays
 * - 'solid': Solid background (no transparency, like default shadcn card)
 * - 'none': Transparent background (no styling)
 */
export type CardType = "normal" | "subtle" | "strong" | "solid" | "none";

/**
 * Glass effect styles using Tailwind classes.
 * Uses orecus.io CSS custom properties for theme-aware glass effects.
 * Follows correct glassmorphism: dark overlay on light, light overlay on dark.
 *
 * Note: `none` is empty string to allow component's own background styling.
 * Use `glassStylesWithBg` if you need a solid background fallback.
 */
export const glassStyles: Record<CardType, string> = {
  normal: "bg-glass-bg backdrop-blur-[12px]",
  subtle: "bg-glass-subtle backdrop-blur-[8px]",
  strong: "bg-glass-bg-hover backdrop-blur-[16px]",
  solid: "bg-card",
  none: "",
};

/**
 * Glass effect styles with background for `none` variant.
 * Use this when the component needs a background when glass is disabled.
 */
export const glassStylesWithBg: Record<CardType, string> = {
  normal: "bg-glass-bg backdrop-blur-[12px]",
  subtle: "bg-glass-subtle backdrop-blur-[8px]",
  strong: "bg-glass-bg-hover backdrop-blur-[16px]",
  solid: "bg-card",
  none: "bg-transparent",
};

/**
 * Inverted glass effect styles.
 * Uses opposite overlay approach: light overlay on light, dark overlay on dark.
 *
 * Note: `none` is empty string to allow component's own background styling.
 * Use `invertedGlassStylesWithBg` if you need a solid background fallback.
 */
export const invertedGlassStyles: Record<CardType, string> = {
  normal: "bg-glass-inverted-bg backdrop-blur-[12px]",
  subtle: "bg-glass-inverted-subtle backdrop-blur-[8px]",
  strong: "bg-glass-inverted-bg-hover backdrop-blur-[16px]",
  solid: "bg-card",
  none: "",
};

/**
 * Inverted glass effect styles with background for `none` variant.
 * Use this when the component needs a background when glass is disabled.
 */
export const invertedGlassStylesWithBg: Record<CardType, string> = {
  normal: "bg-glass-inverted-bg backdrop-blur-[12px]",
  subtle: "bg-glass-inverted-subtle backdrop-blur-[8px]",
  strong: "bg-glass-inverted-bg-hover backdrop-blur-[16px]",
  solid: "bg-card",
  none: "bg-transparent",
};

// ============================================================================
// Glass CSS Variable Helpers
// ============================================================================

/**
 * Maps CardType to the corresponding CSS variable name for glass backgrounds.
 * Useful for gradients and other places that need the raw CSS variable.
 */
const glassColorVars: Record<CardType, string> = {
  normal: "var(--glass-bg)",
  subtle: "var(--glass-subtle)",
  strong: "var(--glass-bg-hover)",
  solid: "var(--card)",
  none: "transparent",
};

const invertedGlassColorVars: Record<CardType, string> = {
  normal: "var(--glass-inverted-bg)",
  subtle: "var(--glass-inverted-subtle)",
  strong: "var(--glass-inverted-bg-hover)",
  solid: "var(--card)",
  none: "transparent",
};

/**
 * Get the CSS variable for a glass type.
 * @param type - The glass type
 * @param invert - Whether to use inverted glass colors
 * @returns The CSS variable string (e.g., "var(--glass-bg)" or "var(--card)")
 */
export function getGlassColorVar(type: CardType, invert = false): string {
  return invert ? invertedGlassColorVars[type] : glassColorVars[type];
}

// ============================================================================
// Shared Radius & Shadow
// ============================================================================

/** Canonical border-radius options shared across all registry components. */
export type Radius = "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";

/** Canonical shadow options shared across all registry components. */
export type Shadow = "none" | "sm" | "md" | "lg";

/** Tailwind border-radius classes keyed by Radius. */
export const radiusStyles: Record<Radius, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
};

/** Tailwind shadow classes keyed by Shadow. "md" maps to Tailwind's default `shadow`. */
export const shadowStyles: Record<Shadow, string> = {
  none: "",
  sm: "shadow-sm",
  md: "shadow",
  lg: "shadow-lg",
};

// ============================================================================
// Dynamic Value Resolution
// ============================================================================

/**
 * Type for values that can be static or derived from an entity.
 * Used by entity-based components like EntityCard and ImageCard.
 */
export type MaybeEntityValue<T, V> = V | ((entity: T) => V);

/**
 * Resolves a MaybeEntityValue to its actual value.
 * If the value is a function, it's called with the entity; otherwise returned as-is.
 */
export function resolveEntityValue<T, V>(
  value: MaybeEntityValue<T, V> | undefined,
  entity: T,
  defaultValue: V
): V {
  if (value === undefined) return defaultValue;
  return typeof value === "function" ? (value as (e: T) => V)(entity) : value;
}

// ============================================================================
// Constants
// ============================================================================

/** Default fallback hex color (primary/indigo) */
export const DEFAULT_HEX_COLOR = "#6366f1"

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the hex color for a theme color.
 * Used by chart components for CSS variable colors.
 * Returns the start color from the gradient pair, with fallback.
 */
export function getThemeHexColor(color: ThemeColor, fallback = DEFAULT_HEX_COLOR): string {
  return gradientHexColors[color]?.start ?? fallback
}

/**
 * Get the core color styles for a theme color.
 */
export function getColorStyle(color: ThemeColor): ColorStyles {
  return colorStyles[color];
}

/**
 * Get all style values for a theme color (core + accent bar + hover).
 */
export function getAllColorStyles(color: ThemeColor) {
  return {
    ...colorStyles[color],
    accentBar: accentBarStyles[color],
    solidGradient: solidGradientStyles[color],
    hoverBorder: hoverBorderStyles[color],
    hoverGlowGradient: hoverGlowGradients[color],
  };
}

/**
 * Get all color tokens for a theme color.
 * Use this to get every available style for a color in one call.
 */
export function getColorTokens(color: ThemeColor) {
  return {
    // Simple class-based styles
    text: textColors[color],
    bg: bgColors[color],
    stroke: strokeColors[color],
    strokeBg: strokeBgColors[color],
    fill: fillColors[color],
    ring: ringColors[color],
    borderAccent: borderAccentColors[color],
    // Core color styles
    gradient: colorStyles[color].gradient,
    border: colorStyles[color].border,
    glow: colorStyles[color].glow,
    hoverGlow: colorStyles[color].hoverGlow,
    colorText: colorStyles[color].text,
    // Component-specific styles
    iconContainer: iconContainerColors[color],
    accentBar: accentBarStyles[color],
    solidGradient: solidGradientStyles[color],
    hoverBorder: hoverBorderStyles[color],
    hoverGlowGradient: hoverGlowGradients[color],
    // SVG raw values
    gradientHex: gradientHexColors[color],
    glowRgba: glowRgbaColors[color],
  };
}
