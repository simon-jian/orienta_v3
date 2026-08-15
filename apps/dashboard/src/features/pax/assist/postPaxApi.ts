import { apiUrl } from "../../../config/api";
import type { PaxSession } from "../session";

export function postPaxApi(
  session: PaxSession,
  path: string,
  body: Record<string, unknown>,
  opts?: { method?: string; keepalive?: boolean },
): Promise<Response> {
  return fetch(apiUrl(path), {
    method: opts?.method || "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({
      tenantId: session.passenger.tenantId,
      passengerId: session.passenger.id,
      ...body,
    }),
    keepalive: opts?.keepalive,
  });
}

/** Fire-and-forget helper for heartbeats / trajectory fallbacks. */
export function postPaxFallback(
  session: PaxSession,
  path: string,
  body: Record<string, unknown>,
): void {
  void postPaxApi(session, path, body, { keepalive: true }).catch(() => {});
}
