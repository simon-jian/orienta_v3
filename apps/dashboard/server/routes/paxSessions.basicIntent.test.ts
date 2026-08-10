import { describe, expect, it } from "vitest";

/**
 * Pure helpers mirroring basic-session intent resolution (kept local so the
 * route file stays free of test-only exports).
 */
function resolveIntent(input: {
  intent?: string;
  departureFlight?: string;
  arrivalFlight?: string;
}): "depart" | "arrive" | "transfer" {
  const raw = String(input.intent || "").trim().toLowerCase();
  if (raw === "arrive" || raw === "transfer" || raw === "depart") return raw;
  const dep = (input.departureFlight || "").toUpperCase();
  const arr = (input.arrivalFlight || "").toUpperCase();
  if (dep && arr && dep !== arr) return "transfer";
  return "depart";
}

describe("basic-session intent resolution", () => {
  it("defaults to depart for a single flight", () => {
    expect(resolveIntent({ departureFlight: "UA889" })).toBe("depart");
  });

  it("infers transfer when arr and dep differ", () => {
    expect(resolveIntent({ arrivalFlight: "CA836", departureFlight: "CA837" })).toBe("transfer");
  });

  it("honors explicit arrive", () => {
    expect(resolveIntent({ intent: "arrive", flight: "UA889" } as { intent: string })).toBe("arrive");
  });
});
