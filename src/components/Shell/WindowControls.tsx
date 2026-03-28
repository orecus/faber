import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minimize2, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { needsCustomWindowControls } from "../../lib/platform";

const BTN =
  "inline-flex items-center justify-center w-[46px] h-full hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
const CLOSE_BTN =
  "inline-flex items-center justify-center w-[46px] h-full hover:bg-red-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!needsCustomWindowControls()) return;

    const appWindow = getCurrentWindow();
    appWindow.isMaximized().then(setMaximized);

    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setMaximized);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMinimize = useCallback(() => {
    getCurrentWindow().minimize();
  }, []);

  const handleToggleMaximize = useCallback(() => {
    getCurrentWindow().toggleMaximize();
  }, []);

  const handleClose = useCallback(() => {
    getCurrentWindow().close();
  }, []);

  if (!needsCustomWindowControls()) return null;

  return (
    <div className="flex items-center h-full shrink-0">
      <button className={BTN} onClick={handleMinimize} aria-label="Minimize window" title="Minimize">
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <button
        className={BTN}
        onClick={handleToggleMaximize}
        aria-label={maximized ? "Restore window" : "Maximize window"}
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <Minimize2 size={12} strokeWidth={1.5} />
        ) : (
          <Square size={12} strokeWidth={1.5} />
        )}
      </button>
      <button className={CLOSE_BTN} onClick={handleClose} aria-label="Close window" title="Close">
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
