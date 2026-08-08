import { describe, expect, it } from "vitest";
import { indoorMapHealthStatus, pdrProxyHealthStatus } from "./dependencyHealth";

describe("indoorMapHealthStatus", () => {
  it("reports ok/unreachable for Mode B (external upstream)", () => {
    expect(
      indoorMapHealthStatus({ upstream: "http://map:7801", upstreamReachable: true, bundledTilesPresent: false }),
    ).toBe("ok");
    expect(
      indoorMapHealthStatus({ upstream: "http://map:7801", upstreamReachable: false, bundledTilesPresent: true }),
    ).toBe("unreachable");
  });

  it("reports bundled only when Mode A assets are actually on disk", () => {
    expect(
      indoorMapHealthStatus({ upstream: "", upstreamReachable: null, bundledTilesPresent: true }),
    ).toBe("bundled");
    expect(
      indoorMapHealthStatus({ upstream: "", upstreamReachable: null, bundledTilesPresent: false }),
    ).toBe("unavailable");
  });
});

describe("pdrProxyHealthStatus", () => {
  it("distinguishes disabled / ok / unreachable", () => {
    expect(pdrProxyHealthStatus({ origin: "", reachable: null })).toBe("disabled");
    expect(pdrProxyHealthStatus({ origin: "http://pdr:8000", reachable: true })).toBe("ok");
    expect(pdrProxyHealthStatus({ origin: "http://pdr:8000", reachable: false })).toBe("unreachable");
  });
});
