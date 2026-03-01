import type { ReactNode } from "react";
import type { ThemeColor, Radius } from "@/components/ui/orecus.io/lib/color-utils";

// ============================================================================
// Style Types
// ============================================================================

/** Animation type for the active indicator */
export type TabsAnimation = "fade" | "slide";

/** Visual variant of the container background */
export type TabsVariant = "normal" | "subtle" | "strong" | "solid" | "none";

/** Visual variant for the active tab indicator */
export type TabIndicatorVariant = "gradient" | "color" | "glass" | "solid";

/** Alignment of tabs within the container */
export type TabsAlign = "start" | "center" | "end" | "grow";

/** Size variant affecting padding and font size */
export type TabsSize = "sm" | "md" | "lg";

/** Border radius options */
export type TabsRadius = Extract<Radius, "none" | "sm" | "md" | "lg" | "full">;

// ============================================================================
// Item Types
// ============================================================================

/** Props for an individual tab item */
export interface TabItem<T extends string = string> {
  /** Unique value identifier */
  value: T;
  /** Display label for the tab */
  label?: string;
  /** Optional icon displayed before the label */
  icon?: ReactNode;
  /** Optional badge displayed after the label */
  badge?: ReactNode;
  /** Optional color override for this specific item */
  color?: ThemeColor;
  /** Whether this item is disabled */
  disabled?: boolean;
  /** Children content (alternative to label) */
  children?: ReactNode;
}

// ============================================================================
// Component Props
// ============================================================================

/** Props for the root Tabs component */
export interface TabsProps<T extends string = string> {
  /** Currently selected value */
  value: T;
  /** Callback when selection changes */
  onChange?: (value: T) => void;
  /** Callback when selection changes (alias) */
  onValueChange?: (value: T) => void;
  /** Whether tabs should take full width of container. Default: false */
  fullWidth?: boolean;
  /** Animation type for the active indicator. Default: 'fade' */
  animation?: TabsAnimation;
  /** Visual variant of the container background. Default: 'subtle' */
  variant?: TabsVariant;
  /** Invert glass overlay (light-on-light, dark-on-dark). Default: false */
  invert?: boolean;
  /** Shadow style. Default: 'none' */
  shadow?: "none" | "sm" | "md" | "lg";
  /** Visual variant for the active indicator. Default: 'gradient' (colorful gradient) */
  indicatorVariant?: TabIndicatorVariant;
  /**
   * Enable animated color crossfade when switching tabs.
   * Only applies when animation='slide' and indicatorVariant='gradient'.
   * Note: Uses hardcoded hex values for animation - primary/secondary will use fallback colors
   * rather than your theme's CSS variables. For theme-accurate colors, leave this disabled.
   * Default: false
   */
  colorCrossfade?: boolean;
  /** Base color for the active tab. Default: 'primary' */
  color?: ThemeColor;
  /** Alignment of tabs within the container. Default: 'center' */
  align?: TabsAlign;
  /** Content to render at the start of the bar */
  leftSection?: ReactNode;
  /** Content to render at the end of the bar */
  rightSection?: ReactNode;
  /** Size variant. Default: 'md' */
  size?: TabsSize;
  /** Border radius for the outer container. Default: 'full' */
  barRadius?: TabsRadius;
  /** Border radius for individual tabs. Default: 'full' */
  tabRadius?: TabsRadius;
  /** Additional CSS classes for the container */
  className?: string;
  /** Additional CSS classes for each tab item */
  tabClassName?: string;
  /** Children (Tab and TabContent components) */
  children: ReactNode;
}

/** Props for Tabs.Tab component */
export interface TabProps<T extends string = string> {
  /** Unique value identifier */
  value: T;
  /** Optional icon displayed before the label */
  icon?: ReactNode;
  /** Badge displayed after the label */
  badge?: ReactNode;
  /** Color override for this tab */
  color?: ThemeColor;
  /** Whether this tab is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Tab label content */
  children?: ReactNode;
}

/** Props for Tabs.Content component */
export interface TabContentProps<T extends string = string> {
  /** Value that matches the tab this content belongs to */
  value: T;
  /** Whether to force mount (keep in DOM when inactive) */
  forceMount?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Content to display when tab is active */
  children: ReactNode;
}

// ============================================================================
// Context Types
// ============================================================================

/** Context value for Tabs compound components */
export interface TabsContextValue<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  animation: TabsAnimation;
  variant: TabsVariant;
  invert: boolean;
  indicatorVariant?: TabIndicatorVariant;
  colorCrossfade: boolean;
  color: ThemeColor;
  size: TabsSize;
  align: TabsAlign;
  tabRadius: TabsRadius;
  tabClassName?: string;
  /** Stable layoutId for slide animation */
  layoutId: string;
  /** Registered tabs for translateX calculation */
  tabs: TabItem<T>[];
  registerTab: (tab: TabItem<T>) => void;
  /** Previous value for color crossfade animation */
  previousValue?: T;
}
