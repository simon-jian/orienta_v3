import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../../../config/api";
import type { PaxSession } from "../session";

function isStandalonePwa(): boolean {
  const mq = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const ios = "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return Boolean(mq || ios);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function readVapidPublicKey(): Promise<string | null> {
  const res = await fetch(apiUrl("/api/push/vapidPublicKey"));
  const data = (await res.json().catch(() => ({}))) as { publicKey?: string; ok?: boolean };
  return typeof data.publicKey === "string" && data.publicKey ? data.publicKey : null;
}

export function usePaxPush(session: PaxSession | null) {
  const [standalone, setStandalone] = useState(false);
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    setStandalone(isStandalonePwa());
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  }, []);

  useEffect(() => {
    if (!session || !supported) return;

    const onVisibility = () => {
      const path = document.visibilityState === "hidden" ? "/api/pax/away" : "/api/pax/back";
      const body =
        document.visibilityState === "hidden"
          ? {
              tenantId: session.passenger.tenantId,
              passengerId: session.passenger.id,
              awayMs: 30_000,
            }
          : {
              tenantId: session.passenger.tenantId,
              passengerId: session.passenger.id,
            };
      void fetch(apiUrl(path), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [session, supported]);

  const enablePush = useCallback(async () => {
    if (!session) return;
    if (!supported) {
      setHint("此浏览器不支持 Web Push。");
      return;
    }
    if (!standalone) {
      setHint("请先将本页「添加到主屏幕」并以独立 Web App 打开（iPhone 需要）。");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setHint("通知权限未授予。");
        return;
      }
      const vapid = await readVapidPublicKey();
      if (!vapid) {
        setHint("服务器未配置 VAPID。");
        return;
      }
      const reg = await navigator.serviceWorker.register(apiUrl("/sw.js"));
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
      });
      const res = await fetch(apiUrl("/api/push/subscribe"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          tenantId: session.passenger.tenantId,
          passengerId: session.passenger.id,
          subscription: sub.toJSON(),
        }),
      });
      if (!res.ok) throw new Error("subscribe_failed");
      setEnabled(true);
      setHint("手机通知已开启；离开页面约 30 秒未返回将收到提醒。");
    } catch (err) {
      setHint(err instanceof Error ? err.message : "push_failed");
    }
  }, [session, supported, standalone]);

  return { standalone, supported, enabled, hint, enablePush };
}
