import { describe, expect, it } from "vitest";
import {
  addMinutes,
  classifyScheduledCongestion,
  expectedFromRange,
  formatInTimeZone,
  isValidTimeZone,
  minutesBetween,
  narrowTotalRange,
  parseInstant,
  sumRanges,
} from "./timeHelpers";
import { CongestionLevel, EstimateConfidence } from "./types";

describe("timeHelpers", () => {
  it("uses absolute UTC instants across a day boundary", () => {
    const start = new Date("2026-01-01T23:50:00.000Z");
    const end = addMinutes(start, 25);
    expect(end.toISOString()).toBe("2026-01-02T00:15:00.000Z");
    expect(minutesBetween(start, end)).toBe(25);
  });

  it("formats IANA zones correctly across the US DST transition", () => {
    const before = formatInTimeZone(
      new Date("2026-03-08T06:30:00.000Z"),
      "America/New_York",
    );
    const after = formatInTimeZone(
      new Date("2026-03-08T07:30:00.000Z"),
      "America/New_York",
    );
    expect(before).toContain("01:30");
    expect(after).toContain("03:30");
  });

  it("validates zones, invalid dates, and range ordering", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(parseInstant("not-a-date")).toBeNull();
    expect(sumRanges([{ min: 5, max: 3 }, { min: -2, max: 4 }])).toEqual({
      min: 5,
      max: 9,
    });
  });

  it("uses exact weekday and weekend local congestion bands", () => {
    // Monday 05:00 and Saturday 09:00 in New York.
    expect(
      classifyScheduledCongestion(
        new Date("2026-08-03T09:00:00Z"),
        "America/New_York",
      ),
    ).toBe(CongestionLevel.Busy);
    expect(
      classifyScheduledCongestion(
        new Date("2026-08-08T13:00:00Z"),
        "America/New_York",
      ),
    ).toBe(CongestionLevel.Busy);
    expect(
      classifyScheduledCongestion(
        new Date("2026-08-08T08:59:00Z"),
        "America/New_York",
      ),
    ).toBe(CongestionLevel.Light);
  });

  it("escalates congestion one level and caps at very busy", () => {
    expect(
      classifyScheduledCongestion(
        new Date("2026-08-03T13:00:00Z"),
        "America/New_York",
        true,
      ),
    ).toBe(CongestionLevel.Busy);
    expect(
      classifyScheduledCongestion(
        new Date("2026-08-03T10:00:00Z"),
        "America/New_York",
        true,
      ),
    ).toBe(CongestionLevel.VeryBusy);
  });

  it("builds narrow totals around expected instead of summing all extremes", () => {
    expect(expectedFromRange({ min: 15, max: 30 })).toBe(23);
    const summed = sumRanges([
      { min: 0, max: 5 },
      { min: 15, max: 30 },
      { min: 5, max: 10 },
      { min: 5, max: 8 },
    ]);
    expect(summed).toEqual({ min: 25, max: 53 });
    const narrow = narrowTotalRange(41, summed ? [
      { min: 0, max: 5 },
      { min: 15, max: 30 },
      { min: 5, max: 10 },
      { min: 5, max: 8 },
    ] : [], EstimateConfidence.High, {
      journey: "gate",
      domestic: true,
      hasBags: false,
      international: false,
    });
    expect(narrow.max - narrow.min).toBeLessThanOrEqual(15);
    expect(narrow).toEqual({ min: 35, max: 47 });
  });

  it("keeps zero remaining journeys exact and preserves large dominant risk", () => {
    expect(
      narrowTotalRange(0, [], EstimateConfidence.High, {
        journey: "exit",
        domestic: true,
        hasBags: false,
        international: false,
      }),
    ).toEqual({ min: 0, max: 0 });
    const abnormal = narrowTotalRange(40, [{ min: 10, max: 50 }], EstimateConfidence.Low, {
      journey: "exit",
      domestic: false,
      hasBags: true,
      international: true,
    });
    expect(abnormal.max - abnormal.min).toBeGreaterThan(20);
  });
});
