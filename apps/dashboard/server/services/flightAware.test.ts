import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FLIGHTAWARE_API_KEY is read from process.env at module-load time (server/config.ts),
// so each test gets a fresh module instance via resetModules() + dynamic import
// after stubbing the env — otherwise the key would be permanently unset (or stuck
// from a previous test) for the lifetime of the test file.
async function importFreshWithApiKey() {
  vi.resetModules();
  vi.stubEnv("FLIGHTAWARE_API_KEY", "test-key");
  return import("./flightAware");
}

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

  it("a thrown network error (not just a bad HTTP status) also counts toward the circuit", async () => {
    const { fetchFlightAware, flightAwareCircuitStatus } = await importFreshWithApiKey();
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    for (let i = 0; i < 5; i++) {
      await expect(fetchFlightAware("CA123")).rejects.toThrow();
    }
    expect(flightAwareCircuitStatus().open).toBe(true);
  });
});
