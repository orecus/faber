'use client';

import { useMotionValue } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type AnimationConfig, type AnimationResult, DEFAULT_TILT_CONFIG, DURATIONS, EASE } from '@/components/ui/orecus.io/lib/animation';
import { useReducedMotion } from '@/components/ui/orecus.io/lib/use-reduced-motion';
import { useWillChange } from '@/components/ui/orecus.io/lib/use-will-change';

import type { MotionProps, MotionStyle } from 'motion/react';

// Re-export types for convenience
export type { AnimationConfig, AnimationResult, AnimationStyle, TiltConfig } from '@/components/ui/orecus.io/lib/animation';

/**
 * Hook for handling card tilt and zoom animations.
 * Optimized for performance with hardware acceleration and transform batching.
 *
 * @example
 * ```tsx
 * const { motionProps, tiltRef } = useTiltAnimation({
 *   style: "tilt",
 *   tilt: { max: 10 }
 * });
 *
 * return (
 *   <motion.div ref={tiltRef} {...motionProps}>
 *     Card content
 *   </motion.div>
 * );
 * ```
 */
export function useTiltAnimation(config?: AnimationConfig): AnimationResult {
  const tiltRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<{ width: number; height: number; left: number; top: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const transitionTimeoutRef = useRef<number | null>(null);

  const prefersReducedMotion = useReducedMotion();
  const [isTiltActive, setIsTiltActive] = useState(false);

  // Manage will-change property lifecycle
  useWillChange(tiltRef, 'transform', isTiltActive && config?.style === 'tilt');

  // Merge tilt configuration with defaults
  const tiltConfig = useMemo(() => {
    if (!config?.tilt) return DEFAULT_TILT_CONFIG;
    return { ...DEFAULT_TILT_CONFIG, ...config.tilt };
  }, [config?.tilt]);

  // Motion values for direct manipulation
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const scale = useMotionValue(1);

  // Reset motion values when reduced motion is enabled
  useEffect(() => {
    if (prefersReducedMotion) {
      rotateX.set(0);
      rotateY.set(0);
      scale.set(1);

      if (tiltRef.current) {
        tiltRef.current.style.transform = '';
        tiltRef.current.style.transformStyle = '';
        tiltRef.current.style.transition = '';
      }
    }
  }, [prefersReducedMotion, rotateX, rotateY, scale]);

  // Update cached rect when element size changes
  const updateRect = useCallback(() => {
    if (!tiltRef.current) return;
    const rect = tiltRef.current.getBoundingClientRect();
    rectRef.current = {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    };
  }, []);

  // Handle mouse movement for tilt effect
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const rect = rectRef.current;
      if (!tiltRef.current || !rect || config?.style !== 'tilt') return;

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const rotateYValue = ((mouseX - rect.width / 2) / rect.width) * tiltConfig.max;
        const rotateXValue = -((mouseY - rect.height / 2) / rect.height) * tiltConfig.max;

        if (tiltRef.current && !tiltRef.current.style.transition) {
          tiltRef.current.style.transition = `transform ${tiltConfig.speed}ms cubic-bezier(${EASE.smooth.join(',')}), box-shadow ${tiltConfig.speed}ms cubic-bezier(${EASE.smooth.join(',')})`;
        }

        rotateX.set(rotateXValue);
        rotateY.set(rotateYValue);
        scale.set(tiltConfig.scale);
      });
    },
    [config?.style, tiltConfig, rotateX, rotateY, scale],
  );

  const handleMouseEnter = useCallback(
    (event: MouseEvent) => {
      if (!tiltRef.current || prefersReducedMotion) return;

      if (transitionTimeoutRef.current) {
        window.clearTimeout(transitionTimeoutRef.current);
      }

      setIsTiltActive(true);
      updateRect();
      handleMouseMove(event);
    },
    [handleMouseMove, updateRect, prefersReducedMotion],
  );

  const handleMouseLeave = useCallback(() => {
    const element = tiltRef.current;
    if (!element) return;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!prefersReducedMotion) {
      element.style.transition = `transform ${tiltConfig.speed}ms cubic-bezier(${EASE.smooth.join(',')}), box-shadow ${tiltConfig.speed}ms cubic-bezier(${EASE.smooth.join(',')})`;
    }

    rotateX.set(0);
    rotateY.set(0);
    scale.set(1);
    setIsTiltActive(false);

    if (!prefersReducedMotion) {
      transitionTimeoutRef.current = window.setTimeout(() => {
        if (element) element.style.transition = '';
      }, tiltConfig.speed);
    }
  }, [rotateX, rotateY, scale, tiltConfig.speed, prefersReducedMotion]);

  // Setup event listeners
  useEffect(() => {
    const element = tiltRef.current;
    if (!element || config?.style !== 'tilt' || prefersReducedMotion) return;

    element.style.transformStyle = 'preserve-3d';
    updateRect();

    const resizeObserver = new ResizeObserver(updateRect);

    element.addEventListener('mouseenter', handleMouseEnter, { passive: true });
    element.addEventListener('mousemove', handleMouseMove, { passive: true });
    element.addEventListener('mouseleave', handleMouseLeave, { passive: true });
    resizeObserver.observe(element);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (transitionTimeoutRef.current) window.clearTimeout(transitionTimeoutRef.current);
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mousemove', handleMouseMove);
      element.removeEventListener('mouseleave', handleMouseLeave);
      resizeObserver.disconnect();
    };
  }, [config?.style, handleMouseEnter, handleMouseLeave, handleMouseMove, updateRect, prefersReducedMotion]);

  // Build motion props based on animation style
  // Note: We use individual transform properties (rotateX, rotateY, scale) instead of
  // a combined transform string so Motion can merge them with entry animations (y, opacity, etc.)
  const motionProps: MotionProps = useMemo(() => {
    const baseProps: MotionProps = {
      ...config?.motionProps,
    };

    if (prefersReducedMotion) {
      return baseProps;
    }

    if (!config?.style || config?.style === 'none') {
      return baseProps;
    }

    if (config?.style === 'tilt') {
      return {
        ...baseProps,
        style: {
          ...baseProps.style,
          // Use individual properties so Motion can combine with entry animations
          rotateX,
          rotateY,
          scale,
          transformPerspective: tiltConfig.perspective,
          transformStyle: 'preserve-3d',
        } as MotionStyle,
      };
    }

    if (config?.style === 'zoom') {
      return {
        ...baseProps,
        whileHover: { scale: tiltConfig.scale },
        transition: { duration: DURATIONS.normal, ease: EASE.out },
      };
    }

    return baseProps;
  }, [config?.motionProps, config?.style, rotateX, rotateY, scale, tiltConfig.perspective, tiltConfig.scale, prefersReducedMotion]);

  return {
    motionProps,
    tiltRef: config?.style === 'tilt' ? tiltRef : undefined,
  };
}

/**
 * @deprecated Use useTiltAnimation instead
 */
export const useCardAnimation = useTiltAnimation;
