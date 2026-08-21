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
  const pageOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const res = await fetch(apiUrl(path), {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(pageOrigin ? { "X-Orienta-Page-Origin": pageOrigin } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (!res.ok || !data.ok) throw new Error(data.error || `request_failed_${res.status}`);
  return data;
}

export type InviteDeliveryResult = {
  sent: boolean;
  to?: string;
  error?: string;
};

export function listInvites(tenantId: string): Promise<{
  invites: PaxInvite[];
  publicOrigin?: string;
  smsConfigured: boolean;
  emailConfigured: boolean;
  emailFromWarning?: boolean;
}> {
  return request(`/api/pax/invites?tenant=${encodeURIComponent(tenantId)}`);
}

function withPageOrigin<T extends Record<string, unknown>>(input: T): T & { pageOrigin?: string } {
  const pageOrigin = typeof window !== "undefined" ? window.location.origin : "";
  return pageOrigin ? { ...input, pageOrigin } : input;
}

export function createInvite(input: {
  tenantId: string;
  passengerId: string;
  name?: string;
  flightId: string;
  flightDate: string;
  leg: InviteLeg;
  phone?: string;
  email?: string;
}): Promise<{
  invite: PaxInvite;
  url: string;
  qrDataUrl?: string;
  publicOrigin?: string;
  smsConfigured: boolean;
  emailConfigured: boolean;
  emailFromWarning?: boolean;
  sms?: InviteDeliveryResult;
  email?: InviteDeliveryResult;
}> {
  return request("/api/pax/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withPageOrigin(input)),
  });
}

export function sendInviteSms(input: {
  inviteId: string;
  phone: string;
  url: string;
}): Promise<{ to: string }> {
  return request(`/api/pax/invites/${encodeURIComponent(input.inviteId)}/sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withPageOrigin({ phone: input.phone, url: input.url })),
  });
}

export function sendInviteEmail(input: {
  inviteId: string;
  email: string;
  url: string;
}): Promise<{ to: string }> {
  return request(`/api/pax/invites/${encodeURIComponent(input.inviteId)}/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withPageOrigin({ email: input.email, url: input.url })),
  });
}

export function revokeInvite(inviteId: string): Promise<{ revoked: boolean }> {
  return request(`/api/pax/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
}

export function eraseInvite(inviteId: string): Promise<{
  inviteRemoved: boolean;
  passengerRemoved: boolean;
}> {
  return request(`/api/pax/invites/${encodeURIComponent(inviteId)}/erase`, { method: "POST" });
}

export function eraseInactiveInvites(tenantId: string): Promise<{
  erased: number;
  passengersRemoved: number;
}> {
  return request(`/api/pax/invites/erase-inactive?tenant=${encodeURIComponent(tenantId)}`, {
    method: "POST",
  });
}

export function resetInviteDevice(inviteId: string): Promise<{ invite: PaxInvite }> {
  return request(`/api/pax/invites/${encodeURIComponent(inviteId)}/reset-device`, { method: "POST" });
}
