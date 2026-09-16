import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aeroApiSearchWindow, pickBestFlightAwareFlight } from "./flightAware";

// FLIGHTAWARE_API_KEY is read from process.env at module-load time (server/config.ts),
// so each test gets a fresh module instance via resetModules() + dynamic import
// after stubbing the env — otherwise the key would be permanently unset (or stuck
// from a previous test) for the lifetime of the test file.
async function importFreshWithApiKey() {
  vi.resetModules();
  vi.stubEnv("FLIGHTAWARE_API_KEY", "test-key");
  return import("./flightAware");
}

function flight(overrides: Record<string, unknown>) {
  return {
    status: "Scheduled",
    origin: { timezone: "America/New_York" },
    destination: { timezone: "America/Los_Angeles" },
    ...overrides,
  };
}

describe("aeroApiSearchWindow", () => {
  it("keeps a PEK 00:05 departure when the form date is the next local day", () => {
    const { start, end } = aeroApiSearchWindow("2026-09-15", new Date("2026-09-14T05:55:00Z"));
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    const landedRedEye = Date.parse("2026-09-13T16:05:00Z");
    const nextRedEye = Date.parse("2026-09-14T16:05:00Z");
    expect(startMs).toBeLessThanOrEqual(landedRedEye);
    expect(endMs).toBeGreaterThan(landedRedEye);
    expect(startMs).toBeLessThanOrEqual(nextRedEye);
    expect(endMs).toBeGreaterThan(nextRedEye);
  });

  it("does not ask AeroAPI more than two days ahead", () => {
    const now = new Date("2026-09-14T05:55:00Z");
    const { end } = aeroApiSearchWindow("2026-09-15", now);
    expect(Date.parse(end)).toBeLessThanOrEqual(now.getTime() + 2 * 86_400_000);
  });
});

describe("pickBestFlightAwareFlight", () => {
  it("selects the requested local departure date instead of the first provider result", () => {
    const selected = pickBestFlightAwareFlight(
      [
        flight({
          fa_flight_id: "UA2400-aug5",
          scheduled_out: "2026-08-05T22:10:00Z",
          gate_origin: null,
        }),
        flight({
          fa_flight_id: "UA2400-aug4",
          scheduled_out: "2026-08-04T22:10:00Z",
          gate_origin: "B23",
          baggage_claim: "6",
        }),
      ],
      { date: "2026-08-04", intent: "depart", now: Date.parse("2026-08-04T17:40:00Z") },
    );
    expect(selected?.fa_flight_id).toBe("UA2400-aug4");
    expect(selected?.gate_origin).toBe("B23");
  });

  it("uses destination-local arrival date for arrival searches", () => {
    const selected = pickBestFlightAwareFlight(
      [
        flight({ fa_flight_id: "previous-local-day", scheduled_in: "2026-08-04T06:30:00Z" }),
        flight({ fa_flight_id: "late", scheduled_in: "2026-08-05T06:30:00Z" }),
      ],
      { date: "2026-08-04", intent: "arrive", now: Date.parse("2026-08-04T17:40:00Z") },
    );
    expect(selected?.fa_flight_id).toBe("late");
  });

  it("returns null rather than silently choosing another date", () => {
    const selected = pickBestFlightAwareFlight(
      [flight({ scheduled_out: "2026-08-05T22:10:00Z" })],
      { date: "2026-08-04", intent: "depart" },
    );
    expect(selected).toBeNull();
  });
});

