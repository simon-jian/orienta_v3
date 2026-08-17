/**
 * Admin client for device-bound passenger invite links.
 *
 * The link secret is only ever present in the `url` returned by `createInvite`
 * — it is not stored in a readable form server-side, so a link that is lost
 * before it reaches the passenger has to be reissued rather than looked up.
 */
import { apiUrl } from "../../config/api";

export type InviteLeg = "inbound" | "outbound";

export type InviteFlightSnapshot = {
  depIata: string;
  arrIata: string;
  depTerminal: string;
  depGate: string;
  arrTerminal: string;
  arrGate: string;
  scheduledDepUtc: string | null;
  scheduledArrUtc: string | null;
  status: string;
};

/** Coarse description of the bound device — never the raw User-Agent. */
export type DeviceSummary = {
  os: string;
  osVersion: string;
  browser: string;
  isMobile: boolean;
};

export type PaxInvite = {
  inviteId: string;
  tenantId: string;
  passengerId: string;
  passengerName: string;
  flightId: string;
  flightDate: string;
  leg: InviteLeg;
  flight: InviteFlightSnapshot;
  deviceBound: boolean;
  deviceBoundAt: number | null;
  device: DeviceSummary | null;
  expiresAt: number;
  revokedAt: number | null;
  isActive: boolean;
  firstRedeemedAt: number | null;
  lastSeenAt: number | null;
  redeemCount: number;
  createdBy: string;
  createdAt: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "same-origin", ...init });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (!res.ok || !data.ok) throw new Error(data.error || `request_failed_${res.status}`);
  return data;
}

export function listInvites(tenantId: string): Promise<{ invites: PaxInvite[] }> {
  return request(`/api/pax/invites?tenant=${encodeURIComponent(tenantId)}`);
}

export function createInvite(input: {
  tenantId: string;
  passengerId: string;
  name?: string;
  flightId: string;
  flightDate: string;
  leg: InviteLeg;
}): Promise<{ invite: PaxInvite; url: string }> {
  return request("/api/pax/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function revokeInvite(inviteId: string): Promise<{ revoked: boolean }> {
  return request(`/api/pax/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

export function resetInviteDevice(inviteId: string): Promise<{ invite: PaxInvite }> {
  return request(`/api/pax/invites/${encodeURIComponent(inviteId)}/reset-device`, { method: "POST" });
}
