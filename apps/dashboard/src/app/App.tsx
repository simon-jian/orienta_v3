/**
 * App — route guard only.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LoginScreen from "../components/LoginScreen";
import PaxEntryPage from "../features/pax/PaxEntryPage";
import { fetchSession, logout as authLogout, cacheSession } from "../services/auth";
import { apiUrl } from "../config/api";
import type { AdminSession } from "../types/types";

// Route-level code splitting: Dashboard (map/FIDS/chat) and PaxAppPage (indoor
// map + PDR) are the two heaviest subtrees and are mutually exclusive routes —
// a passenger's browser never needs the admin console's code and vice versa.
const Dashboard = lazy(() => import("./Dashboard"));
const PaxAppPage = lazy(() => import("../features/pax/PaxAppPage"));

function RouteLoading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#aaa" }}>
      Loading…
    </div>
  );
}

/** Slim, non-blocking banner shown when the server's runtime airport/tenant
 * config couldn't be loaded at boot (src/config/bootstrap.ts) — the app is
 * still usable on its built-in fallback config, but an operator should know
 * before assuming what they're looking at is live configuration. */
function ConfigDegradedBanner() {
  return (
    <div
      role="status"
      style={{
        background: "#7c2d12", color: "#fed7aa", fontSize: 13, padding: "6px 12px",
        textAlign: "center", fontFamily: "system-ui, sans-serif",
      }}
    >
      配置服务不可达，当前使用内置默认配置（功能可能受限）。Configuration service unreachable — running on built-in defaults.
    </div>
  );
}

export default function App({ configDegraded = false }: { configDegraded?: boolean }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchSession()
      .then((s) => setSession(s))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#aaa" }}>
        Loading…
      </div>
    );
  }

  return (
    <BrowserRouter>
      {configDegraded && <ConfigDegradedBanner />}
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/pax"  element={<PaxEntryPage />} />
          <Route path="/pax/" element={<PaxEntryPage />} />
          <Route path="/pax/app" element={<PaxAppPage />} />

          <Route
            path="*"
            element={
              session ? (
                <Dashboard
                  session={session}
                  onLogout={() => { authLogout(); setSession(null); }}
                />
              ) : (
                <LoginScreen
                  onLogin={async (email, password) => {
                    const s = await loginWithCredentials(email, password);
                    if (s) setSession(s);
                    return s;
                  }}
                />
              )
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

async function loginWithCredentials(
  email: string,
  password: string
): Promise<AdminSession | null> {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "same-origin",
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error === "invalid_credentials"
      ? "账号或密码错误"
      : "Login failed");
  }
  const { session } = await res.json();
  return cacheSession(session as AdminSession);
}
