/**
 * Server-side auth — POST /api/auth/login → signed JWT in httpOnly cookie.
 *
 * The JWT never leaves the httpOnly cookie; login/me responses expose only user + exp.
 */
import type { Router, Request, Response, NextFunction } from "express";
import { SignJWT, type JWTPayload } from "jose";
import { JWT_SECRET, getAdminCredentials } from "../config";
import type { AdminSession } from "../../src/types/types";
import type { AuditLog } from "../lib/auditLog";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_JWT_TTL_S,
  verifyAdminToken,
} from "../auth/adminAuth";

interface AuthenticatedRequest extends Request {
  adminPayload: JWTPayload;
}

async function signToken(payload: object): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_JWT_TTL_S}s`)
    .sign(secret);
}

function setAuthCookie(res: Response, token: string): void {
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ADMIN_JWT_TTL_S * 1000,
    path: "/",
  });
}

function sessionFromPayload(payload: JWTPayload): AdminSession {
  return {
    exp: (payload.exp ?? 0) * 1000,
    user: {
      email: String(payload.sub || ""),
      displayName: String(payload.displayName || ""),
      org: String(payload.org || ""),
      role: (payload.role as AdminSession["user"]["role"]) || "viewer",
    },
  };
}

/** Express middleware: reject requests without a valid admin JWT cookie. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[ADMIN_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ ok: false, error: "not_authenticated" });
    return;
  }
  const payload = await verifyAdminToken(token);
  if (!payload) {
    res.clearCookie(ADMIN_COOKIE_NAME);
    res.status(401).json({ ok: false, error: "token_invalid_or_expired" });
    return;
  }
  (req as AuthenticatedRequest).adminPayload = payload;
  next();
}

export function registerAuthRoutes(router: Router, auditLog?: AuditLog): void {
  router.post("/login", async (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "missing_credentials" });
    }

    const creds = getAdminCredentials();
    const key = String(email).trim().toLowerCase();
    const entry = creds.get(key);

    if (!entry || entry.password !== String(password)) {
      auditLog?.record({
        actorEmail: key,
        action: "admin_login_failed",
        detail: req.ip,
      });
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }

    const now = Date.now();
    const payload = {
      sub: key,
      role: entry.role,
      displayName: entry.displayName,
      org: entry.org,
      iat: Math.floor(now / 1000),
    };

    const token = await signToken(payload);
    setAuthCookie(res, token);
    auditLog?.record({
      actorEmail: key,
      action: "admin_login",
      detail: req.ip,
    });

    return res.json({
      ok: true,
      session: {
        exp: now + ADMIN_JWT_TTL_S * 1000,
        user: {
          email: key,
          displayName: entry.displayName,
          org: entry.org,
          role: entry.role,
        },
      },
    });
  });

  router.get("/me", async (req: Request, res: Response) => {
    const token = req.cookies?.[ADMIN_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ ok: false, error: "not_authenticated" });
    }

    const payload = await verifyAdminToken(token);
    if (!payload) {
      res.clearCookie(ADMIN_COOKIE_NAME);
      return res.status(401).json({ ok: false, error: "token_invalid_or_expired" });
    }

    return res.json({ ok: true, session: sessionFromPayload(payload) });
  });

  router.post("/logout", (_req: Request, res: Response) => {
    res.clearCookie(ADMIN_COOKIE_NAME, { path: "/" });
    return res.json({ ok: true });
  });
}
