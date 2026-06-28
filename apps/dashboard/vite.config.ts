import { defineConfig } from "vitest/config";
import type { Plugin, ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Vite dev: /route_site/ must serve public/route_site/index.html, not the React SPA fallback. */
function routeSiteDevIndex(): Plugin {
  return {
    name: "route-site-dev-index",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, _res: ServerResponse, next: () => void) => {
        const raw = req.url ?? "";
        const q = raw.indexOf("?");
        const pathname = q >= 0 ? raw.slice(0, q) : raw;
        const search = q >= 0 ? raw.slice(q) : "";
        if (pathname === "/route_site" || pathname === "/route_site/") {
          req.url = `/route_site/index.html${search}`;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), routeSiteDevIndex()],
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
    // config.ts crash-fails on missing required vars; provide dummies for unit tests.
    env: {
      JWT_SECRET: "test-secret",
      ADMIN_CREDENTIALS: "admin@test.com:test",
    },
  },
});
