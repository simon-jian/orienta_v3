import { describe, expect, it } from "vitest";
import { isLoopbackHttpUrl, isLoopbackHostname } from "./upstreamUrl";

describe("isLoopbackHostname", () => {
  it("detects common loopback forms", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("host.docker.internal")).toBe(false);
    expect(isLoopbackHostname("map.example.com")).toBe(false);
  });
});

describe("isLoopbackHttpUrl", () => {
  it("parses http(s) URLs", () => {
    expect(isLoopbackHttpUrl("http://127.0.0.1:7801")).toBe(true);
    expect(isLoopbackHttpUrl("http://host.docker.internal:7801")).toBe(false);
    expect(isLoopbackHttpUrl("")).toBe(false);
    expect(isLoopbackHttpUrl("not-a-url")).toBe(false);
  });
});