describe("fetchFlightAware circuit breaker", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("FLIGHTAWARE_API_KEY", "test-key");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("opens after enough consecutive provider failures and short-circuits without calling fetch", async () => {
    const { fetchFlightAware, flightAwareCircuitStatus } = await importFreshWithApiKey();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "upstream down",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    for (let i = 0; i < 5; i++) {
      await expect(fetchFlightAware("CA123")).rejects.toThrow();
    }
    expect(flightAwareCircuitStatus().open).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // Circuit now open: no additional network call for a 6th attempt.
    await expect(fetchFlightAware("CA123")).rejects.toThrow(/circuit open/i);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("a successful call resets the failure count", async () => {
    const { fetchFlightAware, flightAwareCircuitStatus } = await importFreshWithApiKey();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          flights: [{ operator_iata: "CA", flight_number: "123", origin: {}, destination: {} }],
        }),
      }) as unknown as typeof fetch;

    await expect(fetchFlightAware("CA123")).rejects.toThrow();
    await expect(fetchFlightAware("CA123")).rejects.toThrow();
    await expect(fetchFlightAware("CA123")).resolves.toBeDefined();
    expect(flightAwareCircuitStatus().consecutiveFailures).toBe(0);
  });

  it("falls back to the closest instance when the requested date is not in the window", async () => {
    const { fetchFlightAware } = await importFreshWithApiKey();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        flights: [
          {
            operator_iata: "UA",
            flight_number: "888",
            status: "Scheduled",
            scheduled_out: "2026-09-14T18:00:00Z",
            origin: { code_iata: "SFO", timezone: "America/Los_Angeles" },
            destination: { code_iata: "PEK", timezone: "Asia/Shanghai" },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const inst = await fetchFlightAware("UA888", { date: "2026-09-13", intent: "arrive" });
    expect(inst.flight_iata).toBe("UA888");
    expect(inst.arr_iata).toBe("PEK");
  });

  it("\"no flights found\" (a healthy API response) does not count as a circuit failure", async () => {
    const { fetchFlightAware, flightAwareCircuitStatus } = await importFreshWithApiKey();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ flights: [] }),
    }) as unknown as typeof fetch;

    for (let i = 0; i < 10; i++) {
      await expect(fetchFlightAware("ZZ0000")).rejects.toThrow(/no flights found/i);
    }
    expect(flightAwareCircuitStatus().open).toBe(false);
    expect(flightAwareCircuitStatus().consecutiveFailures).toBe(0);
  });

  it("queries the ICAO ident first so CA5285 hits FlightAware as CCA5285", async () => {
    const { fetchFlightAware } = await importFreshWithApiKey();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        flights: [
          {
            ident: "CCA5285",
            operator_iata: "CA",
            flight_number: "5285",
            status: "Arrived",
            scheduled_out: "2026-09-13T16:05:00Z",
            origin: { code_iata: "PEK", timezone: "Asia/Shanghai" },
            destination: { code_iata: "SIN", timezone: "Asia/Singapore" },
          },
        ],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const inst = await fetchFlightAware("CA5285", { date: "2026-09-15", intent: "depart" });
    expect(inst.dep_iata).toBe("PEK");
    expect(inst.arr_iata).toBe("SIN");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/flights/CCA5285?");
    expect(url).toContain("ident_type=designator");
    expect(url).not.toContain("/flights/CA5285?");
  });

  it("retries the IATA ident when the ICAO query is empty", async () => {
    const { fetchFlightAware } = await importFreshWithApiKey();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ flights: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          flights: [
            {
              operator_iata: "CA",
              flight_number: "5285",
              origin: { code_iata: "PEK", timezone: "Asia/Shanghai" },
              destination: { code_iata: "SIN", timezone: "Asia/Singapore" },
              scheduled_out: "2026-09-14T16:05:00Z",
            },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchFlightAware("CA5285")).resolves.toMatchObject({ dep_iata: "PEK" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/flights/CCA5285?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/flights/CA5285?");
  });

  it("a thrown network error (not just a bad HTTP status) also counts toward the circuit", async () => {
    const { fetchFlightAware, flightAwareCircuitStatus } = await importFreshWithApiKey();
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    for (let i = 0; i < 5; i++) {
      await expect(fetchFlightAware("CA123")).rejects.toThrow();
    }
    expect(flightAwareCircuitStatus().open).toBe(true);
  });
});
