"use client"

import { useState } from "react"
import { LoadingOverlay } from "@/components/ui/orecus.io/components/loading-overlay"
import { Button } from "@/components/ui/button"

export function Preview() {
  const [loading, setLoading] = useState(false)

  const handleClick = () => {
    setLoading(true)
    setTimeout(() => setLoading(false), 2000)
  }

  return (
    <div className="w-full space-y-8 p-4">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Interactive example */}
        <div className="relative min-h-[200px] rounded-lg border bg-card p-4">
          <div className="space-y-4">
            <h3 className="font-medium">Interactive Example</h3>
            <p className="text-sm text-muted-foreground">
              Click the button to see the loading overlay in action.
            </p>
            <Button onClick={handleClick}>
              Trigger Loading
            </Button>
          </div>
          <LoadingOverlay loading={loading} />
        </div>

        {/* Custom text example */}
        <div className="relative min-h-[200px] rounded-lg border bg-card p-4">
          <div className="space-y-4">
            <h3 className="font-medium">Custom Text</h3>
            <p className="text-sm text-muted-foreground">
              The overlay can display custom loading text.
            </p>
          </div>
          <LoadingOverlay text="Saving changes..." loading />
        </div>
      </div>
    </div>
  )
}
