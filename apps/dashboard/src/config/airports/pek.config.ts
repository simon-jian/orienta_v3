/**
 * PEK (Beijing Capital, ICAO ZBAA) — T3E hub definition.
 *
 * The only hub today. Adding a hub means adding one definition + tenant mapping,
 * never new `if (airport === …)` branches across the codebase.
 */
import type { AirportDefinition } from "./types";

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
