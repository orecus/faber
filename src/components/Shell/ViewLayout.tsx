import { cn } from "../../lib/utils";

import type { HTMLAttributes } from "react";

function ViewLayoutRoot({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="main"
      className={cn(
        "flex flex-col px-3 py-2 gap-2 min-h-0 overflow-hidden bg-card/80",
        className,
      )}
      style={{ gridArea: "content" }}
      {...props}
    >
      {children}
    </div>
  );
}
ViewLayoutRoot.displayName = "ViewLayout";

function Toolbar({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-3 min-h-10 shrink-0 flex-wrap", className)}
      {...props}
    >
      {children}
    </div>
  );
}
Toolbar.displayName = "ViewLayout.Toolbar";

const ViewLayout = Object.assign(ViewLayoutRoot, { Toolbar });

export { ViewLayout };
