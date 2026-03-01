import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

export interface LoadingOverlayProps {
  /** Text to display below the spinner */
  text?: string
  /** Whether the loading overlay is visible */
  loading?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Loading overlay component that displays a spinner with optional text.
 * Uses fade-in animation when appearing.
 * 
 * @example
 * ```tsx
 * <div className="relative">
 *   {content}
 *   <LoadingOverlay text="Loading..." loading={isLoading} />
 * </div>
 * ```
 */
export function LoadingOverlay({ 
  text = "Loading...",
  loading = false,
  className 
}: LoadingOverlayProps) {
  const [isVisible, setIsVisible] = useState(loading)

  useEffect(() => {
    if (loading) {
      setIsVisible(true)
    } else {
      const timer = setTimeout(() => setIsVisible(false), 200)
      return () => clearTimeout(timer)
    }
  }, [loading])

  if (!loading && !isVisible) return null

  return (
    <div 
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center rounded-lg",
        "bg-background/80 backdrop-blur-sm",
        loading ? "animate-in fade-in" : "animate-out fade-out",
        "duration-200 fill-mode-forwards",
        className
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        {text && <span className="text-sm text-muted-foreground">{text}</span>}
      </div>
    </div>
  )
}
