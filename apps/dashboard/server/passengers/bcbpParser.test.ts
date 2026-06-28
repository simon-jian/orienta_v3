import { describe, expect, it } from "vitest";
import { parseBcbp } from "./bcbpParser";

// Hand-built single-leg IATA BCBP:
//   header(23): "M" + legCount "1" + name(20) + eticket "E"
//   leg(37):    pnr(7) from(3) to(3) carrier(3) flightNo(5) julian(3)
//               compartment(1) seat(4) sequence(5) status(1) extra(2)
const NAME = "DESMARAIS/LUC".padEnd(20, " ");
const LEG = "ABC123 " + "YUL" + "FRA" + "AC " + "00834" + "326" + "F" + "001A" + "00025" + "1" + "00";
const SAMPLE = `M1${NAME}E${LEG}`;

describe("parseBcbp", () => {
  it("parses the mandatory section of a single-leg pass", () => {
    const parsed = parseBcbp(SAMPLE);
    expect(parsed.formatCode).toBe("M");
    expect(parsed.passengerName).toBe("DESMARAIS/LUC");
    expect(parsed.legs).toHaveLength(1);
    const leg = parsed.legs[0]!;
    expect(leg.fromAirport).toBe("YUL");
    expect(leg.toAirport).toBe("FRA");
    expect(leg.carrier).toBe("AC");
    expect(leg.flightNumber).toBe("834"); // leading zeros stripped
    expect(leg.flightId).toBe("AC834");
    expect(leg.julianDate).toBe("326");
    expect(leg.seatNumber).toBe("001A");
  });

  it("rejects non-BCBP payloads", () => {
    expect(() => parseBcbp("not a boarding pass")).toThrow(/invalid_bcbp_format/);
  });

  it("rejects an empty payload", () => {
    expect(() => parseBcbp("")).toThrow();
  });
});
