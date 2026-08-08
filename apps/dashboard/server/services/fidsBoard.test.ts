import { afterEach, describe, expect, it, vi } from "vitest";

async function importFresh() {
  vi.resetModules();
  vi.stubEnv("FLIGHTAWARE_API_KEY", "test-key");
  // JWT etc. required by config for some import graphs — set safe defaults.
  vi.stubEnv("JWT_SECRET", "test-secret-at-least-32-chars-long!!");
  vi.stubEnv("ADMIN_CREDENTIALS", "admin@test.com:changeme");
  return import("./fidsBoard");
}

describe("fetchFidsBoard", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("returns unconfigured when no API key is set", async () => {
    vi.resetModules();
    vi.stubEnv("FLIGHTAWARE_API_KEY", "");
    vi.stubEnv("JWT_SECRET", "test-secret-at-least-32-chars-long!!");
    vi.stubEnv("ADMIN_CREDENTIALS", "admin@test.com:changeme");
    const { fetchFidsBoard } = await import("./fidsBoard");
    const r = await fetchFidsBoard("departures", "PEK");
    expect(r.status).toBe("unconfigured");
    expect(r.flights).toEqual([]);
  });

  it("maps AeroAPI scheduled_departures into board rows", async () => {
    const { fetchFidsBoard, clearFidsBoardCache } = await importFresh();
    clearFidsBoardCache();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        scheduled_departures: [
          {
            operator_iata: "CA",
            flight_number: "123",
            status: "Scheduled",
            scheduled_out: "2026-08-08T12:30:00Z",
            gate_origin: "E19",
            origin: { code_iata: "PEK", timezone: "Asia/Shanghai" },
            destination: { code_iata: "SHA", timezone: "Asia/Shanghai" },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const r = await fetchFidsBoard("departures", "PEK");
    expect(r.status).toBe("ok");
    expect(r.source).toBe("flightaware");
    expect(r.flights).toHaveLength(1);
    expect(r.flights[0]?.flight).toBe("CA123");
    expect(r.flights[0]?.destination).toBe("SHA");
    expect(r.flights[0]?.gate).toBe("E19");
  });

  it("returns unavailable on provider failure", async () => {
    const { fetchFidsBoard, clearFidsBoardCache } = await importFresh();
    clearFidsBoardCache();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "down",
    }) as unknown as typeof fetch;

    const r = await fetchFidsBoard("arrivals", "PEK");
    expect(r.status).toBe("unavailable");
    expect(r.flights).toEqual([]);
  });
});
