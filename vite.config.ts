import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Terminal emulator — large, only needed by Sessions view
          "vendor-xterm": [
            "@xterm/xterm",
            "@xterm/addon-webgl",
            "@xterm/addon-canvas",
            "@xterm/addon-fit",
            "@xterm/addon-unicode11",
            "@xterm/addon-web-links",
          ],
          // Markdown + syntax highlighting — used by 3 views
          "vendor-markdown": ["streamdown", "@streamdown/code"],
          // UI/interaction libraries
          "vendor-ui": ["motion", "@dnd-kit/core", "cmdk", "lucide-react"],
          // React core — changes rarely, good cache target
          "vendor-react": ["react", "react-dom", "zustand"],
        },
      },
    },
  },

  clearScreen: false,
  optimizeDeps: {
    exclude: ["src-tauri"],
    entries: ["index.html"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    fs: {
      deny: ["src-tauri/target"],
    },
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/TODOS.md",
        "**/.agents/**",
        "**/.mcp.json",
        "**/.gemini/**",
        "**/.codex/**",
        "**/.claude/**",
        "**/scripts/**",
      ],
    },
  },
}));
