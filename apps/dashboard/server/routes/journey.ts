/**
 * Passenger journey APIs: preferences, time-to-gate/exit, events, arrival share.
 * Authenticated routes require a passenger JWT whose flight matches the key.
 * Public arrival share uses shareId + public token only.
 */
import type { Router, Request, Response } from "express";
import { canonicalFlightId } from "../lib/canonicalize";
import { resolvePaxIdentity } from "../passengers/paxIdentity";
import type { JourneyStore } from "../journey/JourneyStore";
import { fetchJourneyFlight } from "../journey/journeyFlight";
import {
  destinationLabel,
  estimateTimeToExit,
  estimateTimeToGate,
  localRange,
  storedUpdateFromUiPatch,
  uiPreferencesFromStored,
  type UiCheckedBags,
  type UiDestination,
  type UiImmigration,
  type UiJourneyPreferences,
  type UiSeatZone,
  type UiSecurityLane,
} from "../journey/journeyEngineBridge";
import type { PassengerRegistry } from "../passengers/PassengerRegistry";

function apiError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ ok: false, error: code, message });
}

function normalizeFlightDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function keyFromRequest(req: Request): { flightIdentifier: string; flightDate: string } | null {
  const flightIdentifier = canonicalFlightId(req.params.flightKey || "");
  const flightDate = normalizeFlightDate(req.query.date);
  if (!flightIdentifier || !/^[A-Z0-9]{2,12}$/.test(flightIdentifier) || !flightDate) return null;
  return { flightIdentifier, flightDate };
}

function absoluteOrigin(req: Request): string {
  const proto = (String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0] ?? "https").trim();
  const host = (String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0] ?? "localhost").trim();
  return `${proto}://${host}`;
}

function validatePreferencesPatch(
  body: unknown,
): { patch: Partial<UiJourneyPreferences> } | { message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { message: "Request body must be a JSON object." };
  }
  const src = body as Record<string, unknown>;
  const patch: Partial<UiJourneyPreferences> = {};

  if ("checkedBags" in src) {
    const v = String(src.checkedBags);
    if (!["yes", "no", "unknown"].includes(v)) return { message: "Invalid checkedBags." };
    patch.checkedBags = v as UiCheckedBags;
  }
  if ("securityLane" in src) {
    const v = String(src.securityLane);
    if (!["standard", "trusted", "precheck", "priority", "unknown"].includes(v)) {
      return { message: "Invalid securityLane." };
    }
    patch.securityLane = (v === "precheck" ? "trusted" : v) as UiSecurityLane;
  }
  if ("seatZone" in src) {
    const v = String(src.seatZone);
    if (!["front", "middle", "rear", "unknown"].includes(v)) return { message: "Invalid seatZone." };
    patch.seatZone = v as UiSeatZone;
  }
  if ("destination" in src) {
    const v = String(src.destination);
    if (!["curbside", "rideshare", "transit", "parking", "unknown"].includes(v)) {
      return { message: "Invalid destination." };
    }
    patch.destination = v as UiDestination;
  }
  if ("immigration" in src) {
    const v = String(src.immigration);
    if (
      !["not-required", "citizen-resident", "visitor", "global-entry", "unknown"].includes(v)
    ) {
      return { message: "Invalid immigration." };
    }
    patch.immigration = v as UiImmigration;
  }
  return { patch };
}

async function requirePaxForFlight(
  req: Request,
  res: Response,
  registry: PassengerRegistry,
  flightIdentifier: string,
): Promise<boolean> {
  const resolved = await resolvePaxIdentity({
    authorizationHeader: req.headers.authorization,
  });
  if (!resolved.ok) {
    apiError(res, resolved.failure.status, resolved.failure.error, "Passenger session required.");
    return false;
  }
  const passenger = await registry.get(resolved.identity.tenantId, resolved.identity.passengerId);
  if (!passenger) {
    apiError(res, 404, "passenger_not_found", "Passenger not found.");
    return false;
  }
  const inbound = passenger.transfer?.inboundFlight;
  const allowed = new Set(
    [passenger.flightId, inbound && inbound !== "—" ? inbound : ""]
      .filter(Boolean)
      .map((id) => canonicalFlightId(id)),
  );
  if (!allowed.has(flightIdentifier)) {
    apiError(res, 403, "flight_not_in_session", "This flight is not part of your session.");
    return false;
  }
  return true;
}

