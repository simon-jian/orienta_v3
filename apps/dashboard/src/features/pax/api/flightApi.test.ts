import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTransfer } from "./flightApi";

describe("fetchTransfer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts arrival and departure dates", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { hub_airport: "PEK", arrival: {}, departure: {}, from_gate: "E19", to_gate: "E21" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = fetchTransfer("CA836", "CA837", {
      arrivalDate: "2026-09-13",
      departureDate: "2026-09-14",
    });
    const second = fetchTransfer("CA836", "CA837", {
      arrivalDate: "2026-09-13",
      departureDate: "2026-09-14",
    });
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      arrFlight: "CA836",
      depFlight: "CA837",
      arrDate: "2026-09-13",
      depDate: "2026-09-14",
    });
  });
});
