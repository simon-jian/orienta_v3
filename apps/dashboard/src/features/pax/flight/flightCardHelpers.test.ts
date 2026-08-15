import { describe, expect, it } from "vitest";
import { boardsAndDoors, shortLocalClock, statusTone } from "./flightCardHelpers";
import type { FlightInstance } from "../api/flightApi";

const base: FlightInstance = {
  flight_iata: "UA889",
  dep_iata: "PEK",
  arr_iata: "SFO",
  dep_time_local: "2026-08-10 17:15",
  arr_time_local: "2026-08-10 13:40",
  dep_terminal: "T3",
  dep_gate: "E19",
  arr_terminal: "I",
  arr_gate: "A1",
  status: "Scheduled",
  origin_timezone: "Asia/Shanghai",
  scheduled_out_utc: "2026-08-10T09:15:00Z",
};

describe("flightCardHelpers", () => {
  it("tones delay status as warn", () => {
    expect(statusTone("Delayed")).toBe("warn");
  });

  it("estimates boards/doors from scheduled out", () => {
    const { boards, doors } = boardsAndDoors(base);
    expect(boards).not.toBe("N/A");
    expect(doors).not.toBe("N/A");
  });

  it("honors journey override for boards", () => {
    const { boards } = boardsAndDoors(base, { boards: "4:35 PM" });
    expect(boards).toBe("4:35 PM");
  });

  it("shortens local boarding labels", () => {
    expect(shortLocalClock("Aug 10, 4:40 PM")).toBe("4:40 PM");
  });
});