export function registerJourneyRoutes(
  router: Router,
  store: JourneyStore,
  registry: PassengerRegistry,
): void {
  router.get("/flights/:flightKey/journey-preferences", async (req, res) => {
    const key = keyFromRequest(req);
    if (!key) return apiError(res, 400, "invalid_journey_key", "A valid flight and date=YYYY-MM-DD are required.");
    if (!(await requirePaxForFlight(req, res, registry, key.flightIdentifier))) return;
    try {
      const preferences = uiPreferencesFromStored(await store.getPreferences(key));
      return res.json({
        ok: true,
        data: { flightKey: key.flightIdentifier, date: key.flightDate, preferences },
      });
    } catch (error) {
      return apiError(res, 500, "store_error", error instanceof Error ? error.message : "Could not load preferences.");
    }
  });

  router.patch("/flights/:flightKey/journey-preferences", async (req, res) => {
    const key = keyFromRequest(req);
    if (!key) return apiError(res, 400, "invalid_journey_key", "A valid flight and date=YYYY-MM-DD are required.");
    if (!(await requirePaxForFlight(req, res, registry, key.flightIdentifier))) return;
    const validated = validatePreferencesPatch(req.body);
    if ("message" in validated) return apiError(res, 400, "invalid_preferences", validated.message);
    try {
      const stored = await store.upsertPreferences(key, storedUpdateFromUiPatch(validated.patch));
      return res.json({
        ok: true,
        data: {
          flightKey: key.flightIdentifier,
          date: key.flightDate,
          preferences: uiPreferencesFromStored(stored),
        },
      });
    } catch (error) {
      return apiError(res, 500, "store_error", error instanceof Error ? error.message : "Could not save preferences.");
    }
  });

  router.get("/flights/:flightKey/time-to-gate", async (req, res) => {
    const key = keyFromRequest(req);
    if (!key) return apiError(res, 400, "invalid_journey_key", "A valid flight and date=YYYY-MM-DD are required.");
    if (!(await requirePaxForFlight(req, res, registry, key.flightIdentifier))) return;
    try {
      const [instance, preferences, events] = await Promise.all([
        fetchJourneyFlight(key.flightIdentifier, { date: key.flightDate, intent: "depart" }),
        store.getPreferences(key),
        store.listEvents(key),
      ]);
      const uiPrefs = uiPreferencesFromStored(preferences);
      const calculatedAt = new Date();
      const estimate = estimateTimeToGate(instance, uiPrefs, events, calculatedAt);
      const target = new Date(calculatedAt.valueOf() + estimate.range.max * 60_000);
      return res.json({
        ok: true,
        data: {
          ...estimate,
          terminalEntryRange: localRange(
            new Date(target.valueOf() - estimate.range.max * 60_000),
            new Date(target.valueOf() - estimate.range.min * 60_000),
            instance.origin_timezone,
          ),
          totalRange: estimate.range,
          targetGateArrival: target.toISOString(),
          gateBuffer: uiPrefs.boardingBuffer,
          departureTerminal: instance.dep_terminal,
          departureGate: instance.dep_gate,
          flight: instance,
        },
      });
    } catch (error) {
      return apiError(
        res,
        502,
        "journey_context_error",
        error instanceof Error ? error.message : "Could not calculate time to gate.",
      );
    }
  });

  router.get("/flights/:flightKey/time-to-exit", async (req, res) => {
    const key = keyFromRequest(req);
    if (!key) return apiError(res, 400, "invalid_journey_key", "A valid flight and date=YYYY-MM-DD are required.");
    if (!(await requirePaxForFlight(req, res, registry, key.flightIdentifier))) return;
    try {
      const [instance, preferences, events] = await Promise.all([
        fetchJourneyFlight(key.flightIdentifier, { date: key.flightDate, intent: "arrive" }),
        store.getPreferences(key),
        store.listEvents(key),
      ]);
      const uiPrefs = uiPreferencesFromStored(preferences);
      const estimate = estimateTimeToExit(instance, uiPrefs, events);
      return res.json({
        ok: true,
        data: {
          ...estimate,
          destinationExpectedRange: localRange(
            new Date(estimate.expectedDestinationTimeStart),
            new Date(estimate.expectedDestinationTimeEnd),
            instance.destination_timezone,
          ),
          remainingMinutes: estimate.range,
          destinationLabel: destinationLabel(uiPrefs.destination),
          arrivalTerminal: instance.arr_terminal,
          arrivalAirport: instance.arr_iata,
          flight: instance,
        },
      });
    } catch (error) {
      return apiError(
        res,
        502,
        "journey_context_error",
        error instanceof Error ? error.message : "Could not calculate time to exit.",
      );
    }
  });

  router.post("/flights/:flightKey/journey-events", async (req, res) => {
    const key = keyFromRequest(req);
    if (!key) return apiError(res, 400, "invalid_journey_key", "A valid flight and date=YYYY-MM-DD are required.");
    if (!(await requirePaxForFlight(req, res, registry, key.flightIdentifier))) return;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return apiError(res, 400, "invalid_event", "Request body must be a JSON object.");
    }
    const eventMap = {
      "off-plane": "off_plane",
      "bags-collected": "bags_collected",
      outside: "outside",
    } as const;
    const event = eventMap[String(req.body.event || "") as keyof typeof eventMap];
    const occurredAt = String(req.body.occurredAt || "");
    if (!event || !occurredAt || Number.isNaN(Date.parse(occurredAt))) {
      return apiError(res, 400, "invalid_event", "event and a valid occurredAt timestamp are required.");
    }
    try {
      const storedEvent = await store.addEvent(key, {
        eventType: event,
        source: "passenger_ui",
        eventTime: occurredAt,
      });
      return res.status(201).json({
        ok: true,
        data: { event: storedEvent, occurredAt: storedEvent.eventTime },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not store event.";
      return apiError(res, /monotonic/i.test(message) ? 409 : 400, "invalid_event_order", message);
    }
  });

  router.delete("/flights/:flightKey/journey-events", async (req, res) => {
    const key = keyFromRequest(req);
    if (!key) return apiError(res, 400, "invalid_journey_key", "A valid flight and date=YYYY-MM-DD are required.");
    if (!(await requirePaxForFlight(req, res, registry, key.flightIdentifier))) return;
    if (req.query.confirm !== "true") {
      return apiError(res, 400, "confirmation_required", "Journey progress correction requires confirm=true.");
    }
    try {
      const removed = await store.resetEvents(key, true);
      return res.json({ ok: true, data: { removed, events: [] } });
    } catch (error) {
      return apiError(res, 500, "store_error", error instanceof Error ? error.message : "Could not reset events.");
    }
  });

  router.post("/flights/:flightKey/arrival-share", async (req, res) => {
    const key = keyFromRequest(req);
    if (!key) return apiError(res, 400, "invalid_journey_key", "A valid flight and date=YYYY-MM-DD are required.");
    if (!(await requirePaxForFlight(req, res, registry, key.flightIdentifier))) return;

    const suppliedPreferences = req.body?.preferences;
    if (suppliedPreferences !== undefined) {
      const validated = validatePreferencesPatch(suppliedPreferences);
      if ("message" in validated) return apiError(res, 400, "invalid_preferences", validated.message);
      try {
        await store.upsertPreferences(key, storedUpdateFromUiPatch(validated.patch));
      } catch (error) {
        return apiError(res, 500, "store_error", error instanceof Error ? error.message : "Could not save preferences.");
      }
    }

    const forceNew = Boolean(req.body?.forceNew);
    const priorPublic = String(req.body?.publicToken || "").trim();
    const priorManagement = String(req.body?.managementToken || "").trim();

    try {
      let share = await store.createOrReuseShare(key, { forceNew });
      if (share.status === "reused") {
        if (priorPublic && (await store.getPublicShare(share.shareId, priorPublic))) {
          const url =
            `${absoluteOrigin(req)}/arrival/${encodeURIComponent(share.shareId)}` +
            `?token=${encodeURIComponent(priorPublic)}` +
            `&shareId=${encodeURIComponent(share.shareId)}`;
          return res.json({
            ok: true,
            data: {
              shareId: share.shareId,
              url,
              managementToken: priorManagement || undefined,
              expiresAt: share.expiresAt,
              reused: true,
            },
          });
        }
        // Tokens lost (or another instance created the share): rotate.
        share = await store.createOrReuseShare(key, { forceNew: true });
      }
      if (share.status !== "created") {
        return apiError(res, 409, "share_tokens_unavailable", "Could not mint share tokens.");
      }
      const url =
        `${absoluteOrigin(req)}/arrival/${encodeURIComponent(share.shareId)}` +
        `?token=${encodeURIComponent(share.publicToken)}` +
        `&shareId=${encodeURIComponent(share.shareId)}`;
      return res.status(201).json({
        ok: true,
        data: {
          shareId: share.shareId,
          url,
          managementToken: share.managementToken,
          expiresAt: share.expiresAt,
          reused: false,
        },
      });
    } catch (error) {
      return apiError(res, 500, "share_error", error instanceof Error ? error.message : "Could not create share.");
    }
  });

  router.delete("/flights/:flightKey/arrival-share/:shareId", async (req, res) => {
    const key = keyFromRequest(req);
    if (!key) return apiError(res, 400, "invalid_journey_key", "A valid flight and date=YYYY-MM-DD are required.");
    if (!(await requirePaxForFlight(req, res, registry, key.flightIdentifier))) return;
    const managementToken =
      String(req.headers["x-management-token"] || "") ||
      String((req.body as { managementToken?: string } | undefined)?.managementToken || "");
    if (!managementToken) {
      return apiError(res, 401, "management_token_required", "A management token is required.");
    }
    try {
      const revoked = await store.revokeShare(req.params.shareId, managementToken);
      if (!revoked) return apiError(res, 404, "share_not_found", "Share is missing, expired, revoked, or unauthorized.");
      return res.json({ ok: true, data: { shareId: req.params.shareId, revoked: true } });
    } catch (error) {
      return apiError(res, 500, "share_error", error instanceof Error ? error.message : "Could not revoke share.");
    }
  });

  router.get("/arrival/:shareId", async (req, res) => {
    const token = String(req.query.token || "");
    if (!token) return apiError(res, 401, "public_token_required", "A public token is required.");
    try {
      const share = await store.getPublicShare(req.params.shareId, token);
      if (!share) return apiError(res, 404, "share_not_found", "Share is missing, expired, revoked, or unauthorized.");
      const key = { flightIdentifier: share.flightIdentifier, flightDate: share.flightDate };
      const instance = await fetchJourneyFlight(key.flightIdentifier, {
        date: key.flightDate,
        intent: "arrive",
      });
      const preferences = uiPreferencesFromStored({
        ...(await store.getPreferences(key)),
        checkedBags: share.preferences.checkedBags,
        departureSecurityLane: share.preferences.departureSecurityLane,
        arrivalSeatZone: share.preferences.arrivalSeatZone,
        arrivalDestination: share.preferences.arrivalDestination,
        immigrationLane: share.preferences.immigrationLane,
      });
      const estimate = estimateTimeToExit(instance, preferences, share.events);
      await store.touchShare(req.params.shareId, token);
      return res.json({
        ok: true,
        data: {
          flight: share.flightIdentifier,
          date: share.flightDate,
          route: { origin: instance.dep_iata, destination: instance.arr_iata },
          status: instance.status,
          arrival: { airport: instance.arr_iata, terminal: instance.arr_terminal },
          destination: {
            type: preferences.destination,
            label: destinationLabel(preferences.destination),
          },
          destinationExpectedRange: localRange(
            new Date(estimate.expectedDestinationTimeStart),
            new Date(estimate.expectedDestinationTimeEnd),
            instance.destination_timezone,
          ),
          remainingMinutes: estimate.range,
          expiresAt: share.expiresAt,
        },
      });
    } catch (error) {
      return apiError(
        res,
        502,
        "journey_context_error",
        error instanceof Error ? error.message : "Could not load arrival plan.",
      );
    }
  });
}
