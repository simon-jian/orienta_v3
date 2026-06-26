/**
 * All resolved filesystem paths — single source of truth.
 *
 * Fixes issue M4: hard relative paths scattered through server.ts
 * (`path.join(__dirname, "../../airport-map.html")` etc.) that break
 * silently if the directory layout changes.
 */
import path from "node:path";

/**
 * Root of apps/dashboard/.
 * Source lives in server/; compiled output in dist-server/server/ — go up one or two levels.
 */
const dashboardRoot = path.resolve(
  __dirname,
  path.basename(path.resolve(__dirname, "..")) === "dist-server" ? "../.." : "..",
);

/** Built frontend assets (Vite output). */
export const DIST_DIR = path.join(dashboardRoot, "dist");

/** public/ directory (served directly by Vite in dev, copied to dist/ in prod). */
export const PUBLIC_DIR = path.join(dashboardRoot, "public");

/** Local airport-map.html (repo root, used when VITE_LOCAL_AIRPORT_MAP=1). */
export const REPO_AIRPORT_MAP_PATH = path.resolve(dashboardRoot, "../../../airport-map.html");

/** Bundled indoor map API JSON files (optional, used when INDOOR_MAP_API_UPSTREAM is unset). */
export const LOCAL_INDOOR_MAP_API_DIR = path.resolve(dashboardRoot, "../../indoor-map-api");

/** Bundled indoor map tile PNGs (optional, used when INDOOR_MAP_UPSTREAM is unset). */
export const LOCAL_INDOOR_MAP_TILES_DIR = path.resolve(dashboardRoot, "../../indoor-map-tiles");

/** Route-site CSV and video files (used by the PEK merged-video API endpoint). */
export const ROUTE_SITE_DIR = path.join(PUBLIC_DIR, "route_site");
export const PEK_CSV_PATH   = path.join(ROUTE_SITE_DIR, "PEK_gate_timestamp_full_with_E24_E36.csv");

/** Python concat script for PEK merged-video generation. */
export const PEK_VIDEO_CONCAT_SCRIPT = path.resolve(dashboardRoot, "../../../scripts/concat_pek_video_from_csv.py");
