/**
 * Client metrics ingestion (P1-5).
 *
 * Backs the browser SDK in public/orienta-metrics.js, which previously POSTed to
 * a non-existent endpoint. Accepts a batch, validates/caps it, and persists.
 */
import type { Router, Request, Response } from "express";
import type { MetricsRepository, MetricEvent } from "../lib/MetricsRepository";

const MAX_EVENTS_PER_BATCH = 50;

export function registerMetricsRoutes(router: Router, repo: MetricsRepository): void {
  router.post("/events", (req: Request, res: Response) => {
    // sendBeacon may deliver as text; express.json handles the common case.
    let body: unknown = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, error: "invalid_json" }); }
    }
    const events = (body as { events?: unknown })?.events;
    if (!Array.isArray(events)) return res.status(400).json({ ok: false, error: "missing_events" });
    if (events.length > MAX_EVENTS_PER_BATCH) {
      return res.status(413).json({ ok: false, error: "batch_too_large" });
    }
    const written = repo.insertBatch(events as MetricEvent[]);
    return res.status(202).json({ ok: true, accepted: written });
  });
}
