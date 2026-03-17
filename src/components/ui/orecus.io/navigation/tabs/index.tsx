"use client";

import { motion } from "motion/react";
import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

// Import shared color utilities
import {
  colorStyles,
  glassStyles,
  gradientHexColors,
  invertedGlassStyles,
  radiusStyles as sharedRadiusStyles,
  solidColorGradients,
} from "@/components/ui/orecus.io/lib/color-utils";

import type {
  TabContentProps,
  TabItem,
  TabProps,
  TabsContextValue,
  TabsProps,
  TabsSize,
} from "./types";
import { cn } from "@/lib/utils";

// Re-export types
export type * from "./types";

// ============================================================================
// Style Mappings
// ============================================================================

const sizeStyles: Record<
  TabsSize,
  { container: string; tab: string; text: string; gap: string }
> = {
  sm: { container: "p-1", tab: "px-2.5 py-1", text: "text-xs", gap: "gap-1.5" },
  md: { container: "p-1", tab: "px-3.5 py-1.5", text: "text-sm", gap: "gap-2" },
  lg: {
    container: "p-1.5",
    tab: "px-5 py-2.5",
    text: "text-base",
    gap: "gap-2",
  },
};

// ============================================================================
// Context
// ============================================================================

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs compound components must be used within <Tabs>");
  }
  return context;
}

export { useTabsContext };

// ============================================================================
// Tabs.Tab Component
// ============================================================================

function Tab<T extends string = string>({
  value,
  icon,
  badge,
  color,
  disabled = false,
  className,
  children,
}: TabProps<T>) {
  const ctx = useTabsContext();

  // Register tab on mount
  useEffect(() => {
    ctx.registerTab({
      value,
      icon,
      badge,
      color,
      disabled,
      label: typeof children === "string" ? children : undefined,
    } as TabItem);
  }, [value, icon, badge, color, disabled, children, ctx]);

  const isActive = ctx.value === value;
  const activeColor = color || ctx.color;

  const handleClick = () => {
    if (!disabled) {
      ctx.onChange(value as string);
    }
  };

  // Check if we should use color crossfade animation
  // Only enabled when: animation is 'slide', indicatorVariant is 'gradient', AND colorCrossfade prop is true
  const useColorCrossfade =
    ctx.colorCrossfade &&
    ctx.animation === "slide" &&
    (!ctx.indicatorVariant || ctx.indicatorVariant === "gradient");

  // Get previous tab's color for crossfade
  const previousTab = ctx.previousValue
    ? ctx.tabs.find((t) => t.value === ctx.previousValue)
    : undefined;
  const previousColor = previousTab?.color || ctx.color;

  // Get hex colors for gradient animation
  const currentHex = gradientHexColors[activeColor];
  const previousHex = gradientHexColors[previousColor];

  const getIndicatorClassName = () => {
    const tabRadiusClass = sharedRadiusStyles[ctx.tabRadius];

    if (ctx.indicatorVariant === "glass") {
      return cn(
        "absolute inset-0 will-change-transform transform-gpu backdrop-blur-[12px]",
        ctx.invert
          ? "bg-glass-inverted-bg-hover ring-1 ring-foreground/15"
          : "bg-glass-bg-hover ring-1 ring-foreground/15",
        tabRadiusClass,
      );
    }

    if (ctx.indicatorVariant === "solid") {
      return cn(
        "absolute inset-0 will-change-transform transform-gpu",
        "bg-glass-solid ring-1 ring-foreground/15",
        tabRadiusClass,
      );
    }

    // "color" variant - flat solid background
    if (ctx.indicatorVariant === "color") {
      const colorStyle = colorStyles[activeColor];
      return cn(
        "absolute inset-0 will-change-transform transform-gpu",
        tabRadiusClass,
        `bg-linear-to-r ${solidColorGradients[activeColor]}`,
        `shadow-xl ${colorStyle.glow}`,
        `border ${colorStyle.border}`,
      );
    }

    // "gradient" variant (default) - colorful gradient
    // When using color crossfade, we apply gradient via style prop instead of classes
    if (useColorCrossfade) {
      const colorStyle = colorStyles[activeColor];
      return cn(
        "absolute inset-0",
        tabRadiusClass,
        `shadow-xl ${colorStyle.glow}`,
        `border ${colorStyle.border}`,
      );
    }

    const colorStyle = colorStyles[activeColor];
    return cn(
      "absolute inset-0",
      tabRadiusClass,
      `bg-linear-to-r ${colorStyle.gradient}`,
      `shadow-xl ${colorStyle.glow}`,
      `border ${colorStyle.border}`,
    );
  };

  // Get animated gradient style for color crossfade
  const getColorCrossfadeStyle = () => {
    if (!useColorCrossfade) return undefined;
    return {
      background: `linear-gradient(to right, ${currentHex.start}cc, ${currentHex.end})`,
    };
  };

  const getColorCrossfadeInitialStyle = () => {
    if (!useColorCrossfade || !ctx.previousValue) return undefined;
    return {
      background: `linear-gradient(to right, ${previousHex.start}cc, ${previousHex.end})`,
    };
  };

  const getActiveTextClassName = () => {
    if (ctx.indicatorVariant === "glass" || ctx.indicatorVariant === "solid") {
      return "text-foreground/80";
    }
    // "gradient" and "color" variants both use themed text
    return colorStyles[activeColor].text;
  };

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      data-value={value}
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "relative flex items-center justify-center font-medium transition-colors duration-200 z-10 cursor-pointer",
        sizeStyles[ctx.size].tab,
        sizeStyles[ctx.size].text,
        sharedRadiusStyles[ctx.tabRadius],
        ctx.align === "grow" && "flex-1 text-center",
        disabled && "opacity-50 !cursor-not-allowed",
        isActive
          ? getActiveTextClassName()
          : "text-muted-foreground hover:text-foreground",
        ctx.tabClassName,
        className,
      )}
    >
      {/* Animated indicator */}
      {isActive && (
        <motion.div
          {...(ctx.animation === "slide"
            ? {
                layoutId: ctx.layoutId,
                initial: useColorCrossfade
                  ? getColorCrossfadeInitialStyle()
                  : undefined,
                animate: useColorCrossfade
                  ? getColorCrossfadeStyle()
                  : undefined,
                transition: {
                  type: "spring",
                  stiffness: 500,
                  damping: 35,
                  y: { duration: 0 },
                  // Smooth color transition
                  background: { duration: 0.3, ease: "easeOut" },
                },
              }
            : {
                initial: { opacity: 0, scale: 0.95 },
                animate: { opacity: 1, scale: 1 },
                transition: { duration: 0.25, ease: "easeOut" },
              })}
          className={getIndicatorClassName()}
        />
      )}

      {/* Tab content */}
      <span
        className={cn(
          "relative z-10 flex items-center justify-center",
          sizeStyles[ctx.size].gap,
        )}
      >
        {icon}
        {children}
        {badge}
      </span>
    </button>
  );
}

