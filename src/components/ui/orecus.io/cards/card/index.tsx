"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import * as React from "react";

import {
  Card as ShadcnCard,
  CardContent as ShadcnCardContent,
  CardDescription as ShadcnCardDescription,
  CardFooter as ShadcnCardFooter,
  CardHeader as ShadcnCardHeader,
  CardTitle as ShadcnCardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CSS_TRANSITIONS,
  CSS_HOVER,
  EASE,
  getEntryAnimationVariant,
  getEntryAnimationDuration,
  getEntryAnimationBaseDelay,
  type EntryAnimationPreset,
  type TiltConfig,
  type AnimationStyle,
} from "@/components/ui/orecus.io/lib/animation";
import { useTiltAnimation } from "@/components/ui/orecus.io/lib/use-tilt-animation";
import { useReducedMotion } from "@/components/ui/orecus.io/lib/use-reduced-motion";

// Create motion div with proper typing
const MotionDiv = motion.create("div");

// Import shared color utilities
import {
  type ThemeColor,
  type HoverEffect,
  type CardType,
  type Radius,
  type Shadow,
  radiusStyles as sharedRadiusStyles,
  shadowStyles as sharedShadowStyles,
  accentBarStyles,
  solidGradientStyles,
  hoverBorderStyles,
  hoverGlowGradients,
  glassStylesWithBg as glassStyles,
  invertedGlassStylesWithBg as invertedGlassStyles,
} from "@/components/ui/orecus.io/lib/color-utils";

// Re-export CardType for consumers
export type { CardType };

/** Border radius options (excludes "full" — cards are never fully rounded) */
export type CardRadius = Exclude<Radius, "full">;

/** Shadow options */
export type CardShadow = Shadow | "auto";

/** Auto-shadow based on card type */
const autoShadowStyles: Record<CardType, string> = {
  normal: "shadow-sm",
  subtle: "",
  strong: "shadow-lg",
  solid: "shadow-md",
  none: "",
};

/**
 * Extended Card component that wraps ShadCN's Card with additional functionality.
 *
 * @component
 * @example
 * ```tsx
 * <Card loading>Loading content...</Card>
 * <Card type="subtle">Secondary content</Card>
 * <Card type="solid" hoverEffect="glow" accentBar="top">Premium content</Card>
 * <Card border={false} radius="xl">No border, extra rounded</Card>
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Title</CardTitle>
 *   </CardHeader>
 *   <CardContent>Content</CardContent>
 * </Card>
 * ```
 *
 * @param loading - Shows skeleton loading state when true
 * @param type - Card style variant ('normal' | 'subtle' | 'strong' | 'solid' | 'none')
 * @param invert - Invert glass overlay (white-on-light, dark-on-dark). Default: false
 * @param shadow - Shadow style ('none' | 'sm' | 'md' | 'lg' | 'auto'). Default: 'auto'
 * @param border - Show border around card. Default: true
 * @param radius - Border radius size. Default: 'md'
 * @param hoverEffect - Hover effect style ('none' | 'scale' | 'glow' | 'scale-glow')
 * @param hoverBorder - Whether border color animates on hover using accentColor. Default: false
 * @param clickEffect - Click effect style ('none' | 'scale'). Default: 'none'
 * @param accentBar - Gradient accent bar position ('none' | 'top' | 'bottom')
 * @param accentBarVariant - Accent bar gradient style ('fade' | 'solid'). Default: 'fade'
 * @param accentColor - Predefined accent color for accent bar, hover border, and glow. Default: 'primary'
 * @param accentBarOnHover - Whether accent bar appears only on hover. Default: false
 * @param animationPreset - Entry animation preset (fade, slide-up, slide-down, scale, fade-slide, slide-up-subtle). Default: 'none'
 * @param animationDelay - Animation delay in seconds for standalone staggered animations. Default: 0
 * @param disableAnimations - When true, Card skips its own animations (for grid contexts). Default: false
 * @param exitAnimation - Enable exit animations (requires AnimatePresence wrapper). Default: false
 * @param animationDuration - Custom animation duration in seconds (overrides preset default). Default: varies by preset
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  loading?: boolean;
  /** Card style variant */
  type?: CardType;
  /** Invert glass overlay approach (white-on-light, dark-on-dark). Default: false */
  invert?: boolean;
  /** Shadow style. 'auto' uses shadow based on type. Default: 'auto' */
  shadow?: CardShadow;
  /** Show border around card. Default: true */
  border?: boolean;
  /** Border radius size */
  radius?: CardRadius;
  /** Hover effect style */
  hoverEffect?: HoverEffect;
  /** Configuration for tilt animation (only used with tilt effects) */
  tiltConfig?: TiltConfig;
  /** Click effect style */
  clickEffect?: "none" | "scale";
  /** Whether border color animates on hover using accentColor. Default: false */
  hoverBorder?: boolean;
  /** Gradient accent bar position */
  accentBar?: "none" | "top" | "bottom";
  /** Accent bar gradient style: 'fade' (center-out via-*) or 'solid' (full gradient) */
  accentBarVariant?: "fade" | "solid";
  /** Predefined accent color for accent bar, hover border, and glow */
  accentColor?: ThemeColor;
  /** Whether accent bar appears only on hover. Default: false */
  accentBarOnHover?: boolean;
  /** Whether to show gradient glow effect behind card on hover. Default: false */
  hoverGlow?: boolean;
  /** Entry animation preset. Default: 'none' */
  animationPreset?: EntryAnimationPreset;
  /** Animation delay in seconds for standalone staggered animations. Default: 0 */
  animationDelay?: number;
  /** When true, Card skips its own animations (for grid contexts where parent handles animations). Default: false */
  disableAnimations?: boolean;
  /** Enable exit animations (requires AnimatePresence wrapper in parent). Default: false */
  exitAnimation?: boolean;
  /** Custom animation duration in seconds (overrides preset default). Default: varies by preset */
  animationDuration?: number;
}

