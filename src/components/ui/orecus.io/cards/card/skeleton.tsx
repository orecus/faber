import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  accentBarStyles,
  solidGradientStyles,
  type ThemeColor,
  type CardType,
  glassStylesWithBg as glassStyles,
  invertedGlassStylesWithBg as invertedGlassStyles,
} from "@/components/ui/orecus.io/lib/color-utils";

// ============================================================================
// Types - Same API as Card for copy-paste compatibility
// ============================================================================

/** Border radius options - matches Card's CardRadius */
type CardRadius = "none" | "sm" | "md" | "lg" | "xl" | "2xl";

/** Shadow options - matches Card's CardShadow */
type CardShadow = "none" | "sm" | "md" | "lg" | "auto";

/** Accent bar position */
type AccentBarPosition = "none" | "top" | "bottom";

/** Accent bar variant */
type AccentBarVariant = "fade" | "solid";

/**
 * CardSkeleton props - Same API as Card for copy-paste compatibility.
 *
 * Structural props (affect layout):
 * - children (skeleton content to render)
 * - Convenience props: hasHeader, lines (auto-generate skeleton content)
 *
 * Styling props (passed through):
 * - type, invert, radius, border, shadow, className
 *
 * Ignored props (accepted for API compatibility):
 * - loading, hoverEffect, accentBar, animationPreset, etc.
 */
export interface CardSkeletonProps {
  /** Child content - skeleton content to render inside the card */
  children?: ReactNode;
  /** Convenience: show header skeleton placeholder */
  hasHeader?: boolean;
  /** Convenience: number of content lines to show */
  lines?: number;
  /** Card style variant. Default: 'normal' */
  type?: CardType;
  /** Invert glass overlay approach. Default: false */
  invert?: boolean;
  /** Border radius size. Default: 'md' */
  radius?: CardRadius;
  /** Whether to show border. Default: true */
  border?: boolean;
  /** Shadow style. Default: 'auto' */
  shadow?: CardShadow;
  /** Optional className for the container */
  className?: string;

  // Accent bar props - rendered for visual parity
  /** Gradient accent bar position. Default: 'none' */
  accentBar?: AccentBarPosition;
  /** Accent bar style variant. Default: 'fade' */
  accentBarVariant?: AccentBarVariant;
  /** Theme color for accent bar. Default: 'primary' */
  accentColor?: ThemeColor;

  // Props that affect layout (needsGroupWrapper in Card)
  /** Show border color on hover */
  hoverBorder?: boolean;
  /** Accent bar only visible on hover */
  accentBarOnHover?: boolean;
  /** Glow effect on hover */
  hoverGlow?: boolean;

  // Ignored props - accepted for API compatibility with Card
  loading?: boolean;
  hoverEffect?: string;
  clickEffect?: string;
  animationPreset?: string;
  animationDelay?: number;
  disableAnimations?: boolean;
  exitAnimation?: boolean;
  animationDuration?: number;
  tiltConfig?: unknown;
}

// ============================================================================
// Styles - Mirrors Card component styling
// ============================================================================

const radiusStyles: Record<CardRadius, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
};

const shadowStyles: Record<Exclude<CardShadow, "auto">, string> = {
  none: "",
  sm: "shadow-sm",
  md: "shadow",
  lg: "shadow-lg",
};

/** Auto-shadow based on card type - matches Card component */
const autoShadowStyles: Record<CardType, string> = {
  normal: "shadow-sm",
  subtle: "",
  strong: "shadow-lg",
  solid: "shadow-md",
  none: "",
};


// ============================================================================
// Component
// ============================================================================

/**
 * CardSkeleton - Server-compatible loading placeholder for Card.
 *
 * Uses the same API as Card for easy copy-paste workflow:
 * 1. Copy your `<Card ... />` usage
 * 2. Change to `<CardSkeleton ... />`
 * 3. Add skeleton children to match your card structure
 *
 * This is a pure server component (no 'use client') designed for Next.js loading.tsx files.
 *
 * @example Basic usage with skeleton children
 * ```tsx
 * <CardSkeleton type="normal">
 *   <div className="px-6 space-y-1">
 *     <Skeleton className="h-5 w-1/3" />
 *     <Skeleton className="h-4 w-1/2" />
 *   </div>
 *   <div className="px-6 space-y-3">
 *     <Skeleton className="h-4 w-full" />
 *     <Skeleton className="h-4 w-3/4" />
 *   </div>
 * </CardSkeleton>
 * ```
 *
 * @example Copy Card props directly
 * ```tsx
 * // Your page:
 * <Card type="subtle" radius="lg">
 *   <CardHeader>...</CardHeader>
 *   <CardContent>...</CardContent>
 * </Card>
 *
 * // Your loading.tsx - same styling props:
 * <CardSkeleton type="subtle" radius="lg">
 *   <div className="px-6 space-y-1">
 *     <Skeleton className="h-5 w-32" />
 *     <Skeleton className="h-4 w-48" />
 *   </div>
 * </CardSkeleton>
 * ```
 */
