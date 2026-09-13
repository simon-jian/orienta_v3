import { describe, expect, it } from "vitest";
import type { PassengerComputed, TransferInfo } from "../types/types";
import {
  defaultSmsTemplate,
  formatDepartureClock,
  formatDepartureClause,
  isAssignedGate,
  preferredGateLabel,
  resolveDepartureIso,
} from "./passenger-compute";

const NOW = Date.parse("2026-09-13T14:28:00Z");
const DEP_ISO = "2026-09-13T15:10:00Z"; // 42 minutes after NOW
const DEP_CLOCK = formatDepartureClock(DEP_ISO);

function transfer(overrides: Partial<TransferInfo> = {}): TransferInfo {
  return {
    direction: "intl_to_intl",
    urgency: "normal",
    inboundFlight: "CA985",
    inboundFrom: "SFO",
    inboundArr: "2026-09-13T12:00:00Z",
    outboundFlight: "CA986",
    outboundTo: "PEK",
    outboundDep: "",
    ...overrides,
  };
}

function pax(overrides: Partial<PassengerComputed> = {}): PassengerComputed {
  return {
    id: "P1",
    name: "Test Pax",
    nationality: "CN",
    locale: "en-US",
    needsWheelchair: false,
    plan: "premium",
    transfer: transfer(),
    flightId: "CA986",
    gateId: "E19",
    activity: "moving",
    location: { lat: 40.07, lng: 116.60 },
    extStatus: "green",
    etaMinutes: 8,
    status: "green",
    reason: "On track",
    ...overrides,
  };
}

describe("isAssignedGate", () => {
  it("accepts a real gate code", () => {
    expect(isAssignedGate("E19")).toBe(true);
    expect(isAssignedGate("G6")).toBe(true);
  });

  it("rejects empty and placeholder labels", () => {
    expect(isAssignedGate("")).toBe(false);
    expect(isAssignedGate("   ")).toBe(false);
    expect(isAssignedGate(undefined)).toBe(false);
    expect(isAssignedGate("—")).toBe(false);
    expect(isAssignedGate("-")).toBe(false);
    expect(isAssignedGate("?")).toBe(false);
    expect(isAssignedGate("UNKNOWN")).toBe(false);
    expect(isAssignedGate("unknown")).toBe(false);
    expect(isAssignedGate("TBD")).toBe(false);
  });

  it("is assigned when any of several labels is real", () => {
    expect(isAssignedGate("—", "E19")).toBe(true);
    expect(isAssignedGate("UNKNOWN", "")).toBe(false);
  });
});

describe("preferredGateLabel", () => {
  it("prefers a real name over a placeholder id", () => {
    expect(preferredGateLabel("E19", "UNKNOWN")).toBe("E19");
  });

  it("falls back to a real id when the name is a placeholder", () => {
    expect(preferredGateLabel("—", "G6")).toBe("G6");
  });

  it("returns empty when neither is assigned", () => {
    expect(preferredGateLabel("—", "UNKNOWN")).toBe("");
    expect(preferredGateLabel(undefined, "")).toBe("");
  });
});

describe("resolveDepartureIso / formatDepartureClause", () => {
  it("prefers passenger outboundDep over the flight board time", () => {
    expect(resolveDepartureIso(DEP_ISO, "2026-09-13T20:00:00Z")).toBe(DEP_ISO);
  });

  it("uses the flight board time when outboundDep is missing or invalid", () => {
    expect(resolveDepartureIso("", DEP_ISO)).toBe(DEP_ISO);
    expect(resolveDepartureIso("not-a-date", DEP_ISO)).toBe(DEP_ISO);
    expect(resolveDepartureIso(undefined, undefined)).toBeUndefined();
  });

  it("formats a future departure with a countdown", () => {
    expect(formatDepartureClause(DEP_ISO, NOW)).toBe(
      `Scheduled departure is ${DEP_CLOCK} (in about 42 minutes).`,
    );
  });

  it("uses singular minute when one minute remains", () => {
    const inOneMin = new Date(NOW + 60_000).toISOString();
    expect(formatDepartureClause(inOneMin, NOW)).toBe(
      `Scheduled departure is ${formatDepartureClock(inOneMin)} (in about 1 minute).`,
    );
  });

  it("omits the countdown after departure", () => {
    expect(formatDepartureClause(DEP_ISO, Date.parse("2026-09-13T16:00:00Z"))).toBe(
      `Scheduled departure is ${DEP_CLOCK}.`,
    );
  });

  it("returns empty when the clock is unknown", () => {
    expect(formatDepartureClause("", NOW)).toBe("");
    expect(formatDepartureClause("bogus", NOW)).toBe("");
    expect(formatDepartureClause(undefined, NOW)).toBe("");
  });
});

