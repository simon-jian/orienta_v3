import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getStoredPaxSession,
  persistActiveLeg,
  resolveActiveLeg,
  savePaxSession,
  type PaxSession,
  type PaxTripContext,
} from "./session";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function installMemoryStorage() {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
}

describe("resolveActiveLeg", () => {
  it("defaults a transfer to the arrival tab", () => {
    const trip: PaxTripContext = { intent: "transfer", arrivalFlight: "CA836", departureFlight: "CA837" };
    expect(resolveActiveLeg(trip)).toBe("arr");
  });

  it("honors a stored departure tab", () => {
    expect(resolveActiveLeg({ intent: "transfer", activeLeg: "dep" })).toBe("dep");
  });

  it("maps single-flight intents", () => {
    expect(resolveActiveLeg({ intent: "arrive", flight: "UA888" })).toBe("arr");
    expect(resolveActiveLeg({ intent: "depart", flight: "UA888" })).toBe("dep");
  });
});

describe("persistActiveLeg", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the selected tab onto both the trip and the stored session", () => {
    installMemoryStorage();
    const trip: PaxTripContext = {
      intent: "transfer",
      arrivalFlight: "CA836",
      departureFlight: "CA837",
      activeLeg: "arr",
    };
    const session: PaxSession = {
      token: "t",
      passenger: {
        id: "P1",
        tenantId: "airchina",
        name: "Guest",
        plan: "free",
        flightId: "CA837",
        gateId: "E19",
      },
      accountType: "temporary",
      plan: "free",
      capabilities: [],
      expiresAt: Date.now() + 60_000,
      trip,
    };
    savePaxSession(session);
    persistActiveLeg(trip, "dep");
    expect(getStoredPaxSession()?.trip?.activeLeg).toBe("dep");
  });
});