const CardWrapper = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      loading = false,
      type = 'normal',
      invert = false,
      shadow = "auto",
      border = true,
      radius,
      hoverEffect = "none",
      tiltConfig,
      clickEffect = "none",
      hoverBorder = false,
      accentBar = "none",
      accentBarVariant = "fade",
      accentColor = "primary",
      accentBarOnHover = false,
      hoverGlow = false,
      animationPreset = "none",
      animationDelay = 0,
      disableAnimations = false,
      exitAnimation = false,
      animationDuration,
      children,
      className,
      ...props
    },
    ref
  ) => {
    const cardType = type ?? "none";
    const prefersReducedMotion = useReducedMotion();

    // Map hoverEffect to animation style for useTiltAnimation
    // Only tilt needs Motion - scale/lift/none use CSS (simpler, more performant)
    const animationStyle: AnimationStyle = React.useMemo(() => {
      if (hoverEffect === "tilt") return "tilt";
      return "none";
    }, [hoverEffect]);

    // Use card animation hook for tilt effects
    const { motionProps: tiltMotionProps, tiltRef } = useTiltAnimation({
      style: animationStyle,
      tilt: tiltConfig,
    });

    // Handle entry/exit animations
    const entryVariant = !disableAnimations && animationPreset !== "none"
      ? getEntryAnimationVariant(animationPreset)
      : null;

    const shouldAnimate = entryVariant && !prefersReducedMotion;

    // Calculate animation delay (base delay + custom delay)
    const baseDelay = shouldAnimate ? getEntryAnimationBaseDelay(animationPreset) : 0;
    const totalDelay = baseDelay + animationDelay;

    // Get animation duration (custom override or preset default)
    const duration = animationDuration ?? (shouldAnimate ? getEntryAnimationDuration(animationPreset) : 0);

    // Build entry animation props
    // Motion/react will keep element in initial state until delay passes, then animate
    // The initial prop ensures element starts hidden (opacity: 0, etc.) and animates after delay
    // Motion/react automatically applies initial state and keeps it until transition starts
    const entryAnimationProps = shouldAnimate
      ? {
          initial: entryVariant.initial,
          animate: entryVariant.animate,
          transition: {
            duration,
            delay: totalDelay,
            ease: EASE.out,
          },
          ...(exitAnimation && {
            exit: entryVariant.initial,
          }),
        }
      : {};

    // Merge tilt motion props with entry animation props
    const motionProps = {
      ...tiltMotionProps,
      ...entryAnimationProps,
    };

    // Determine if using tilt animation (needs motion wrapper)
    const hasTilt = hoverEffect === "tilt";
    
    // Determine if lift effect is enabled
    const hasLiftEffect = hoverEffect === "lift";

    // Glass styling - select based on invert prop
    const glassClass = invert
      ? invertedGlassStyles[cardType]
      : glassStyles[cardType];

    // Shadow styling - auto uses type-based shadow, otherwise use explicit setting
    const shadowClass = shadow === "auto"
      ? autoShadowStyles[cardType]
      : sharedShadowStyles[shadow];

    // Default radius
    const effectiveRadius = radius ?? "md";
    const radiusClass = sharedRadiusStyles[effectiveRadius];

    // Border styling - use ring (box-shadow) for theme-aware borders
    // This avoids stacking with ShadCN Card's built-in ring-1
    const borderClass = border
      ? (invert ? "ring-1 ring-foreground/15" : "ring-1 ring-foreground/15")
      : "ring-0";

    // GPU acceleration for backdrop-filter and hover effects
    const gpuClass = cardType !== "none" ? "will-change-[transform,translate,box-shadow] transform-gpu" : "";

    // Get classes from style mappings using the effective accent color
    const hoverBorderClass = hoverBorder ? hoverBorderStyles[accentColor] : "";
    const accentBarClass = accentBarVariant === "solid"
      ? solidGradientStyles[accentColor]
      : accentBarStyles[accentColor];
    const glowGradient = hoverGlowGradients[accentColor];

    // Accent bar base classes - solid variant uses full gradient, fade uses via-* pattern
    const accentBarBaseClass = accentBarVariant === "solid"
      ? "absolute inset-x-0 h-1 bg-linear-to-r transition-all duration-300 ease-in-out"
      : "absolute inset-x-0 h-1 bg-linear-to-r from-primary/0 to-primary/0 transition-all duration-300 ease-in-out";
    const accentBarOpacityClass = accentBarOnHover
      ? "opacity-0 group-hover:opacity-100"
      : "opacity-100";

    // Rounded corners for accent bar based on position and card radius
    const accentBarRadiusClass = (position: "top" | "bottom") => {
      if (effectiveRadius === "none") return "";
      return position === "top"
        ? `rounded-t-${effectiveRadius}`
        : `rounded-b-${effectiveRadius}`;
    };

    // Hover effect classes - CSS handles scale, Motion only used for tilt
    const hasScaleEffect = hoverEffect === "scale";
    const hoverScaleClass = hasScaleEffect ? CSS_HOVER.scale.subtle : "";
    const hasGlow = hoverGlow;

    // Click effect classes
    const clickScaleClass = clickEffect === "scale" ? CSS_HOVER.click.subtle : "";

    // ShadcnCard classes - minimal, just structure (visual styles go on MotionDiv)
    const cardClasses = cn(
      // Override ShadcnCard defaults to avoid conflicts with MotionDiv styles
      "ring-0 shadow-none rounded-none bg-transparent",
      // Keep ShadcnCard's structural classes (flex, gap, padding, etc.)
      className
    );

    // Need group wrapper if any hover effects are enabled (for glow, hover border, or accent bar on hover)
    const needsGroupWrapper = hasGlow || hoverBorder || accentBarOnHover;

    // Render accent bar element
    const renderAccentBar = (position: "top" | "bottom") => (
      <div
        className={cn(
          accentBarBaseClass,
          accentBarOpacityClass,
          accentBarRadiusClass(position),
          position === "top" ? "top-0" : "bottom-0",
          accentBarClass
        )}
      />
    );

    // Card content (shared between motion and non-motion versions)
    const cardContent = (
      <>
        {/* Accent bar */}
        {accentBar === "top" && renderAccentBar("top")}
        {accentBar === "bottom" && renderAccentBar("bottom")}

        {loading && !children ? (
          // Default skeleton if no children provided (backward compatible)
          <div className="p-6 space-y-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          // Children will use CardLoadingContext to apply shimmer at compound component level
          children
        )}
      </>
    );

    // Always use MotionDiv as root for smoother animations (like EntityCard)
    const cardElement = (
      <MotionDiv
        {...motionProps}
        ref={hasTilt ? tiltRef : undefined}
        className={cn(
          // Base styles (matching EntityCard structure exactly)
          "relative w-full overflow-hidden",
          radiusClass,
          glassClass,
          borderClass,
          shadowClass,
          gpuClass || "will-change-[transform,translate,box-shadow] transform-gpu", // Always apply for smooth animations
          CSS_TRANSITIONS.base,
          // CSS lift effect - apply when lift is enabled
          hasLiftEffect && `${CSS_HOVER.lift} hover:shadow-xl`,
          // Shadow effect for scale and tilt (matching lift's shadow)
          (hasScaleEffect || hasTilt) && "hover:shadow-xl",
          // CSS scale effect
          hoverScaleClass,
          // Click effect
          clickScaleClass,
          hoverBorderClass,
          className
        )}
      >
        <ShadcnCard
          ref={ref}
          className={cn(cardClasses)}
          aria-busy={loading || undefined}
          {...props}
        >
          {cardContent}
        </ShadcnCard>
      </MotionDiv>
    );

    // If any hover effects are enabled, wrap with group container
    if (needsGroupWrapper) {
      return (
        // h-full ensures wrapper stretches to fill grid cell (critical for bento layouts)
        <div className="group relative h-full">
          {/* Gradient background glow on hover (only if glow effect enabled) */}
          {hasGlow && (
            <div
              className={cn(
                "absolute -inset-0.5 bg-linear-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-450 blur-xl rounded-lg",
                glowGradient
              )}
            />
          )}
          {cardElement}
        </div>
      );
    }

    // Standard card without hover effects
    return cardElement;
  }
);

CardWrapper.displayName = "CardWrapper";

// ============================================================================
// Compound Components (re-export from ShadCN)
// ============================================================================

const CardHeader = ShadcnCardHeader;
const CardTitle = ShadcnCardTitle;
const CardDescription = ShadcnCardDescription;
const CardContent = ShadcnCardContent;
const CardFooter = ShadcnCardFooter;

// ============================================================================
// Exports
// ============================================================================

export const Card = CardWrapper;
export { CardHeader, CardFooter, CardTitle, CardDescription, CardContent };

