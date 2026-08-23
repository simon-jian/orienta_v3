import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBoard } from "./fidsService";

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      json: async () => body,
    })) as unknown as typeof fetch,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchBoard", () => {
  it("reports a rejected admin session as unauthenticated, not unconfigured", async () => {
    // A 401 used to surface as "set FLIGHTAWARE_API_KEY", which pointed
    // debugging at the provider key instead of the expired session.
    mockFetch(401, { ok: false, error: "not_authenticated" });
    expect(await fetchBoard("/api/fids/departures")).toEqual({
      status: "unauthenticated",
      flights: [],
    });
  });

  it("passes through a genuinely unconfigured provider", async () => {
    mockFetch(200, { status: "unconfigured", flights: [] });
    expect((await fetchBoard("/api/fids/departures")).status).toBe("unconfigured");
  });

  it("returns flights on success", async () => {
    mockFetch(200, { status: "ok", flights: [{ flight: "CA123", scheduledTime: "10:00", status: "On Time" }] });
    const result = await fetchBoard("/api/fids/departures", "PEK");
    expect(result.status).toBe("ok");
    expect(result.flights).toHaveLength(1);
  });

  it("treats an unrecognized payload as unavailable", async () => {
    mockFetch(200, { status: "weird" });
    expect(await fetchBoard("/api/fids/departures")).toEqual({ status: "unavailable", flights: [] });
  });
});