export function CardSkeleton({
  children,
  hasHeader,
  lines = 0,
  type = "normal",
  invert = false,
  radius = "md",
  border = true,
  shadow = "auto",
  className,
  // Accent bar props
  accentBar = "none",
  accentBarVariant = "fade",
  accentColor = "primary",
  // Props that affect layout (needsGroupWrapper in Card)
  hoverBorder,
  accentBarOnHover,
  hoverGlow,
  // Ignored props - accepted for API compatibility
  loading: _loading,
  hoverEffect: _hoverEffect,
  clickEffect: _clickEffect,
  animationPreset: _animationPreset,
  animationDelay: _animationDelay,
  disableAnimations: _disableAnimations,
  exitAnimation: _exitAnimation,
  animationDuration: _animationDuration,
  tiltConfig: _tiltConfig,
}: CardSkeletonProps) {
  // Match Card's needsGroupWrapper logic - these props cause Card to wrap in a group div with h-full
  const needsGroupWrapper = hoverGlow || hoverBorder || accentBarOnHover;

  // Glass styling - select based on invert prop (matches Card component)
  const glassClass = invert ? invertedGlassStyles[type] : glassStyles[type];

  // Shadow styling - auto uses type-based shadow (matches Card component)
  const shadowClass = shadow === "auto"
    ? autoShadowStyles[type]
    : shadowStyles[shadow];

  // Border styling (matches Card component)
  const borderClass = border
    ? "ring-1 ring-foreground/15"
    : "ring-0";

  // GPU acceleration for backdrop-filter (matches Card component)
  const gpuClass = type !== "none" ? "will-change-transform transform-gpu" : "";

  // Accent bar styling - matches Card component
  const accentBarClass = accentBarVariant === "solid"
    ? solidGradientStyles[accentColor]
    : accentBarStyles[accentColor];
  const accentBarBaseClass = accentBarVariant === "solid"
    ? "absolute inset-x-0 h-1 bg-linear-to-r"
    : "absolute inset-x-0 h-1 bg-linear-to-r from-primary/0 to-primary/0";
  const accentBarOpacityClass = accentBarOnHover ? "opacity-0" : "opacity-100";

  // Rounded corners for accent bar based on position and card radius
  const accentBarRadiusClass = (position: "top" | "bottom") => {
    if (radius === "none") return "";
    return position === "top"
      ? `rounded-t-${radius}`
      : `rounded-b-${radius}`;
  };

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

  // Card element - matches MotionDiv > ShadcnCard structure
  const cardElement = (
    <div
      className={cn(
        "relative w-full overflow-hidden",
        radiusStyles[radius],
        glassClass,
        borderClass,
        shadowClass,
        gpuClass,
        className
      )}
    >
      {/* Accent bar */}
      {accentBar === "top" && renderAccentBar("top")}
      {accentBar === "bottom" && renderAccentBar("bottom")}

      {/* Inner wrapper - matches ShadcnCard's base styles */}
      <div className="py-6 flex flex-col gap-6">
        {children ?? (
          <>
            {/* Auto-generated header skeleton */}
            {hasHeader && (
              <div className="px-6 space-y-1">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            )}
            {/* Auto-generated content lines */}
            {lines > 0 && (
              <div className="px-6 space-y-2">
                {Array.from({ length: lines }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className={cn("h-4", i === lines - 1 ? "w-3/4" : "w-full")}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  // Wrap with group container when hover effects require it
  // Note: Using "group relative" without h-full (matches EntityCard/ImageCard approach)
  if (needsGroupWrapper) {
    return (
      <div className="group relative">
        {cardElement}
      </div>
    );
  }

  return cardElement;
}
