import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePaxOutboundChat } from "./chat";
import { HubStore } from "./HubStore";

describe("handlePaxOutboundChat voice notes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not trigger an AI reply for kind=voice", () => {
    vi.useFakeTimers();
    const store = new HubStore();
    store.setPaxMeta("airchina", "P1", { plan: "free" });
    const msg = handlePaxOutboundChat(store, "airchina", "P1", "note-id|8", "voice");
    expect(msg?.kind).toBe("voice");
    vi.advanceTimersByTime(2000);
    const kinds = store.getChatHistory("airchina", "P1").map((m) => m.kind);
    expect(kinds).toEqual(["voice"]);
  });

  it("still auto-replies to free-tier text", () => {
    vi.useFakeTimers();
    const store = new HubStore();
    store.setPaxMeta("airchina", "P1", { plan: "free" });
    handlePaxOutboundChat(store, "airchina", "P1", "hello", "text");
    vi.advanceTimersByTime(2000);
    const kinds = store.getChatHistory("airchina", "P1").map((m) => m.kind);
    expect(kinds).toContain("text");
    expect(kinds).toContain("ai_agent");
  });
});
