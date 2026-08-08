/**
 * Admin FIDS board routes — live departures / arrivals for the dashboard panels.
 */
import type { Router, Request, Response, RequestHandler, NextFunction } from "express";
import { requireAdmin } from "./auth";
import { fetchFidsBoard } from "../services/fidsBoard";

export function registerFidsRoutes(router: Router, aeroApiRateLimit?: RequestHandler): void {
  const limit: RequestHandler = aeroApiRateLimit ?? ((_req, _res, next: NextFunction) => next());

  router.get("/fids/departures", requireAdmin, limit, async (req: Request, res: Response) => {
    const airport = typeof req.query.airport === "string" ? req.query.airport : undefined;
    // Always 200 with a typed status — the panel distinguishes unconfigured /
    // unavailable / ok without treating provider blips as hard HTTP errors.
    res.json(await fetchFidsBoard("departures", airport));
  });

  router.get("/fids/arrivals", requireAdmin, limit, async (req: Request, res: Response) => {
    const airport = typeof req.query.airport === "string" ? req.query.airport : undefined;
    res.json(await fetchFidsBoard("arrivals", airport));
  });
}
