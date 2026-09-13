export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "in_call";

export type IncomingInviteAction = "ignore" | "accept" | "replace" | "reject";

/**
 * One admin seat holds at most one live call. A new invite from the *same*
 * passenger replaces the previous one (they hung up and immediately redialed,
 * or the hangup frame is still in flight). A different passenger is rejected
 * only while a call is actually ringing or connected.
 */
export function incomingInviteAction(args: {
  currentCallId: string | null;
  incomingCallId: string;
  currentPassengerId: string | null;
  incomingPassengerId: string;
  ended: boolean;
  phase: CallPhase;
}): IncomingInviteAction {
  if (!args.incomingCallId) return "ignore";
  if (args.currentCallId === args.incomingCallId) return "ignore";
  if (!args.currentCallId || args.ended || args.phase === "idle") return "accept";
  if (args.currentPassengerId && args.currentPassengerId === args.incomingPassengerId) {
    return "replace";
  }
  if (
    args.phase === "incoming"
    || args.phase === "outgoing"
    || args.phase === "connecting"
    || args.phase === "in_call"
  ) {
    return "reject";
  }
  return "accept";
}

export function isLivePeerConnection(state: string | null | undefined): boolean {
  return state === "new" || state === "connecting" || state === "connected";
}

export type CallErrorKind =
  | "denied"
  | "insecure"
  | "unavailable"
  | "notfound"
  | "inuse"
  | "camera"
  | "rejected"
  | "timeout"
  | "failed";

export function overlayErrorKind(error: string | null): CallErrorKind | null {
  if (!error) return null;
  if (
    error === "denied"
    || error === "permission"
    || error === "insecure"
    || error === "unavailable"
    || error === "notfound"
    || error === "inuse"
    || error === "camera"
    || error === "rejected"
    || error === "timeout"
    || error === "failed"
  ) {
    return error === "permission" ? "denied" : error;
  }
  return "failed";
}
