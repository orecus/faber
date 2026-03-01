import { getCurrentWindow } from "@tauri-apps/api/window";

const ua = navigator.userAgent;

function isMacOS(): boolean {
  return ua.includes("Macintosh") || ua.includes("Mac OS");
}

export function needsCustomWindowControls(): boolean {
  return !isMacOS();
}

const INTERACTIVE =
  "button, input, a, select, textarea, [role=tab], [role=button], [role=menuitem], [role=option], [role=menu], [role=dialog], [data-slot^=dropdown], [data-no-drag]";

/** onMouseDown handler for custom title-bar regions. Initiates window drag
 *  unless the click landed on an interactive element or a popup is open. */
export function handleDragRegionMouseDown(e: React.MouseEvent) {
  if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
  // Don't start drag if any popover/menu/dialog is open — clicks may land
  // on transparent backdrop layers that visually overlay the drag region.
  if (document.querySelector("[role=menu], [role=dialog], [data-popup-open]")) return;
  e.preventDefault();
  getCurrentWindow().startDragging();
}
