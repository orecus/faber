import type { Easing, MotionProps } from "motion/react";

// ============================================================================
// Timing Constants
// ============================================================================

/**
 * Duration constants in seconds for animations.
 * - instant: No animation
 * - fast: Micro-interactions (hover, click feedback)
 * - normal: Standard transitions
 * - slow: Emphasis animations
 * - entry: Entry animations (staggered content)
 */
export const DURATIONS = {
  instant: 0,
  fast: 0.15,
  normal: 0.3,
  slow: 0.45,
  entry: 0.4,
} as const;

export type Duration = keyof typeof DURATIONS;

// ============================================================================
// Easing Functions
// ============================================================================

/**
 * Easing function arrays for motion animations.
 * - out: Smooth deceleration for entrances
 * - smooth: Balanced easing for tilt animations
 * - emphasized: Strong deceleration for progress bars and charts
 * - panel: Custom easing for sidebar panels
 */
export const EASE = {
  /** Smooth deceleration for entrances [0.25, 0.46, 0.45, 0.94] */
  out: [0.25, 0.46, 0.45, 0.94] as const,
  /** Balanced easing for tilt animations [0.4, 0.4, 0.2, 1] */
  smooth: [0.4, 0.4, 0.2, 1] as const,
  /** Strong deceleration for progress/charts [0.22, 1, 0.36, 1] */
  emphasized: [0.22, 1, 0.36, 1] as const,
  /** Custom easing for sidebar panels [0.32, 0.72, 0, 1] */
  panel: [0.32, 0.72, 0, 1] as const,
  /** Standard enter easing [0.4, 0, 0.2, 1] */
  enter: [0.4, 0, 0.2, 1] as const,
} as const;

export type EaseKey = keyof typeof EASE;

/**
 * Get easing as a motion-compatible Easing type.
 */
export function getEasing(key: EaseKey): Easing {
  return EASE[key] as unknown as Easing;
}

// ============================================================================
// Spring Configurations (Motion-only)
// ============================================================================

/**
 * Spring animation configurations for motion library.
 * Use these for physics-based animations that require natural bounce.
 */
export const SPRING = {
  /** Bouncy spring for playful interactions */
  bouncy: { type: "spring" as const, stiffness: 400, damping: 10 },
  /** Balanced spring for most animations */
  medium: { type: "spring" as const, stiffness: 300, damping: 24 },
  /** Gentle spring for subtle movements */
  soft: { type: "spring" as const, stiffness: 200, damping: 20 },
  /** Quick spring for snappy feedback */
  stiff: { type: "spring" as const, stiffness: 500, damping: 30 },
} as const;

export type SpringKey = keyof typeof SPRING;

// ============================================================================
// CSS Transition Classes
// ============================================================================

/**
 * Tailwind CSS transition classes for CSS-based animations.
 * Prefer these over motion for simple hover/active states.
 */
export const CSS_TRANSITIONS = {
  /** Base transition for transforms, shadows, opacity */
  base: "transition-[transform,translate,box-shadow,opacity] duration-300 ease-out",
  /** Fast transition for micro-interactions */
  fast: "transition-all duration-150 ease-out",
  /** Color-only transitions */
  color: "transition-colors duration-300",
  /** Transform-only transitions */
  transform: "transition-transform duration-300 ease-out",
} as const;

export type CSSTransitionKey = keyof typeof CSS_TRANSITIONS;

// ============================================================================
// CSS Hover Effects
// ============================================================================

/**
 * Tailwind CSS hover effect classes.
 * Use these for simple hover states that don't need motion.
 */
export const CSS_HOVER = {
  scale: {
    /** Subtle scale for cards (1.01x) */
    subtle: "hover:scale-[1.01]",
    /** Medium scale for buttons (1.05x) */
    medium: "hover:scale-105",
  },
  /** Lift effect with translate */
  lift: "hover:-translate-y-1",
  click: {
    /** Subtle click feedback (0.99x) */
    subtle: "active:scale-[0.99]",
    /** Normal click feedback (0.98x) */
    normal: "active:scale-[0.98]",
  },
} as const;

