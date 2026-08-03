import ReactDOM from "react-dom/client";
import "./styles.css";
import "leaflet/dist/leaflet.css";
import { initErrorTracking, Sentry } from "./lib/errorTracking";
import { loadRuntimeConfig } from "./config/bootstrap";

// Boot browser error tracking before render so init-time errors are captured.
// No-op unless VITE_SENTRY_DSN is set (P2-5).
initErrorTracking();

function AppCrashFallback() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#b91c1c" }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>出错了 / Something went wrong</h1>
      <p style={{ color: "#374151" }}>请刷新页面重试。Please refresh the page to try again.</p>
    </div>
  );
}

/** Removes the static HTML boot spinner (index.html) once React has rendered something. */
function hideBootLoading(): void {
  document.getElementById("boot-loading")?.remove();
}

// Hydrate the airport/tenant registry from the server before loading the app, so
// every (synchronous) config read resolves the runtime-loaded hub. App is
// imported dynamically so its module graph evaluates after hydration.
// loadRuntimeConfig() has its own internal timeout, so this never hangs
// indefinitely on a slow/unreachable backend (see src/config/bootstrap.ts).
async function start() {
  const configLoaded = await loadRuntimeConfig();
  const { default: App } = await import("./app/App");

  // StrictMode intentionally removed: it causes double-mount in dev which
  // breaks Leaflet's "container already initialized" check.
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <Sentry.ErrorBoundary fallback={<AppCrashFallback />}>
      <App configDegraded={!configLoaded} />
    </Sentry.ErrorBoundary>
  );
  hideBootLoading();
}

start().catch((err) => {
  // Should be unreachable — start()'s own steps already catch their errors —
  // but if something upstream of that still throws, at least replace the
  // spinner with a message instead of spinning forever.
  console.error("[orienta] fatal boot error:", err);
  hideBootLoading();
  const root = document.getElementById("root");
  if (root) {
    ReactDOM.createRoot(root).render(<AppCrashFallback />);
  }
});
