import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";

// ============================================================================
// Types - Same API as Button for copy-paste compatibility
// ============================================================================

/** Button size variants matching shadcn */
type ButtonSize = "default" | "sm" | "lg" | "icon";

/** Button variant types */
type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "glass" | "gradient" | "color";

/** Theme color type */
type ThemeColor = string;

/**
 * ButtonSkeleton props - Same API as Button for copy-paste compatibility.
 *
 * Structural props (affect layout):
 * - size, leftIcon, rightIcon
 *
 * Ignored props (accepted for API compatibility):
 * - loading, variant, color, hoverEffect, clickEffect, disabled, children, etc.
 */
export interface ButtonSkeletonProps {
  /** Size variant */
  size?: ButtonSize;
  /** Left icon - presence determines if icon skeleton is shown */
  leftIcon?: ReactNode;
  /** Right icon - presence determines if icon skeleton is shown */
  rightIcon?: ReactNode;
  /** Loading state - ignored but accepted for API compatibility */
  loading?: boolean;
  /** Button variant - ignored but accepted for API compatibility */
  variant?: ButtonVariant;
  /** Color - ignored but accepted for API compatibility */
  color?: ThemeColor;
  /** Hover effect - ignored but accepted for API compatibility */
  hoverEffect?: string;
  /** Click effect - ignored but accepted for API compatibility */
  clickEffect?: string;
  /** Disabled state - ignored but accepted for API compatibility */
  disabled?: boolean;
  /** Button children - ignored but accepted for API compatibility */
  children?: ReactNode;
  /** Optional custom width (CSS value) */
  width?: string;
  /** Optional className */
  className?: string;
}

// ============================================================================
// Configuration
// ============================================================================

// Size styles matching shadcn Button
const sizeStyles: Record<ButtonSize, { h: string; w: string; radius: string; iconSize: string }> = {
  default: { h: "h-9", w: "w-24", radius: "rounded-md", iconSize: "h-4 w-4" },
  sm: { h: "h-8", w: "w-20", radius: "rounded-md", iconSize: "h-3.5 w-3.5" },
  lg: { h: "h-10", w: "w-28", radius: "rounded-md", iconSize: "h-5 w-5" },
  icon: { h: "h-9", w: "w-9", radius: "rounded-md", iconSize: "h-4 w-4" },
};

// ============================================================================
// Component
// ============================================================================

/**
 * ButtonSkeleton - Server-compatible loading placeholder for Button.
 *
 * Uses the same API as Button for easy copy-paste workflow:
 * 1. Copy your `<Button ... />` usage
 * 2. Change to `<ButtonSkeleton ... />`
 * 3. Layout automatically matches
 *
 * This is a pure server component (no 'use client') designed for Next.js loading.tsx files.
 *
 * @example Copy Button props directly
 * ```tsx
 * // Your page:
 * <Button leftIcon={<Plus />} variant="default">Add Item</Button>
 *
 * // Your loading.tsx - same props:
 * <ButtonSkeleton leftIcon={<Plus />} variant="default">Add Item</ButtonSkeleton>
 * ```
 */
export function ButtonSkeleton({
  size = "default",
  leftIcon,
  rightIcon,
  width,
  className,
  // Ignored props
  loading: _loading,
  variant: _variant,
  color: _color,
  hoverEffect: _hoverEffect,
  clickEffect: _clickEffect,
  disabled: _disabled,
  children: _children,
}: ButtonSkeletonProps) {
  const styles = sizeStyles[size];

  // Icon-only button
  if (size === "icon") {
    return (
      <Skeleton
        className={cn(styles.h, styles.w, styles.radius, className)}
        style={width ? { width } : undefined}
      />
    );
  }

  // Check if we have icons
  const hasLeftIcon = !!leftIcon;
  const hasRightIcon = !!rightIcon;

  // If we have icons, show a more detailed skeleton
  if (hasLeftIcon || hasRightIcon) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2",
          styles.h,
          styles.radius,
          "bg-muted animate-pulse",
          className
        )}
        style={{ width: width || (size === "sm" ? "5rem" : size === "lg" ? "7rem" : "6rem") }}
      >
        {hasLeftIcon && <Skeleton className={cn(styles.iconSize, "rounded")} />}
        <Skeleton className="h-4 flex-1" />
        {hasRightIcon && <Skeleton className={cn(styles.iconSize, "rounded")} />}
      </div>
    );
  }

  // Simple button skeleton
  return (
    <Skeleton
      className={cn(styles.h, styles.w, styles.radius, className)}
      style={width ? { width } : undefined}
    />
  );
}

// ============================================================================
// Button Group Skeleton
// ============================================================================

/**
 * ButtonGroupSkeleton - Server-compatible skeleton for grouped buttons.
 *
 * Replicates ButtonGroup styling so skeletons appear properly grouped
 * (merged borders, correct corner radius on adjacent buttons).
 *
 * @example
 * ```tsx
 * <ButtonGroupSkeleton count={2} />
 * <ButtonGroupSkeleton count={3} size="sm" />
 * ```
 */
export interface ButtonGroupSkeletonProps {
  /** Number of buttons. Default: 2 */
  count?: number;
  /** Size variant for all buttons. Default: 'default' */
  size?: ButtonSize;
  /** Orientation. Default: 'horizontal' */
  orientation?: "horizontal" | "vertical";
  /** Optional className */
  className?: string;
}

export function ButtonGroupSkeleton({
  count = 2,
  size = "default",
  orientation = "horizontal",
  className,
}: ButtonGroupSkeletonProps) {
  const styles = sizeStyles[size];
  const isVertical = orientation === "vertical";

  return (
    <div
      role="group"
      className={cn(
        "flex w-fit items-stretch",
        isVertical && "flex-col",
        className
      )}
    >
      {Array.from({ length: count }).map((_, i) => {
        const isFirst = i === 0;
        const isLast = i === count - 1;

        // Calculate border radius based on position
        let radiusClass = "";
        if (count === 1) {
          radiusClass = styles.radius;
        } else if (isVertical) {
          if (isFirst) radiusClass = "rounded-t-md rounded-b-none";
          else if (isLast) radiusClass = "rounded-b-md rounded-t-none";
          else radiusClass = "rounded-none";
        } else {
          if (isFirst) radiusClass = "rounded-l-md rounded-r-none";
          else if (isLast) radiusClass = "rounded-r-md rounded-l-none";
          else radiusClass = "rounded-none";
        }

        // Calculate border based on position (avoid double borders)
        let borderClass = "border border-input";
        if (!isFirst) {
          borderClass = isVertical
            ? "border border-input border-t-0"
            : "border border-input border-l-0";
        }

        return (
          <Skeleton
            key={i}
            className={cn(
              styles.h,
              styles.w,
              radiusClass,
              borderClass
            )}
          />
        );
      })}
    </div>
  );
}
