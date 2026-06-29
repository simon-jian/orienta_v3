/**
 * App — route guard only.
 */
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./Dashboard";
import LoginScreen from "../components/LoginScreen";
import PaxAppPage from "../features/pax/PaxAppPage";
import PaxEntryPage from "../features/pax/PaxEntryPage";
import { fetchSession, logout as authLogout, cacheSession } from "../services/auth";
import { apiUrl } from "../config/api";
import type { AdminSession } from "../types/types";

export default function App() {
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
