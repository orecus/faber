import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import type { TabsVariant, TabsSize, TabsRadius, TabsAlign } from "./types";

// ============================================================================
// Props
// ============================================================================

export interface TabsSkeletonProps {
  /** Number of tab skeletons to show */
  count?: number;
  /** Whether tabs should take full width of container */
  fullWidth?: boolean;
  /** Container variant */
  variant?: TabsVariant;
  /** Size variant */
  size?: TabsSize;
  /** Bar border radius */
  barRadius?: TabsRadius;
  /** Tab border radius */
  tabRadius?: TabsRadius;
  /** Tab alignment */
  align?: TabsAlign;
  /** Show left section placeholder */
  hasLeftSection?: boolean;
  /** Show right section placeholder */
  hasRightSection?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Style Mappings
// ============================================================================

const sizeStyles: Record<TabsSize, { container: string; tab: string; skeleton: string }> = {
  // tab: matches main component's padding + min-height ensures consistent sizing
  // (text classes alone don't establish line-height without actual text content)
  // sm: py-1 (8px) + text-xs line-height (16px) = 24px = h-6
  // md: py-1.5 (12px) + text-sm line-height (20px) = 32px = h-8
  // lg: py-2.5 (20px) + text-base line-height (24px) = 44px = h-11
  sm: { container: "p-1", tab: "px-2.5 h-6", skeleton: "h-3 w-12" },
  md: { container: "p-1", tab: "px-3.5 h-8", skeleton: "h-3.5 w-14" },
  lg: { container: "p-1.5", tab: "px-5 h-11", skeleton: "h-4 w-16" },
};

const radiusStyles: Record<TabsRadius, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
};

const containerVariantStyles: Record<TabsVariant, string> = {
  normal: "bg-glass-bg backdrop-blur-[12px] ring-1 ring-foreground/10",
  subtle: "bg-glass-subtle backdrop-blur-[8px] ring-1 ring-foreground/10",
  strong: "bg-glass-bg-hover backdrop-blur-[16px] ring-1 ring-foreground/10",
  solid: "bg-glass-solid ring-1 ring-foreground/10",
  none: "ring-1 ring-foreground/10",
};

const alignStyles: Record<TabsAlign, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  grow: "",
};

// ============================================================================
// Component
// ============================================================================

/**
 * Skeleton loading state for Tabs.
 * Server-compatible - no hooks, no client-side dependencies.
 */
export function TabsSkeleton({
  count = 3,
  fullWidth = false,
  variant = "subtle",
  size = "md",
  barRadius = "full",
  tabRadius = "full",
  align = "center",
  hasLeftSection = false,
  hasRightSection = false,
  className,
}: TabsSkeletonProps) {
  const tabs = Array.from({ length: count });

  return (
    <div className={cn(fullWidth ? "flex flex-col w-full" : "inline-flex flex-col")}>
      <div
        className={cn(
          "relative flex items-center will-change-transform transform-gpu",
          containerVariantStyles[variant],
          sizeStyles[size].container,
          radiusStyles[barRadius],
          className
        )}
      >
        {hasLeftSection && (
          <div className="shrink-0 px-2 border-r mr-2">
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
        )}
        <div className={cn("flex items-center flex-nowrap", fullWidth && "flex-1", alignStyles[align])}>
          {tabs.map((_, i) => (
            <div
              key={i}
              className={cn(
                "relative flex items-center justify-center font-medium",
                sizeStyles[size].tab,
                radiusStyles[tabRadius],
                align === "grow" && "flex-1"
              )}
            >
              <Skeleton className={cn(sizeStyles[size].skeleton, "rounded")} />
            </div>
          ))}
        </div>
        {hasRightSection && (
          <div className="shrink-0 px-2 border-l ml-2">
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        )}
      </div>
    </div>
  );
}

