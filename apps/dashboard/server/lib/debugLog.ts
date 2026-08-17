/**
 * TEMPORARY debug instrumentation sink (session 1fdb4e).
 *
 * Appends straight to the workspace NDJSON log rather than POSTing to the debug
 * ingest server: that server dies with the IDE session, and when it did, a whole
 * walk's worth of evidence was silently dropped on the floor.
 *
 * Remove together with the instrumentation call sites.
 */
import { appendFile } from "node:fs";

const LOG_PATH = "/home/simon/orienta/orienta_v3/.cursor/debug-1fdb4e.log";

export function debugLog(payload: Record<string, unknown>): void {
  const line = JSON.stringify({ sessionId: "1fdb4e", timestamp: Date.now(), ...payload });
  appendFile(LOG_PATH, `${line}\n`, () => {});
}
