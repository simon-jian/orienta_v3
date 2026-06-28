import { apiUrl } from "./api";

// Prefixed with the deploy base (P1-9) so the iframe src / apiBase resolve under
// a sub-path. apiUrl() passes absolute http(s) env overrides through unchanged.
export const INDOOR_MAP_URL: string =
  apiUrl((import.meta.env.VITE_INDOOR_MAP_URL ?? "/indoor-map/airport-map.html").trim());

export const INDOOR_MAP_API_BASE: string =
  apiUrl((import.meta.env.VITE_INDOOR_MAP_API_BASE ?? "/indoor-map-api").trim());
