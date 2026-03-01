import * as React from 'react';

import { Button as ShadcnButton, type buttonVariants } from '@/components/ui/button';
// Import shared color utilities
import { type ThemeColor, colorStyles, solidColorGradients } from '@/components/ui/orecus.io/lib/color-utils';
import { Spinner } from '@/components/ui/spinner';

import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

type ShadcnButtonProps = React.ComponentProps<typeof ShadcnButton> & VariantProps<typeof buttonVariants>;

// ============================================================================
// Gradient Variant Styles
// ============================================================================

const getGradientButtonStyles = (color: ThemeColor) => {
  const colorStyle = colorStyles[color];
  return cn('bg-linear-to-r', colorStyle.gradient, 'border', colorStyle.border, colorStyle.text, 'will-change-transform', 'transform-gpu');
};

// ============================================================================
// Color (Flat/Solid) Variant Styles
// ============================================================================

const getColorButtonStyles = (color: ThemeColor) => {
  const colorStyle = colorStyles[color];
  // Uses bg-linear-to-r with identical from/to stops from solidColorGradients to render as
  // background-image, which layers above ghost variant's hover:bg-muted (background-color)
  return cn('bg-linear-to-r', solidColorGradients[color], 'hover:brightness-110', 'border', colorStyle.border, colorStyle.text, 'will-change-transform', 'transform-gpu');
};

// ============================================================================
// Hover Effect Types & Styles
// ============================================================================

export type HoverEffect = 'none' | 'scale' | 'glow' | 'scale-glow';
export type ClickEffect = 'none' | 'scale';

const getHoverEffectStyles = (effect: HoverEffect, color: ThemeColor) => {
  const colorStyle = colorStyles[color];

  switch (effect) {
    case 'none':
      return '';
    case 'scale':
      return cn('hover:scale-105', 'transition-all duration-450 ease-out');
    case 'glow':
      return cn('shadow-xl shadow-transparent', 'hover:brightness-110', colorStyle.hoverGlow, 'transition-[box-shadow,filter] duration-450 ease-out');
    case 'scale-glow':
      return cn('shadow-xl shadow-transparent', 'hover:brightness-110', colorStyle.hoverGlow, 'hover:scale-105', 'transition-[box-shadow,filter,transform,scale] duration-450 ease-out');
    default:
      return '';
  }
};

const getGlowStyles = (color: ThemeColor) => {
  const colorStyle = colorStyles[color];
  return cn('shadow-xl', colorStyle.glow, 'brightness-110');
};

const getClickEffectStyles = (effect: ClickEffect) => {
  switch (effect) {
    case 'none':
      return '';
    case 'scale':
      return 'active:scale-[0.98]';
    default:
      return '';
  }
};

// ============================================================================
// Component Types & Styles
// ============================================================================

/**
 * Extended Button component that wraps ShadCN's Button with additional functionality.
 *
 * @component
 * @example
 * ```tsx
 * <Button loading leftIcon={<Save />}>Save</Button>
 * <Button rightIcon={<ArrowRight />}>Next</Button>
 * <Button variant="glass">Glass Button</Button>
 * <Button variant="gradient" color="purple">Gradient Button</Button>
 * <Button variant="color" color="purple">Solid Color Button</Button>
 * <Button variant="gradient" hoverEffect="scale-glow">Premium Button</Button>
 * ```
 *
 * @param loading - Shows spinner and disables button when true
 * @param leftIcon - Icon to display before children (replaced by spinner when loading)
 * @param rightIcon - Icon to display after children
 * @param variant - Button variant, includes custom 'glass', 'gradient', and 'color' variants
 * @param color - Color for the gradient/color variant (default: 'primary')
 * @param hoverEffect - Hover animation effect: 'none', 'scale', 'glow', 'scale-glow' (default: 'none')
 * @param clickEffect - Click animation effect: 'none', 'scale' (default: 'none')
 * @param glow - Always show the glow effect, not just on hover. Useful for CTA buttons (default: false)
 */
export interface ButtonProps extends Omit<ShadcnButtonProps, 'variant'> {
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  variant?: ShadcnButtonProps['variant'] | 'glass' | 'gradient' | 'color';
  color?: ThemeColor;
  hoverEffect?: HoverEffect;
  clickEffect?: ClickEffect;
  glow?: boolean;
}

// Glass button styles for glassmorphism effect
const glassButtonStyles = cn(
  'bg-glass-bg',
  'backdrop-blur-lg',
  'ring-1 ring-foreground/15',
  'hover:bg-glass-bg-hover',
  'text-muted-foreground',
  'hover:text-foreground',
  'shadow-sm',
  'will-change-transform',
  'transform-gpu', // Force GPU compositing for macOS
);

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ loading = false, leftIcon, rightIcon, children, disabled, variant, color = 'primary', hoverEffect = 'scale', clickEffect = 'scale', glow = false, className, ...props }, ref) => {
  const isDisabled = disabled || loading;
  const renderLeftIcon = loading ? <Spinner className='size-4 animate-spin' /> : leftIcon;

  // Handle custom variants - pass 'ghost' to ShadcnButton as base, then apply custom styles
  const isGlassVariant = variant === 'glass';
  const isGradientVariant = variant === 'gradient';
  const isColorVariant = variant === 'color';
  const shadcnVariant = isGlassVariant || isGradientVariant || isColorVariant ? 'ghost' : variant;

  const customStyles = cn(disabled ? 'cursor-not-allowed' : 'cursor-pointer', isGlassVariant && glassButtonStyles, isGradientVariant && getGradientButtonStyles(color), isColorVariant && getColorButtonStyles(color), glow && getGlowStyles(color), getHoverEffectStyles(hoverEffect, color), getClickEffectStyles(clickEffect), className);

  return (
    <ShadcnButton ref={ref} disabled={isDisabled} aria-busy={loading || undefined} variant={shadcnVariant} className={customStyles} {...props}>
      <div className='flex items-center'>
        {renderLeftIcon && <span className={cn('flex items-center', children && 'mr-2')}>{renderLeftIcon}</span>}
        {children}
        {rightIcon && <span className='ml-2 flex items-center'>{rightIcon}</span>}
      </div>
    </ShadcnButton>
  );
});

Button.displayName = 'Button';

export { Button };
