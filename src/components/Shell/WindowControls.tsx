import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minimize2, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { needsCustomWindowControls } from "../../lib/platform";

const BTN =
  "inline-flex items-center justify-center w-[46px] h-full hover:bg-accent transition-colors";
const CLOSE_BTN =
  "inline-flex items-center justify-center w-[46px] h-full hover:bg-red-500 transition-colors";

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
      <button className={BTN} onClick={handleMinimize} title="Minimize">
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <button
        className={BTN}
        onClick={handleToggleMaximize}
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <Minimize2 size={12} strokeWidth={1.5} />
        ) : (
          <Square size={12} strokeWidth={1.5} />
        )}
      </button>
      <button className={CLOSE_BTN} onClick={handleClose} title="Close">
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
