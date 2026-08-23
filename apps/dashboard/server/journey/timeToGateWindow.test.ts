import { describe, expect, it } from "vitest";
import { estimateTimeToGate, localRange, uiPreferencesFromStored } from "./journeyEngineBridge";
import type { JourneyFlightInstance } from "./journeyFlight";
import type { JourneyPreferences } from "./JourneyStore";

/**
 * The "leave for the airport" window shown in the Time to Gate sheet must be
 * anchored to boarding time, not to `now`. The route used to build it as
 * `now … now + (range.max - range.min)`, which for a flight boarding the next
 * morning told the passenger to set off within the next half hour.
 */

/** Everything unanswered — the state a passenger is in before touching the sheet. */
const NO_PREFERENCES: JourneyPreferences = {
  flightIdentifier: "UA888",
  flightDate: "2026-08-23",
  checkedBags: null,
  departureSecurityLane: null,
  arrivalSeat: null,
  arrivalSeatZone: null,
  arrivalDestination: null,
  immigrationLane: null,
  createdAt: null,
  updatedAt: null,
};

function departureInHours(hours: number): JourneyFlightInstance {
  const dep = new Date(Date.now() + hours * 3_600_000);
  return {
    ident: "UA888",
    dep_iata: "SFO",
    arr_iata: "PEK",
    dep_terminal: "I",
    dep_gate: "G9",
    arr_terminal: "3",
    arr_gate: "",
    scheduled_out_utc: dep.toISOString(),
    scheduled_in_utc: new Date(dep.valueOf() + 12 * 3_600_000).toISOString(),
    estimated_out_utc: null,
    estimated_in_utc: null,
    status: "Scheduled",
    origin_timezone: "America/Los_Angeles",
    destination_timezone: "Asia/Shanghai",
  } as unknown as JourneyFlightInstance;
}

describe("time-to-gate terminal entry window", () => {
  it("anchors the window to boarding time, far from now for a next-day flight", () => {
    const instance = departureInHours(12);
    const now = new Date();
    const estimate = estimateTimeToGate(instance, uiPreferencesFromStored(NO_PREFERENCES), [], now);

    expect(estimate.targetGateArrival).toBeTruthy();
    expect(estimate.recommendedTerminalEntryStart).toBeTruthy();
    expect(estimate.recommendedTerminalEntryEnd).toBeTruthy();

    const start = new Date(estimate.recommendedTerminalEntryStart!).valueOf();
    const end = new Date(estimate.recommendedTerminalEntryEnd!).valueOf();
    const target = new Date(estimate.targetGateArrival!).valueOf();

    // Window sits before the target gate arrival by exactly the processing range.
    expect(Math.round((target - start) / 60_000)).toBe(estimate.range.max);
    expect(Math.round((target - end) / 60_000)).toBe(estimate.range.min);

    // And it is hours away, not "right now" — the regression this covers.
    expect(start - now.valueOf()).toBeGreaterThan(6 * 3_600_000);
  });

  it("formats the window in the origin timezone", () => {
    const instance = departureInHours(12);
    const estimate = estimateTimeToGate(instance, uiPreferencesFromStored(NO_PREFERENCES), [], new Date());
    const range = localRange(
      new Date(estimate.recommendedTerminalEntryStart!),
      new Date(estimate.recommendedTerminalEntryEnd!),
      instance.origin_timezone,
    );
    expect(range.timeZone).toBe("America/Los_Angeles");
    expect(range.start).toMatch(/^\d{4}-\d{2}-\d{2}, \d{2}:\d{2}$/);
  });
});
