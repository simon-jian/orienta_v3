import { useState } from "react";
import { createArrivalShare, flightDateToday } from "../api/journeyApi";
import type { PaxSession } from "../session";

const SHARE_STORAGE_PREFIX = "orienta_arrival_share:";

type StoredShare = {
  shareId: string;
  url: string;
  managementToken?: string;
  expiresAt: string;
};

type Props = {
  session: PaxSession;
  flightOverride?: string;
  dateOverride?: string;
};

function storageKey(flight: string, date: string) {
  return `${SHARE_STORAGE_PREFIX}${flight}:${date}`;
}

export function ArrivalShareControls({ session, flightOverride, dateOverride }: Props) {
  const flight = flightOverride || session.passenger.flightId;
  const date = dateOverride || flightDateToday();
  const [share, setShare] = useState<StoredShare | null>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey(flight, date));
      return raw ? (JSON.parse(raw) as StoredShare) : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createShare() {
    setBusy(true);
    setError("");
    try {
      const data = await createArrivalShare(session.token, flight, date, {
        publicToken: share?.url ? new URL(share.url).searchParams.get("token") : undefined,
        managementToken: share?.managementToken,
      });
      const next: StoredShare = {
        shareId: data.shareId,
        url: data.url,
        managementToken: data.managementToken || share?.managementToken,
        expiresAt: data.expiresAt,
      };
      sessionStorage.setItem(storageKey(flight, date), JSON.stringify(next));
      setShare(next);
      if (navigator.share) {
        await navigator.share({ title: "Arrival plan", url: next.url }).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "share_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pax-card" style={{ marginTop: 0 }}>
      <h2>Choose Arrival Plan</h2>
      <p>生成带 token 的公开链接，方便接机方查看预计到达出口时间。</p>
      <div className="pax-row">
        <button type="button" className="pax-btn" disabled={busy} onClick={() => void createShare()}>
          {busy ? "生成中…" : share ? "刷新 / 分享链接" : "创建分享链接"}
        </button>
        {share ? (
          <button
            type="button"
            className="pax-btn secondary"
            onClick={() => void navigator.clipboard.writeText(share.url)}
          >
            复制链接
          </button>
        ) : null}
      </div>
      {share ? (
        <p className="pax-lead" style={{ marginTop: 12, fontSize: "0.85rem", wordBreak: "break-all" }}>
          {share.url}
        </p>
      ) : null}
      {error ? <p className="pax-error">{error}</p> : null}
    </section>
  );
}
