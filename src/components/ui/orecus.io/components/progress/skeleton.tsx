import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// ============================================================================
// Types - Same API as Progress for copy-paste compatibility
// ============================================================================

/** Theme color type */
type ThemeColor = string;

/**
 * ProgressSkeleton props - Same API as Progress for copy-paste compatibility.
 *
 * Structural props (affect layout):
 * - size, value (affects width of filled portion)
 *
 * Ignored props (accepted for API compatibility):
 * - animated, color, shine, showOverBudget, variant
 */
export interface ProgressSkeletonProps {
  /** Current progress value (0-100) - affects filled portion width */
  value?: number;
  /** Height size of the progress bar */
  size?: "sm" | "md" | "lg";
  /** Animate the progress fill - ignored but accepted for API compatibility */
  animated?: boolean;
  /** Theme color - ignored but accepted for API compatibility */
  color?: ThemeColor;
  /** Shine effect - ignored but accepted for API compatibility */
  shine?: boolean;
  /** Over budget styling - ignored but accepted for API compatibility */
  showOverBudget?: boolean;
  /** Style variant - ignored but accepted for API compatibility */
  variant?: "default" | "gradient";
  /** Optional className */
  className?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const sizeClasses = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2.5",
};

// ============================================================================
// Component
// ============================================================================

/**
 * ProgressSkeleton - Server-compatible loading placeholder for Progress.
 *
 * Uses the same API as Progress for easy copy-paste workflow:
 * 1. Copy your `<Progress ... />` usage
 * 2. Change to `<ProgressSkeleton ... />`
 * 3. Layout automatically matches
 *
 * This is a pure server component (no 'use client') designed for Next.js loading.tsx files.
 *
 * @example Copy Progress props directly
 * ```tsx
 * // Your page:
 * <Progress value={75} variant="gradient" color="blue" size="lg" />
 *
 * // Your loading.tsx - same props:
 * <ProgressSkeleton value={75} variant="gradient" color="blue" size="lg" />
 * ```
 */
export function ProgressSkeleton({
  value = 0,
  size = "md",
  className,
  // Ignored props
  animated: _animated,
  color: _color,
  shine: _shine,
  showOverBudget: _showOverBudget,
  variant: _variant,
}: ProgressSkeletonProps) {
  const clampedValue = Math.min(Math.max(value, 0), 100);
  const sizeClass = sizeClasses[size];

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-muted/80",
        sizeClass,
        className
      )}
    >
      {/* Filled portion skeleton */}
      <Skeleton
        className={cn("absolute inset-y-0 left-0 rounded-full", sizeClass)}
        style={{ width: `${clampedValue}%` }}
      />
    </div>
  );
}
