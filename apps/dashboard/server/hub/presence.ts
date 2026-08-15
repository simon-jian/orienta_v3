/**
 * Presence sub-module — who is online, grace-period offline timers.
 *
 * Extracted from the monolithic wsHub.ts.
 */
import { HubStore } from "./HubStore";

const PAX_OFFLINE_GRACE_MS = 4500;

export function cancelPaxOffline(store: HubStore, tenantId: string, passengerId: string): void {
  const key = HubStore.key(tenantId, passengerId);
  const t = store.paxOfflineTimers.get(key);
  if (t) {
    clearTimeout(t);
    store.paxOfflineTimers.delete(key);
  }
}

export function schedulePaxOffline(
  store: HubStore,
  tenantId: string,
  passengerId: string
): void {
  const key = HubStore.key(tenantId, passengerId);
  cancelPaxOffline(store, tenantId, passengerId);
  store.paxOfflineTimers.set(
    key,
    setTimeout(() => {
      store.paxOfflineTimers.delete(key);
      const still = store.paxSockets.get(key);
      if (!still || still.size === 0) {
        setPresence(store, tenantId, passengerId, false);
      }
    }, PAX_OFFLINE_GRACE_MS)
  );
}

export function setPresence(
  store: HubStore,
  tenantId: string,
  passengerId: string,
  isOnline: boolean
): void {
  const key = HubStore.key(tenantId, passengerId);
  const wasOnline = store.online.has(key);
  if (isOnline) store.online.add(key);
  else store.online.delete(key);
  // Mirror into the shared presence set so other instances see it.
  store.recordPresence(tenantId, passengerId, isOnline);
  if (wasOnline !== isOnline) {
    store.broadcastAdmins(tenantId, {
      type: "presence",
      tenantId,
      passengerId,
      online: isOnline,
      at: Date.now(),
    });
  }
}

/**
 * HTTP heartbeat from pax UI when WS presence is lost through tunnels or proxies.
 * Called from routes/push.ts via the shared HubStore.
 */
export function setPaxPresenceFromHttp(
  store: HubStore,
  tenantId: string,
  rawPassengerId: string,
  isOnline: boolean
): void {
  const passengerId = String(rawPassengerId ?? "").trim();
  if (!tenantId || !passengerId) return;
  const key = HubStore.key(tenantId, passengerId);

  if (isOnline) {
    cancelPaxOffline(store, tenantId, passengerId);
    setPresence(store, tenantId, passengerId, true);
    return;
  }

  // HTTP offline must not clobber a live WebSocket (React effect remounts,
  // Strict Mode, or session revalidation previously posted online:false while
  // the pax socket was still connected — that made admin presence flap).
  const sockets = store.paxSockets.get(key);
  if (sockets && sockets.size > 0) return;
  schedulePaxOffline(store, tenantId, passengerId);
}
