"use client";

import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import * as React from "react";
import { type ThemeColor, colorStyles } from "@/components/ui/orecus.io/lib/color-utils";
import { getEasing } from "@/components/ui/orecus.io/lib/animation";

// Create motion component
const MotionDiv = motion.create("div");

// Animation easing
const EASE_SMOOTH = getEasing("emphasized");

/**
 * Extended Progress component that wraps ShadCN's Progress with additional functionality.
 *
 * @component
 * @example
 * ```tsx
 * // Standard progress
 * <Progress value={50} />
 *
 * // Gradient progress with custom color
 * <Progress value={75} variant="gradient" color="blue" />
 *
 * // Animated progress with shine effect
 * <Progress value={60} animated shine />
 * ```
 */
export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Animate the progress fill on mount */
  animated?: boolean;
  /** Theme color for the progress indicator */
  color?: ThemeColor;
  /** Maximum value (default 100) */
  max?: number;
  /** Add a shine effect animation to the progress bar */
  shine?: boolean;
  /** Apply destructive styling when value >= max */
  showOverBudget?: boolean;
  /** Height size of the progress bar */
  size?: "sm" | "md" | "lg";
  /** Current progress value (0-max) */
  value?: number;
  /** Style variant - 'gradient' uses a gradient fill, 'default' uses solid primary color */
  variant?: "default" | "gradient";
}

const sizeClasses = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2.5",
};

function Progress({
  animated = false,
  className,
  color = "primary",
  max = 100,
  shine = false,
  showOverBudget = false,
  size = "md",
  value,
  variant = "default",
  ...props
}: ProgressProps) {
  const percentage = Math.min(((value ?? 0) / max) * 100, 100);
  const isOverBudget = showOverBudget && (value ?? 0) >= max;
  const sizeClass = sizeClasses[size];
  const gradientClass = colorStyles[color].gradient;

  // For the gradient variant, we use a custom implementation
  if (variant === "gradient") {
    // Shared shine element
    const shineElement = shine && (
      <MotionDiv
        initial={{ x: "-100%" }}
        animate={{ x: "200%" }}
        transition={{
          duration: 2,
          repeat: Number.POSITIVE_INFINITY,
          repeatDelay: 3,
        }}
        className="absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-white/30 to-transparent"
      />
    );

    return (
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-muted/80",
          sizeClass,
          className
        )}
      >
        {animated ? (
          <MotionDiv
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.8, ease: EASE_SMOOTH }}
            className={cn(
              "absolute inset-y-0 left-0 rounded-full bg-linear-to-r overflow-hidden",
              isOverBudget ? "from-destructive/80 to-destructive" : gradientClass
            )}
          >
            {shineElement}
          </MotionDiv>
        ) : (
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-all duration-300 bg-linear-to-r overflow-hidden",
              isOverBudget ? "from-destructive/80 to-destructive" : gradientClass
            )}
            style={{ width: `${percentage}%` }}
          >
            {shineElement}
          </div>
        )}
      </div>
    );
  }

  // Default variant - solid primary color
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-muted/80",
        sizeClass,
        className
      )}
      {...props}
    >
      {animated ? (
        <MotionDiv
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: EASE_SMOOTH }}
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            isOverBudget ? "bg-destructive" : "bg-primary"
          )}
        />
      ) : (
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all duration-300",
            isOverBudget ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${percentage}%` }}
        />
      )}
    </div>
  );
}

Progress.displayName = "Progress";

export { Progress };

