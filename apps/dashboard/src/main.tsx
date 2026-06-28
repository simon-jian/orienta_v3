import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles.css";
import "leaflet/dist/leaflet.css";
import { initErrorTracking, Sentry } from "./lib/errorTracking";

// Boot browser error tracking before render so init-time errors are captured.
// No-op unless VITE_SENTRY_DSN is set (P2-5).
initErrorTracking();

// StrictMode intentionally removed: it causes double-mount in dev
// which breaks Leaflet's "container already initialized" check
ReactDOM.createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<AppCrashFallback />}>
    <App />
  </Sentry.ErrorBoundary>
);

function AppCrashFallback() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#b91c1c" }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>出错了 / Something went wrong</h1>
      <p style={{ color: "#374151" }}>请刷新页面重试。Please refresh the page to try again.</p>
    </div>
  );
}
