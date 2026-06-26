import { describe, expect, it } from "vitest";
import { estimateWalkingTime, haversineMeters } from "./geo";

describe("geo", () => {
  it("returns zero distance for identical points", () => {
    const point = { lat: 40.08, lng: 116.58 };
    expect(haversineMeters(point, point)).toBe(0);
  });

  it("estimates walking time with detour factor", () => {
    const from: [number, number] = [40.08, 116.58];
    const to: [number, number] = [40.081, 116.581];
    const result = estimateWalkingTime(from, to);
    expect(result.meters).toBeGreaterThan(0);
    expect(result.minutes).toBeGreaterThanOrEqual(0);
  });
});
