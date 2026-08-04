/**
 * Canonical-form helpers for identifiers that flow from request input into
 * storage/lookup keys — tenant/flight/gate ids. Without normalizing at the
 * boundary, "CA123" and "ca123" (or "airchina" and "AirChina") create
 * separate rows/keys for what a human would consider the same value, even
 * though tenant lookups themselves already normalize internally (see
 * src/config/tenants/registry.ts getTenant()) — the mismatch shows up one
 * level down, in the passenger registry/chat/metrics tables that partition
 * on the RAW string.
 */

/** Tenant ids are matched case-insensitively everywhere they're looked up (registry.ts); store/compare them lowercased too. */
export function canonicalTenantId(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Flight idents (e.g. "CA123") are conventionally uppercase with no internal whitespace. */
export function canonicalFlightId(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/** Gate ids (e.g. "E32") are conventionally uppercase with no internal whitespace. */
export function canonicalGateId(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}