describe("defaultSmsTemplate", () => {
  it("uses gate + departure when both are known", () => {
    const text = defaultSmsTemplate(
      pax({ transfer: transfer({ outboundDep: DEP_ISO }) }),
      "E19",
      "CA986",
      undefined,
      NOW,
    );
    expect(text).toBe(
      `Orienta: Your flight CA986 departs from Gate E19. Please make your way to the gate. Scheduled departure is ${DEP_CLOCK} (in about 42 minutes).`,
    );
  });

  it("omits the time sentence when departure is unknown", () => {
    const text = defaultSmsTemplate(pax(), "E19", "CA986", undefined, NOW);
    expect(text).toBe("Orienta: Your flight CA986 departs from Gate E19. Please make your way to the gate.");
    expect(text).not.toMatch(/\?/);
    expect(text).not.toMatch(/check-in/i);
  });

  it("says the gate is unassigned and still includes departure when known", () => {
    const text = defaultSmsTemplate(
      pax({ gateId: "UNKNOWN", transfer: transfer({ outboundDep: DEP_ISO }) }),
      "",
      "CA986",
      undefined,
      NOW,
    );
    expect(text).toBe(
      `Orienta: Your flight CA986 does not have an assigned gate yet. Scheduled departure is ${DEP_CLOCK} (in about 42 minutes). We will update you when a gate is posted.`,
    );
  });

  it("asks the passenger to wait when gate and time are both unknown", () => {
    const text = defaultSmsTemplate(pax({ gateId: "UNKNOWN" }), "UNKNOWN", "CA986", undefined, NOW);
    expect(text).toBe(
      "Orienta: Your flight CA986 does not have an assigned gate yet. Please wait for a gate update.",
    );
    expect(text).not.toMatch(/\?/);
    expect(text).not.toMatch(/check-in/i);
  });

  it("keeps location-loss copy with the same gate opening", () => {
    const assigned = defaultSmsTemplate(pax({ extStatus: "lost" }), "E19", "CA986", undefined, NOW);
    expect(assigned).toBe(
      'Orienta: Your flight CA986 departs from Gate E19. We have lost your location. Please reply with your current position (e.g., "near E21 shopping area").',
    );

    const unassigned = defaultSmsTemplate(pax({ extStatus: "offline" }), "—", "CA986", undefined, NOW);
    expect(unassigned).toBe(
      'Orienta: Your flight CA986 does not have an assigned gate yet. We have lost your location. Please reply with your current position (e.g., "near E21 shopping area").',
    );
  });

  it("keeps urgent/red/yellow proceed-immediately copy without a fake check-in clock", () => {
    const urgent = defaultSmsTemplate(
      pax({ transfer: transfer({ urgency: "urgent", outboundDep: DEP_ISO }) }),
      "E19",
      "CA986",
      undefined,
      NOW,
    );
    expect(urgent).toBe(
      `Orienta: Your flight CA986 departs from Gate E19 — URGENT. Please proceed IMMEDIATELY to your gate. Do not stop. Scheduled departure is ${DEP_CLOCK} (in about 42 minutes).`,
    );

    const yellow = defaultSmsTemplate(
      pax({ status: "yellow", etaMinutes: 3 }),
      "E19",
      "CA986",
      undefined,
      NOW,
    );
    expect(yellow).toBe(
      "Orienta: Your flight CA986 departs from Gate E19. Please proceed IMMEDIATELY to your gate. Do not stop.",
    );
    expect(yellow).not.toMatch(/check-in/i);
    expect(yellow).not.toMatch(/\?/);
  });

  it("does not tell an unassigned urgent passenger to go to a specific gate", () => {
    const text = defaultSmsTemplate(
      pax({ status: "red", transfer: transfer({ urgency: "urgent" }) }),
      "TBD",
      "CA986",
      undefined,
      NOW,
    );
    expect(text).toBe(
      "Orienta: Your flight CA986 does not have an assigned gate yet — URGENT. Please proceed immediately to the terminal. We will update you when a gate is posted.",
    );
  });

  it("uses flight scheduledDep when outboundDep is empty, and never walk-ETA + 10", () => {
    const text = defaultSmsTemplate(pax({ etaMinutes: 8 }), "E19", "CA986", DEP_ISO, NOW);
    expect(text).toContain(`Scheduled departure is ${DEP_CLOCK} (in about 42 minutes).`);
    expect(text).not.toContain("18");
    expect(text).not.toMatch(/check-in/i);
  });
});
