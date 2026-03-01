"use client";

import { useEffect, useRef } from "react";

/**
 * Hook to manage will-change CSS property lifecycle.
 * Applies will-change before animation starts and removes it after completion.
 *
 * @param element - The element ref to apply will-change to (can be null)
 * @param property - The CSS property to optimize (e.g., 'transform', 'opacity')
 * @param isActive - Whether the animation is currently active
 * @param cleanupDelay - Delay in ms before removing will-change after animation completes (default: 100ms)
 *
 * @example
 * ```tsx
 * const [isAnimating, setIsAnimating] = useState(false);
 * const elementRef = useRef<HTMLDivElement>(null);
 *
 * useWillChange(elementRef, 'transform', isAnimating);
 *
 * return (
 *   <div ref={elementRef}>Content</div>
 * );
 * ```
 */
export function useWillChange<T extends HTMLElement>(
  element: React.RefObject<T | null> | null,
  property: string,
  isActive: boolean,
  cleanupDelay = 100
): void {
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!element?.current) return;

    const el = element.current;

    if (isActive) {
      // Clear any pending cleanup
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Apply will-change before animation starts
      el.style.willChange = property;
    } else {
      // Remove will-change after animation completes
      // Use a small delay to ensure animation has finished
      timeoutRef.current = window.setTimeout(() => {
        if (el) {
          el.style.willChange = "";
        }
        timeoutRef.current = null;
      }, cleanupDelay);
    }

    return () => {
      // Cleanup on unmount or when dependencies change
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (el?.style.willChange) {
        el.style.willChange = "";
      }
    };
  }, [element, property, isActive, cleanupDelay]);
}
