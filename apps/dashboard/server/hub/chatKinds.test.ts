import { describe, expect, it } from "vitest";
import { normalizeChatKind, VALID_CHAT_KINDS } from "./chatKinds";

describe("normalizeChatKind", () => {
  it("keeps voice", () => {
    expect(normalizeChatKind("voice")).toBe("voice");
    expect(VALID_CHAT_KINDS.has("voice")).toBe(true);
  });

  it("keeps existing kinds", () => {
    expect(normalizeChatKind("text")).toBe("text");
    expect(normalizeChatKind("location")).toBe("location");
    expect(normalizeChatKind("system")).toBe("system");
  });

  it("falls back to text for unknown or non-string values", () => {
    expect(normalizeChatKind("nope")).toBe("text");
    expect(normalizeChatKind(1)).toBe("text");
    expect(normalizeChatKind(undefined)).toBe("text");
  });
});
