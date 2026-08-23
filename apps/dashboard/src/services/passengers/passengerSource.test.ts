import { afterEach, describe, expect, it, vi } from "vitest";
import { deletePassenger } from "./passengerSource";

function mockFetch(status: number): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => ({ ok: status >= 200 && status < 300, status }));
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deletePassenger", () => {
  it("targets the passenger route with the tenant and DELETE", async () => {
    const spy = mockFetch(200);
    expect(await deletePassenger("airchina", "PAX-1")).toEqual({ ok: true });

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/passengers/PAX-1");
    expect(url).toContain("tenant=airchina");
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("same-origin");
  });

  it("escapes ids that need it, so a slash cannot change the route", async () => {
    const spy = mockFetch(200);
    await deletePassenger("airchina", "PAX/../admin");
    expect(spy.mock.calls[0]?.[0]).toContain("PAX%2F..%2Fadmin");
  });

  // An ops seat can see the list but the server refuses the delete; the UI
  // needs to tell that apart from a passenger that is simply already gone.
  it("distinguishes forbidden, missing and failed", async () => {
    mockFetch(403);
    expect(await deletePassenger("airchina", "PAX-1")).toEqual({ ok: false, error: "forbidden" });
    mockFetch(404);
    expect(await deletePassenger("airchina", "PAX-1")).toEqual({ ok: false, error: "not_found" });
    mockFetch(500);
    expect(await deletePassenger("airchina", "PAX-1")).toEqual({ ok: false, error: "request_failed" });
  });

  it("reports a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(await deletePassenger("airchina", "PAX-1")).toEqual({ ok: false, error: "request_failed" });
  });
});
