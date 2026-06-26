import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev server proxies all API/WS calls to the Express backend
      "/api":                  "http://localhost:5175",
      "/ws":                   { target: "ws://localhost:5175", ws: true },
      "/indoor-map":           "http://localhost:5175",
      "/indoor-map-api":       "http://localhost:5175",
      "/pdr-api":              "http://localhost:5175",
      "/flight":               "http://localhost:5175",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
