import fs from "fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { Request } from "express";

function fakeReq(headers: Record<string, string>, protocol = "http"): Request {
  return { headers, protocol } as unknown as Request;
}

async function loadPublicOrigin(publicBaseUrl?: string) {
  vi.resetModules();
  // Isolate tests from a leftover `start_pax_trycloudflare.sh` sidecar on this machine.
  vi.stubEnv("ORIENTA_TUNNEL_URL_FILE", "/tmp/orienta-no-such-tunnel-url");
  if (publicBaseUrl === undefined) vi.stubEnv("PUBLIC_BASE_URL", "");
  else vi.stubEnv("PUBLIC_BASE_URL", publicBaseUrl);
  return (await import("./publicUrl")).publicOrigin;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicOrigin", () => {
  it("prefers the configured origin over request headers", async () => {
    const publicOrigin = await loadPublicOrigin("https://ops.example.com");
    // The header is what a Cloudflare tunnel → Vite → Express hop actually
    // leaves behind, and is exactly what must not end up in an emailed link.
    expect(publicOrigin(fakeReq({ host: "localhost:5173" }))).toBe("https://ops.example.com");
  });

  it("ignores a configured value that isn't an http(s) origin", async () => {
    const publicOrigin = await loadPublicOrigin("not a url");
    expect(publicOrigin(fakeReq({ host: "localhost:5173" }))).toBe("http://localhost:5173");
  });

  it("falls back to forwarded headers when unset", async () => {
    const publicOrigin = await loadPublicOrigin();
    expect(
      publicOrigin(fakeReq({ "x-forwarded-proto": "https", "x-forwarded-host": "tunnel.example.com", host: "localhost:5173" })),
    ).toBe("https://tunnel.example.com");
  });

  it("takes the first hop from a comma-joined forwarded header", async () => {
    const publicOrigin = await loadPublicOrigin();
    expect(
      publicOrigin(fakeReq({ "x-forwarded-proto": "https,http", "x-forwarded-host": "a.example.com,b.example.com" })),
    ).toBe("https://a.example.com");
  });

  it("uses the live trycloudflare sidecar over a stale boot-time tunnel URL", async () => {
    const sidecar = "/tmp/orienta-publicurl-test-sidecar.txt";
    fs.writeFileSync(sidecar, "https://train-cash-relate-bacon.trycloudflare.com\n");
    vi.resetModules();
    vi.stubEnv("ORIENTA_TUNNEL_URL_FILE", sidecar);
    vi.stubEnv("PUBLIC_BASE_URL", "https://smith-positions-cinema-jerusalem.trycloudflare.com");
    const { publicOrigin } = await import("./publicUrl");
    expect(publicOrigin(fakeReq({ host: "localhost:5173" }))).toBe(
      "https://train-cash-relate-bacon.trycloudflare.com",
    );
    fs.unlinkSync(sidecar);
  });

  it("uses the operator page they sent from, not PUBLIC_BASE_URL", async () => {
    const publicOrigin = await loadPublicOrigin("https://ops.example.com");
    expect(
      publicOrigin(
        fakeReq({
          host: "localhost:5175",
          origin: "http://192.168.0.23:5173",
          "x-orienta-page-origin": "http://192.168.0.23:5173",
        }),
      ),
    ).toBe("http://192.168.0.23:5173");
  });

  it("reads pageOrigin from the JSON body when the proxy drops headers", async () => {
    const publicOrigin = await loadPublicOrigin("https://ops.example.com");
    const req = fakeReq({ host: "localhost:5175" }) as Request & { body?: { pageOrigin: string } };
    req.body = { pageOrigin: "http://192.168.0.23:5173" };
    expect(publicOrigin(req)).toBe("http://192.168.0.23:5173");
  });

  it("ignores a forged public Origin that is not this deployment", async () => {
    const publicOrigin = await loadPublicOrigin("https://ops.example.com");
    expect(
      publicOrigin(fakeReq({ host: "localhost:5175", origin: "https://evil.example", "x-orienta-page-origin": "https://evil.example" })),
    ).toBe("https://ops.example.com");
  });
});
