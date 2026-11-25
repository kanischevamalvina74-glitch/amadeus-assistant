import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
      },
      "/telegram": {
        target: "https://api.telegram.org",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/telegram/, ""),
      },
      "/ollama": {
        target: "http://127.0.0.1:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
    },
  },
});
