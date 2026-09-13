import { describe, expect, it } from "vitest";
import { incomingInviteAction, overlayErrorKind } from "./callSession";

describe("incomingInviteAction", () => {
  it("accepts the first invite", () => {
    expect(incomingInviteAction({
      currentCallId: null,
      incomingCallId: "b",
      currentPassengerId: null,
      incomingPassengerId: "pax1",
      ended: true,
      phase: "idle",
    })).toBe("accept");
  });

  it("replaces a same-passenger redial even if hangup is still in flight", () => {
    expect(incomingInviteAction({
      currentCallId: "a",
      incomingCallId: "b",
      currentPassengerId: "pax1",
      incomingPassengerId: "pax1",
      ended: false,
      phase: "in_call",
    })).toBe("replace");
  });

  it("rejects a different passenger while a live call is up", () => {
    expect(incomingInviteAction({
      currentCallId: "a",
      incomingCallId: "b",
      currentPassengerId: "pax1",
      incomingPassengerId: "pax2",
      ended: false,
      phase: "connecting",
    })).toBe("reject");
  });

  it("ignores a duplicate invite id", () => {
    expect(incomingInviteAction({
      currentCallId: "a",
      incomingCallId: "a",
      currentPassengerId: "pax1",
      incomingPassengerId: "pax1",
      ended: false,
      phase: "incoming",
    })).toBe("ignore");
  });
});

describe("overlayErrorKind", () => {
  it("does not collapse reject/timeout into a generic ICE failure", () => {
    expect(overlayErrorKind("rejected")).toBe("rejected");
    expect(overlayErrorKind("timeout")).toBe("timeout");
    expect(overlayErrorKind("failed")).toBe("failed");
    expect(overlayErrorKind("inuse")).toBe("inuse");
  });
});
