import { describe, expect, it } from "vitest";
import { estimateWalkingTime, haversineMeters } from "./geo";

describe("haversineMeters", () => {
  it("returns zero distance for identical points", () => {
    const point = { lat: 40.08, lng: 116.58 };
    expect(haversineMeters(point, point)).toBe(0);
  });

  it("matches the known great-circle distance for 1 degree of longitude at the equator (~111.19km)", () => {
    // A well-known reference value (Earth's meridian/equatorial circumference
    // divided by 360) — pins the formula and EARTH_RADIUS_METERS constant to
    // an actual physical distance, not just "some positive number".
    const meters = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(meters).toBeCloseTo(111194.93, 0);
  });

  it("matches the known great-circle distance for 1 degree of latitude (~111.19km, same as longitude at the equator)", () => {
    const meters = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(meters).toBeCloseTo(111194.93, 0);
  });

  it("is symmetric: distance(a, b) === distance(b, a)", () => {
    const a = { lat: 40.08, lng: 116.58 };
    const b = { lat: 40.081, lng: 116.581 };
    expect(haversineMeters(a, b)).toBe(haversineMeters(b, a));
  });

  it("computes the exact expected distance for a short indoor-scale hop", () => {
    const from = { lat: 40.08, lng: 116.58 };
    const to = { lat: 40.081, lng: 116.581 };
    expect(haversineMeters(from, to)).toBeCloseTo(140.01, 1);
  });
});

describe("estimateWalkingTime", () => {
  it("applies the default detour factor and walking speed to produce an exact meters/minutes pair", () => {
    const from: [number, number] = [40.08, 116.58];
    const to: [number, number] = [40.081, 116.581];
    // haversine(~140.01m) * default detourFactor(1.35) = ~189m,
    // 189m / default walkSpeed(1.25 m/s) / 60 = ~3 minutes.
    expect(estimateWalkingTime(from, to)).toEqual({ meters: 189, minutes: 3 });
  });

  it("actually uses the walkSpeedMetersPerSecond/detourFactor arguments, not just the defaults", () => {
    const from: [number, number] = [40.08, 116.58];
    const to: [number, number] = [40.081, 116.581];
    // No detour (1.0) and a brisker 2 m/s should both be reflected exactly.
    const result = estimateWalkingTime(from, to, 2, 1.0);
    expect(result).toEqual({ meters: 140, minutes: 1 });
  });

  it("returns zero for identical points regardless of speed/detour", () => {
    const point: [number, number] = [40.08, 116.58];
    expect(estimateWalkingTime(point, point)).toEqual({ meters: 0, minutes: 0 });
  });
});
