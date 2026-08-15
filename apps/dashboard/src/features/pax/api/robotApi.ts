import { apiUrl } from "../../../config/api";
import type { PaxSession } from "../session";
import type { RobotRequest, RobotServiceType } from "../assist/assistTypes";

async function readJson(res: Response): Promise<{
  ok?: boolean;
  request?: RobotRequest | null;
  error?: string;
}> {
  return (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    request?: RobotRequest | null;
    error?: string;
  };
}

export async function fetchRobotRequest(session: PaxSession): Promise<RobotRequest | null> {
  const res = await fetch(apiUrl("/api/pax/robot-request"), {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const data = await readJson(res);
  if (!res.ok || !data.ok) return null;
  return data.request || null;
}

export async function submitRobotRequest(
  session: PaxSession,
  input: {
    serviceType: RobotServiceType;
    partySize: number;
    origin: string;
    destination: string;
    note: string;
  },
): Promise<RobotRequest> {
  const res = await fetch(apiUrl("/api/pax/robot-request"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({
      tenantId: session.passenger.tenantId,
      passengerId: session.passenger.id,
      ...input,
    }),
  });
  const data = await readJson(res);
  if (!res.ok || !data.ok || !data.request) {
    throw new Error(data.error || `robot_request_failed_${res.status}`);
  }
  return data.request;
}

export async function cancelRobotRequest(session: PaxSession): Promise<void> {
  const res = await fetch(apiUrl("/api/pax/robot-request"), {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({
      tenantId: session.passenger.tenantId,
      passengerId: session.passenger.id,
    }),
  });
  const data = await readJson(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `robot_cancel_failed_${res.status}`);
  }
}
