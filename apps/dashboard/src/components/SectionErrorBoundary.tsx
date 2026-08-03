/**
 * Scoped error boundary for one dashboard section (map, FIDS panel, chat).
 *
 * main.tsx already wraps the whole app in one Sentry.ErrorBoundary, but that
 * means a crash in, say, the map (Leaflet) takes down the entire dashboard —
 * including the FIDS boards and passenger list — instead of just the map.
 * Reuses Sentry.ErrorBoundary (already a dependency) so reporting keeps
 * working when SENTRY_DSN is set, and still works as a plain boundary when
 * it's not.
 */
import type { ReactNode } from "react";
import { Sentry } from "../lib/errorTracking";

export default function SectionErrorBoundary({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Sentry.ErrorBoundary
      fallback={
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", minHeight: 120, color: "#9aa3af", fontSize: 13,
            fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 16,
          }}
        >
          {label} 加载出错，请刷新页面重试。
        </div>
      }
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
