/**
 * Multi-airport registry — core types (Multi-airport Phase 0).
 *
 * A single `AirportDefinition` is the canonical, config-driven description of a
 * hub. Definitions are loaded at runtime from data config (`config/airports/*.yaml`
 * on the server; `/api/config/bootstrap` in the browser) and validated by
 * `schema.ts`. Adding a hub means dropping one config file + tenant mapping,
 * never new `if (airport === …)` branches across the codebase.
 */
import type { LatLng } from "../../types/types";

export type AirportId = string;

export type Bbox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type Terminal = {
  id: string;
  label: string;
};

/** A pair of gate codes (transfer from → to). */
export type GatePair = {
  from: string;
  to: string;
};

/** How gate/POI coordinates are sourced for an airport. */
export type PoiMode = "indoor_api" | "static" | "none";

export type AirportPoiConfig = {
  mode: PoiMode;
  /** Terminal query value for the indoor-map POI API (e.g. "T3E"). */
  terminalQuery?: string;
  /** Parser strategy for POI features. */
  parser: "pek_t3e" | "generic";
  /** Static gate → coordinate table (used when `mode === "static"`). */
  staticGates?: Record<string, LatLng>;
  /** Fallback center when live POI data is unavailable. */
  defaultCenter: LatLng;
  /** Fallback bounding box for clamping spawned/located passengers. */
  bbox?: Bbox;
  /** Regex a gate code must satisfy to be accepted from POI data. */
  gatePattern?: RegExp;
  /** Spawn radius (meters) around a gate for new passengers. */
  spawnRadiusM?: number;
};

export type AirportRouteSiteConfig = {
  /** route_site hub key (e.g. "PEK"). */
  hubKey: string;
  /** Optional URL for the externalized route_site config JSON (Phase 4). */
  configUrl?: string;
};

export type AirportVideoConfig = {
  /** Source CSV used by the merge worker. */
  csv: string;
  /** HTTP endpoint that triggers a merge (PEK alias retained for now). */
  mergeEndpoint: string;
};

export type AirportDefinition = {
  /** Canonical id, conventionally the IATA code (e.g. "PEK"). */
  id: AirportId;
  iata: string;
  icao?: string;
  name: string;
  terminals: Terminal[];
  defaultTerminal: string;
  poi: AirportPoiConfig;
  routeSite?: AirportRouteSiteConfig;
  map: {
    indoorMapEnabled: boolean;
    gatePattern?: RegExp;
  };
  video?: AirportVideoConfig;
};
