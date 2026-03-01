"use client";

import { useSyncExternalStore } from "react";

/**
 * Media query for detecting reduced motion preference.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Gets the current reduced motion preference.
 * Returns true if the user has enabled reduced motion.
 */
function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Server-side snapshot - defaults to full animations.
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Subscribes to changes in the reduced motion preference.
 */
function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", callback);
  return () => {
    mediaQuery.removeEventListener("change", callback);
  };
}

/**
 * Hook to detect if the user prefers reduced motion.
 * Uses `useSyncExternalStore` for React 18+ concurrent mode safety.
 *
 * @returns boolean indicating if reduced motion is preferred
 *
 * @example
 * ```tsx
 * import { useReducedMotion } from "@/components/ui/orecus.io/lib/use-reduced-motion";
 *
 * function AnimatedComponent() {
 *   const prefersReducedMotion = useReducedMotion();
 *
 *   return (
 *     <motion.div
 *       animate={prefersReducedMotion ? {} : { scale: 1.1 }}
 *     >
 *       Content
 *     </motion.div>
 *   );
 * }
 * ```
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
