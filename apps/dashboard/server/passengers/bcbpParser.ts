export type BcbpLeg = {
  pnr: string;
  fromAirport: string;
  toAirport: string;
  carrier: string;
  flightNumber: string;
  flightId: string;
  julianDate: string;
  compartment: string;
  seatNumber: string;
  sequenceNumber: string;
  passengerStatus: string;
};

export type ParsedBcbp = {
  formatCode: string;
  passengerName: string;
  electronicTicketIndicator: string;
  legs: BcbpLeg[];
};

function cleanFlightNumber(raw: string): string {
  const n = raw.trim().replace(/^0+/, "");
  return n || raw.trim();
}

function parseLeg(raw: string): BcbpLeg | null {
  if (raw.length < 35) return null;
  const pnr = raw.slice(0, 7).trim();
  const fromAirport = raw.slice(7, 10).trim();
  const toAirport = raw.slice(10, 13).trim();
  const carrier = raw.slice(13, 16).trim();
  const flightNumberRaw = raw.slice(16, 21);
  const flightNumber = cleanFlightNumber(flightNumberRaw);
  const flightId = `${carrier}${flightNumber}`.replace(/\s+/g, "").toUpperCase();
  return {
    pnr,
    fromAirport,
    toAirport,
    carrier,
    flightNumber,
    flightId,
    julianDate: raw.slice(21, 24).trim(),
    compartment: raw.slice(24, 25).trim(),
    seatNumber: raw.slice(25, 29).trim(),
    sequenceNumber: raw.slice(29, 34).trim(),
    passengerStatus: raw.slice(34, 35).trim(),
  };
}

/**
 * Parse the mandatory section of an IATA BCBP boarding-pass barcode.
 *
 * This intentionally returns only fields Orienta needs to create a trip session.
 * Airline-specific conditional fields can be added later without changing callers.
 */
export function parseBcbp(payload: string): ParsedBcbp {
  const raw = payload.replace(/\r?\n/g, "").trimEnd();
  if (!raw.startsWith("M") || raw.length < 60) {
    throw new Error("invalid_bcbp_format");
  }

  const legCount = Number.parseInt(raw.slice(1, 2), 10);
  if (!Number.isFinite(legCount) || legCount < 1) {
    throw new Error("invalid_bcbp_leg_count");
  }

  const passengerName = raw.slice(2, 22).trim();
  const electronicTicketIndicator = raw.slice(22, 23).trim();
  const legs: BcbpLeg[] = [];

  for (let i = 0; i < legCount; i += 1) {
    const start = 23 + i * 37;
    const leg = parseLeg(raw.slice(start, start + 37));
    if (leg) legs.push(leg);
  }

  if (legs.length === 0) throw new Error("missing_bcbp_legs");

  return {
    formatCode: raw.slice(0, 1),
    passengerName,
    electronicTicketIndicator,
    legs,
  };
}