// ============================================================================
// Entry Animation Variants
// ============================================================================

/**
 * Entry animation preset type.
 * Matches EntityGrid's StaggerPreset plus additional card-specific variants.
 */
export type EntryAnimationPreset =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "scale"
  | "fade-slide"
  | "slide-up-subtle";

/**
 * Animation variant structure for entry/exit animations.
 */
export interface EntryAnimationVariant {
  initial: { opacity: number; y?: number; x?: number; scale?: number };
  animate: { opacity: number; y?: number; x?: number; scale?: number };
}

/**
 * Default duration for each animation preset (in seconds).
 */
export const ENTRY_ANIMATION_DURATIONS: Record<Exclude<EntryAnimationPreset, "none">, number> = {
  fade: 0.4,
  "slide-up": 0.4,
  "slide-down": 0.4,
  "slide-left": 0.4,
  "slide-right": 0.4,
  scale: 0.4,
  "fade-slide": 0.4,
  "slide-up-subtle": 0.45,
} as const;

/**
 * Base delay for presets that require it (in seconds).
 */
export const ENTRY_ANIMATION_BASE_DELAYS: Partial<Record<Exclude<EntryAnimationPreset, "none">, number>> = {
  "slide-up-subtle": 0.15,
} as const;

/**
 * Entry animation variants for motion components.
 */
export const ENTRY_VARIANTS: Record<Exclude<EntryAnimationPreset, "none">, EntryAnimationVariant> = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
  },
  "slide-up": {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  },
  "slide-down": {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0 },
  },
  "slide-left": {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
  },
  "slide-right": {
    initial: { opacity: 0, x: -20 },
    animate: { opacity: 1, x: 0 },
  },
  scale: {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
  },
  "fade-slide": {
    initial: { opacity: 0, y: 40 },
    animate: { opacity: 1, y: 0 },
  },
  "slide-up-subtle": {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  },
} as const;

/**
 * Get the default duration for an animation preset.
 */
export function getEntryAnimationDuration(preset: EntryAnimationPreset): number {
  if (preset === "none") return 0;
  return ENTRY_ANIMATION_DURATIONS[preset];
}

/**
 * Get the base delay for an animation preset.
 */
export function getEntryAnimationBaseDelay(preset: EntryAnimationPreset): number {
  if (preset === "none") return 0;
  return ENTRY_ANIMATION_BASE_DELAYS[preset] ?? 0;
}

/**
 * Get the animation variant for a preset.
 */
export function getEntryAnimationVariant(preset: EntryAnimationPreset): EntryAnimationVariant | null {
  if (preset === "none") return null;
  return ENTRY_VARIANTS[preset];
}

// ============================================================================
// Stagger Delays
// ============================================================================

/**
 * Stagger delay presets for sequential animations.
 */
export const STAGGER_DELAYS = {
  /** Fast stagger for dense content */
  fast: 0.03,
  /** Normal stagger for most lists */
  normal: 0.05,
  /** Slow stagger for emphasis */
  slow: 0.08,
  /** Content-specific stagger delays */
  content: {
    label: 0,
    value: 0.05,
    trend: 0.1,
    sparkline: 0.15,
  },
  /** Stat component stagger delays */
  stat: {
    icon: 0,
    title: 0.05,
    value: 0.05,
    label: 0.1,
    description: 0.15,
    mainStat: 0.15,
    secondaryStat: 0.2,
    metrics: 0.25,
  },
  /** Header component stagger delays */
  header: {
    icon: 0,
    title: 0.05,
    description: 0.1,
    actions: 0.15,
  },
} as const;

// ============================================================================
// Shared Motion Variants
// ============================================================================

/**
 * Shared motion variants for common animation patterns.
 * Use with motion component's variants prop.
 */
