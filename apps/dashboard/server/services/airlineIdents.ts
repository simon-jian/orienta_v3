/**
 * AeroAPI `/flights/{ident}` wants an ICAO designator (CCA5285, UAL888).
 * Tickets and our admin form use IATA (CA5285, UA888). Querying the IATA
 * ident often returns an empty `flights` array even when FlightAware has
 * the same flight under the ICAO ident.
 */
const IATA_TO_ICAO: Record<string, string> = {
  CA: "CCA",
  UA: "UAL",
  SQ: "SIA",
  AA: "AAL",
  DL: "DAL",
  WN: "SWA",
  B6: "JBU",
  AS: "ASA",
  NK: "NKS",
  F9: "FFT",
  HA: "HAL",
  AC: "ACA",
  NH: "ANA",
  JL: "JAL",
  CX: "CPA",
  MU: "CES",
  CZ: "CSN",
  HU: "CHH",
  ZH: "CSZ",
  KA: "HDA",
  HX: "CRK",
  NX: "AMU",
  OZ: "AAR",
  KE: "KAL",
  LH: "DLH",
  LX: "SWR",
  OS: "AUA",
  SN: "BEL",
  BA: "BAW",
  VS: "VIR",
  AF: "AFR",
  KL: "KLM",
  IB: "IBE",
  AY: "FIN",
  SK: "SAS",
  TK: "THY",
  EK: "UAE",
  QR: "QTR",
  EY: "ETD",
  QF: "QFA",
  NZ: "ANZ",
  TG: "THA",
  VN: "HVN",
  GA: "GIA",
  MH: "MAS",
  CI: "CAL",
  BR: "EVA",
  AM: "AMX",
  AV: "AVA",
  LA: "LAN",
  CM: "CMP",
  ET: "ETH",
  MS: "MSR",
  SA: "SAA",
  AI: "AIC",
};

/** IATA airline + number, e.g. CA5285 / UA888. Does not match ICAO CCA5285. */
const IATA_DESIGNATOR = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/;

export function icaoFlightIdent(ident: string): string | undefined {
  const match = IATA_DESIGNATOR.exec(ident);
  const airline = match?.[1];
  const number = match?.[2];
  if (!airline || !number) return undefined;
  const icao = IATA_TO_ICAO[airline];
  return icao ? `${icao}${number}` : undefined;
}

/** ICAO first so a CA* lookup hits FlightAware in one call when the map knows the airline. */
export function aeroApiIdentCandidates(ident: string): string[] {
  const icao = icaoFlightIdent(ident);
  if (icao && icao !== ident) return [icao, ident];
  return [ident];
}
