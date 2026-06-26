import type { PaxSessionClaims } from "./paxSessionToken";
import { resolvePaxIdentity } from "./paxIdentity";

export type PaxWsIdentity = {
  tenantId: string;
  passengerId: string;
  claims: PaxSessionClaims | null;
};

/** Resolves passenger identity from a WebSocket hello frame. */
export async function resolvePaxWsHello(msg: Record<string, unknown>): Promise<
  { ok: true; identity: PaxWsIdentity } | { ok: false; reason: string }
> {
  const sessionToken = typeof msg.sessionToken === "string" ? msg.sessionToken.trim() : "";
  const resolved = await resolvePaxIdentity({
    authorizationHeader: sessionToken ? `Bearer ${sessionToken}` : undefined,
    tenantId: msg.tenantId,
    passengerId: msg.passengerId,
  });
  if (!resolved.ok) return { ok: false, reason: resolved.failure.error };
  return { ok: true, identity: resolved.identity };
}
