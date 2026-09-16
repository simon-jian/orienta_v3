import type { PaxInvite } from "./PaxInviteStore";

/** True when this invite carries a distinct inbound + outbound pair. */
export function isTransferInvite(invite: {
  flightId?: string;
  inboundFlight?: string | null;
}): boolean {
  const inbound = String(invite.inboundFlight || "").trim().toUpperCase();
  const outbound = String(invite.flightId || "").trim().toUpperCase();
  return !!inbound && !!outbound && inbound !== outbound;
}

/** SMS / email / list label: "CA836 / CA837" or a single flight. */
export function inviteFlightLabel(invite: {
  flightId?: string;
  inboundFlight?: string | null;
}): string {
  const outbound = String(invite.flightId || "").trim();
  if (isTransferInvite(invite)) {
    return `${String(invite.inboundFlight).trim()} / ${outbound}`;
  }
  return outbound;
}

export type InviteTrip = {
  intent: "depart" | "arrive" | "transfer";
  flight?: string;
  date?: string;
  arrivalFlight?: string;
  departureFlight?: string;
  arrivalDate?: string;
  departureDate?: string;
  activeLeg?: "arr" | "dep";
};

/** Session trip handed to the passenger app after redeem. */
export function tripFromInvite(invite: Pick<
  PaxInvite,
  "flightId" | "flightDate" | "leg" | "inboundFlight" | "inboundDate"
>): InviteTrip {
  if (isTransferInvite(invite)) {
    return {
      intent: "transfer",
      arrivalFlight: String(invite.inboundFlight).trim(),
      departureFlight: invite.flightId,
      arrivalDate: invite.inboundDate || invite.flightDate,
      departureDate: invite.flightDate,
      activeLeg: "arr",
    };
  }
  return {
    intent: invite.leg === "inbound" ? "arrive" : "depart",
    flight: invite.flightId,
    date: invite.flightDate,
    arrivalFlight: invite.leg === "inbound" ? invite.flightId : undefined,
    departureFlight: invite.leg === "outbound" ? invite.flightId : undefined,
  };
}

export function transferHubWarning(
  arrivalAirport: string,
  departureAirport: string,
): { arrivalAirport: string; departureAirport: string } | undefined {
  const arr = arrivalAirport.trim().toUpperCase();
  const dep = departureAirport.trim().toUpperCase();
  if (!arr || !dep || arr === dep) return undefined;
  return { arrivalAirport: arr, departureAirport: dep };
}
