import { describe, expect, it } from "vitest";
import { normalizePdrOrigin } from "./config";

describe("normalizePdrOrigin", () => {
  it("strips trailing slashes and a mistaken /api suffix", () => {
    expect(normalizePdrOrigin("http://127.0.0.1:8000/")).toBe("http://127.0.0.1:8000");
    expect(normalizePdrOrigin("http://127.0.0.1:8000/api")).toBe("http://127.0.0.1:8000");
    expect(normalizePdrOrigin("http://127.0.0.1:8000/api/")).toBe("http://127.0.0.1:8000");
  });

  it("leaves a bare service root alone", () => {
    expect(normalizePdrOrigin("https://pdr.example.com")).toBe("https://pdr.example.com");
  });
});