// ============================================================================
// Tabs.Content Component
// ============================================================================

function TabContent<T extends string = string>({
  value,
  forceMount = false,
  className,
  children,
}: TabContentProps<T>) {
  const ctx = useTabsContext();
  const isActive = ctx.value === value;

  if (!isActive && !forceMount) {
    return null;
  }

  return (
    <div
      role="tabpanel"
      data-state={isActive ? "active" : "inactive"}
      hidden={!isActive && forceMount}
      className={cn(isActive ? "block" : "hidden", className)}
    >
      {children}
    </div>
  );
}

// ============================================================================
// Main Tabs Component
// ============================================================================

function Tabs<T extends string = string>({
  value,
  onChange,
  onValueChange,
  fullWidth = false,
  animation = "fade",
  variant = "subtle",
  invert = false,
  shadow = "none",
  indicatorVariant,
  colorCrossfade = false,
  color = "primary",
  align = "center",
  leftSection,
  rightSection,
  size = "md",
  barRadius = "full",
  tabRadius = "full",
  className,
  tabClassName,
  children,
}: TabsProps<T>) {
  const [tabs, setTabs] = useState<TabItem<T>[]>([]);
  const generatedId = useId();
  const layoutId = `tabs-indicator-${generatedId}`;

  // Track previous value for color crossfade animation
  const previousValueRef = useRef<T | undefined>(undefined);
  const [previousValue, setPreviousValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    // Update previous value when current value changes
    if (previousValueRef.current !== value) {
      setPreviousValue(previousValueRef.current);
      previousValueRef.current = value;
    }
  }, [value]);

  const registerTab = useCallback((tab: TabItem<T>) => {
    setTabs((prev) => {
      // Don't add duplicates
      if (prev.find((t) => t.value === tab.value)) {
        return prev;
      }
      return [...prev, tab];
    });
  }, []);

  const handleChange = useCallback(
    (newValue: T) => {
      const callback = onValueChange ?? onChange;
      callback?.(newValue);
    },
    [onChange, onValueChange],
  );

  const contextValue: TabsContextValue<T> = {
    value,
    onChange: handleChange as (value: string) => void,
    animation,
    variant,
    invert,
    indicatorVariant,
    colorCrossfade,
    color,
    size,
    align,
    tabRadius,
    tabClassName,
    layoutId,
    tabs,
    registerTab: registerTab as (tab: TabItem<string>) => void,
    previousValue,
  };

  const getAlignClassName = () => {
    switch (align) {
      case "start":
        return "justify-start";
      case "end":
        return "justify-end";
      case "grow":
        return "";
      default:
        return "justify-center";
    }
  };

  // Extract Tab components for the bar, and TabContent for panels
  const tabElements: React.ReactNode[] = [];
  const contentElements: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      if (child.type === Tab) {
        tabElements.push(child);
      } else if (child.type === TabContent) {
        contentElements.push(child);
      }
    }
  });

  return (
    <TabsContext.Provider value={contextValue as unknown as TabsContextValue}>
      <div
        className={cn(
          fullWidth ? "flex flex-col w-full" : "inline-flex flex-col",
        )}
      >
        {/* Tab bar */}
        <div
          role="tablist"
          className={cn(
            "relative flex items-center will-change-transform transform-gpu",
            invert ? invertedGlassStyles[variant] : glassStyles[variant],
            variant !== "none" && "ring-1 ring-foreground/10",
            shadow !== "none" && `shadow-${shadow}`,
            sizeStyles[size].container,
            sharedRadiusStyles[barRadius],
            className,
          )}
        >
          {leftSection && (
            <div className="shrink-0 px-2 border-r mr-2">{leftSection}</div>
          )}
          <div
            className={cn(
              "flex items-center flex-nowrap",
              fullWidth && "flex-1",
              getAlignClassName(),
            )}
          >
            {tabElements}
          </div>
          {rightSection && (
            <div className="shrink-0 px-2 border-l ml-2">{rightSection}</div>
          )}
        </div>

        {/* Tab content panels */}
        {contentElements.length > 0 && (
          <div className="mt-4">{contentElements}</div>
        )}
      </div>
    </TabsContext.Provider>
  );
}

// ============================================================================
// Display Names
// ============================================================================

Tabs.displayName = "Tabs";
Tab.displayName = "Tabs.Tab";
TabContent.displayName = "Tabs.Content";

// ============================================================================
// Exports
// ============================================================================

const TabsWithCompounds = Object.assign(Tabs, {
  Tab,
  Content: TabContent,
});

export { TabsWithCompounds as Tabs };
