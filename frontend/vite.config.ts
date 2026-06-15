import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: frontendRoot,
  plugins: [tanstackStart(), react(), tsconfigPaths(), tailwindcss()],
  server: {
    host: true,
    allowedHosts: ["newpointassist.algodel.com"],
    proxy: {
      // LoanPASS pricing is its own service (backend/pricing_app.py, default port
      // 8090) so it can be restarted independently. Must be listed BEFORE "/api"
      // so the more specific prefix wins.
      "/api/loanpass": {
        target: process.env.VITE_PRICING_PROXY_TARGET || "http://127.0.0.1:8090",
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
});