export const SHARED_VARIANTS = {
  fadeIn: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: DURATIONS.normal,
        ease: EASE.enter,
      },
    },
  },
  scale: {
    hidden: { opacity: 0, scale: 0.8 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: DURATIONS.normal,
        ease: EASE.enter,
      },
    },
  },
  slideUp: {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: DURATIONS.normal,
        ease: EASE.enter,
      },
    },
  },
  slideDown: {
    hidden: { opacity: 0, y: -20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: DURATIONS.normal,
        ease: EASE.enter,
      },
    },
  },
  slideFromLeft: {
    hidden: { opacity: 0, x: -12 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        duration: DURATIONS.normal,
        ease: EASE.out,
      },
    },
  },
  slideFromRight: {
    hidden: { opacity: 0, x: 12 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        duration: DURATIONS.normal,
        ease: EASE.out,
      },
    },
  },
} as const;

/**
 * Reduced motion variants - instant transitions for accessibility.
 */
export const REDUCED_MOTION_VARIANTS = {
  fadeIn: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.01, ease: EASE.enter },
    },
  },
  scale: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.01, ease: EASE.enter },
    },
  },
  slideUp: {
    hidden: { opacity: 0, y: 0 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.01, ease: EASE.enter },
    },
  },
  slideDown: {
    hidden: { opacity: 0, y: 0 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.01, ease: EASE.enter },
    },
  },
  slideFromLeft: {
    hidden: { opacity: 0, x: 0 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.01, ease: EASE.out },
    },
  },
  slideFromRight: {
    hidden: { opacity: 0, x: 0 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.01, ease: EASE.out },
    },
  },
} as const;

// ============================================================================
// Simple Animation Props (for inline use)
// ============================================================================

/**
 * Simple animation prop objects for inline use with motion components.
 * Use these for one-off animations that don't need the variants pattern.
 */
export const ANIMATION_PROPS = {
  fadeSlideUp: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
  },
  fadeSlideDown: {
    initial: { opacity: 0, y: -8 },
    animate: { opacity: 1, y: 0 },
  },
  fadeSlideFromLeft: {
    initial: { opacity: 0, x: -12 },
    animate: { opacity: 1, x: 0 },
  },
  fadeSlideFromRight: {
    initial: { opacity: 0, x: 12 },
    animate: { opacity: 1, x: 0 },
  },
  scaleFade: {
    initial: { opacity: 0, scale: 0.8 },
    animate: { opacity: 1, scale: 1 },
  },
} as const;

// ============================================================================
// Tilt Animation Types
// ============================================================================

/** Configuration for tilt animation effect */
export interface TiltConfig {
  /** Maximum tilt angle in degrees. Default: 5 */
  max?: number;
  /** Perspective value for 3D effect. Default: 250 */
  perspective?: number;
  /** Scale factor when tilted. Default: 1.01 */
  scale?: number;
  /** Animation speed in milliseconds. Default: 500 */
  speed?: number;
}

/** Animation style for card hover effects */
export type AnimationStyle = "none" | "tilt" | "zoom";

/** Configuration for card animations */
export interface AnimationConfig {
  /** Animation style to apply */
  style?: AnimationStyle;
  /** Configuration for tilt animation */
  tilt?: TiltConfig;
  /** Additional motion props to merge */
  motionProps?: MotionProps;
}

/** Result from useCardAnimation hook */
export interface AnimationResult {
  /** Props to apply to the motion component */
  motionProps: MotionProps;
  /** Ref for the tilt container if using tilt animation */
  tiltRef?: React.RefObject<HTMLDivElement | null>;
}

/** Default tilt animation configuration */
export const DEFAULT_TILT_CONFIG: Required<TiltConfig> = {
  max: 5,
  perspective: 250,
  scale: 1.01,
  speed: 500,
} as const;

// ============================================================================
// Legacy Exports (for backward compatibility)
// ============================================================================

/**
 * @deprecated Use ENTRY_VARIANTS instead
 */
export const ENTRY_ANIMATION_VARIANTS = ENTRY_VARIANTS;
