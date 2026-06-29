/**
 * PEK (Beijing Capital, ICAO ZBAA) — T3E hub definition (Multi-airport Phase 0).
 *
 * The only hub today. Demo flight / premium / gate data is re-used from the
 * existing canonical module `src/data/airports/pek.ts` so there is a single
 * source of truth (no copy-paste divergence).
 *
 * Geo fallbacks (center / bbox / spawn radius) mirror the literals currently in
 * `src/services/pekPoiCoords.ts` and `server/lib/poiCache.ts`. Those call sites
 * are repointed at this config in later phases; for Phase 0 the values are kept
 * in sync here so behaviour is identical.
 */
import type { AirportDefinition } from "./types";
import {
  PEK_OUTBOUND_FLIGHTS,
  PEK_INBOUND_FLIGHTS,
  PEK_FLIGHT_GATE_MAP,
  PEK_PREMIUM_IDS,
  PEK_DEFAULT_TRANSFER_GATES,
} from "../../data/airports/pek.demo";

export const PEK_AIRPORT: AirportDefinition = {
  id: "PEK",
  iata: "PEK",
  icao: "ZBAA",
  name: "Beijing Capital International Airport",
  terminals: [{ id: "T3E", label: "T3E · International" }],
  defaultTerminal: "T3E",

  poi: {
    mode: "indoor_api",
    terminalQuery: "T3E",
    parser: "pek_t3e",
    defaultCenter: { lat: 40.0748162, lng: 116.6061088 },
    bbox: { minLat: 40.0694, maxLat: 40.0800, minLng: 116.6008, maxLng: 116.6108 },
    gatePattern: /^E\d{1,2}$/,
    spawnRadiusM: 400,
  },

  demo: {
    outboundFlights: PEK_OUTBOUND_FLIGHTS,
    inboundFlights: PEK_INBOUND_FLIGHTS,
    premiumPassengerIds: PEK_PREMIUM_IDS,
    defaultTransferGates: {
      from: PEK_DEFAULT_TRANSFER_GATES.gateFrom,
      to: PEK_DEFAULT_TRANSFER_GATES.gateTo,
    },
    flightGateMap: PEK_FLIGHT_GATE_MAP,
  },

  routeSite: {
    hubKey: "PEK",
    configUrl: "/route_site/config/pek.json",
  },

  map: {
    indoorMapEnabled: true,
    gatePattern: /^E\d{1,2}$/,
  },

  video: {
    csv: "PEK_gate_timestamp_full_with_E24_E36.csv",
    mergeEndpoint: "/api/orienta/pek-merged-video",
  },
};
