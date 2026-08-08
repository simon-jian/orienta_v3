/**
 * Airport config schema (Multi-airport: data-driven hubs).
 *
 * Airport definitions live as data (YAML on the server, JSON over the bootstrap
 * API to the client). This zod schema validates that data and converts the
 * serializable form (regex patterns as strings) into a runtime
 * `AirportDefinition` (regex patterns compiled to `RegExp`). Adding a hub means
 * dropping a validated config file — no code changes, no hardcoded branches.
 */
import { z } from "zod";
import type { AirportDefinition } from "./types";

const latLng = z.object({ lat: z.number(), lng: z.number() });

const bbox = z.object({
  minLat: z.number(),
  maxLat: z.number(),
  minLng: z.number(),
  maxLng: z.number(),
});

export const airportConfigSchema = z.object({
  id: z.string().min(1),
  iata: z.string().min(1),
  icao: z.string().optional(),
  name: z.string().min(1),
  terminals: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  defaultTerminal: z.string().default(""),
  defaultGate: z.string().optional(),
  poi: z.object({
    mode: z.enum(["indoor_api", "static", "none"]),
    terminalQuery: z.string().optional(),
    parser: z.enum(["pek_t3e", "generic"]).default("generic"),
    staticGates: z.record(z.string(), latLng).optional(),
    defaultCenter: latLng,
    bbox: bbox.optional(),
    gatePattern: z.string().optional(),
    spawnRadiusM: z.number().optional(),
  }),
  map: z
    .object({ indoorMapEnabled: z.boolean().default(false), gatePattern: z.string().optional() })
    .default({ indoorMapEnabled: false }),
});

/** Serializable airport config (regex as strings) — YAML / JSON / API form. */
export type AirportConfigInput = z.input<typeof airportConfigSchema>;

export const tenantConfigSchema = z.object({
  id: z.string().min(1),
  airportId: z.string().min(1),
  displayName: z.string().min(1),
  features: z.record(z.string(), z.boolean()).optional(),
});

export type TenantConfigInput = z.input<typeof tenantConfigSchema>;

function toRegExp(src?: string): RegExp | undefined {
  return src ? new RegExp(src) : undefined;
}

/** Validate raw config (object from YAML/JSON) → runtime `AirportDefinition`. */
export function toAirportDefinition(raw: unknown): AirportDefinition {
  const c = airportConfigSchema.parse(raw);
  return {
    ...c,
    poi: { ...c.poi, gatePattern: toRegExp(c.poi.gatePattern) },
    map: { ...c.map, gatePattern: toRegExp(c.map.gatePattern) },
  } as AirportDefinition;
}

/** Runtime `AirportDefinition` → serializable form (for the bootstrap API). */
export function serializeAirport(def: AirportDefinition): AirportConfigInput {
  return {
    ...def,
    poi: { ...def.poi, gatePattern: def.poi.gatePattern?.source },
    map: { ...def.map, gatePattern: def.map.gatePattern?.source },
  } as AirportConfigInput;
}
