import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAppStore } from "./store/appStore";
import { useUpdateStore } from "./store/updateStore";
import { ptyBuffer } from "./lib/ptyBuffer";
import "./styles/main.css";

// Start capturing PTY output globally before React mounts.
// This ensures no output is lost even if Terminal components are unmounted.
ptyBuffer.init();

function StoreInitializer({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const cleanup = useAppStore.getState().initialize();
    const updateCleanup = useUpdateStore.getState().initialize();
    return () => {
      cleanup();
      updateCleanup();
    };
  }, []);
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <StoreInitializer>
        <App />
      </StoreInitializer>
    </ThemeProvider>
  </React.StrictMode>,
);
