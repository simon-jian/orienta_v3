/** Ticket IATA → AeroAPI ICAO. Keep in sync with server/services/airlineIdents.ts. */
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

function parseFlightIdent(value: string): { airline: string; number: string } | null {
  const raw = value.trim().toUpperCase();
  const match = /^([A-Z]{2,3})(\d{1,4}[A-Z]?)$/.exec(raw);
  return match?.[1] && match[2] ? { airline: match[1], number: match[2] } : null;
}

/** CA985, CCA985, and ca985 are the same flight. */
export function sameFlightId(a?: string | null, b?: string | null): boolean {
  const left = String(a || "").trim().toUpperCase();
  const right = String(b || "").trim().toUpperCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const pa = parseFlightIdent(left);
  const pb = parseFlightIdent(right);
  if (!pa || !pb || pa.number !== pb.number) return false;
  const icaoA = IATA_TO_ICAO[pa.airline] || pa.airline;
  const icaoB = IATA_TO_ICAO[pb.airline] || pb.airline;
  return icaoA === icaoB;
}
