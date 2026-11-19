// Push on this device: supported, already set up, turn on. Used by the profile and by the one-time prompt on the home screen.
import { t } from "@lingui/core/macro";
import { api, ApiError } from "./api";
import { isIos, isStandalone } from "./session";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Can this browser do push? On the iPhone only the app installed on the Home Screen can. */
export function pushSupported(): boolean {
  if (isIos() && !isStandalone()) return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * Push already set up or refused on this device? Then there is nothing to ask. Allowed but without a subscription
 * (allowed once, the device never signed up with the server) still counts as open.
 */
export async function pushHandled(): Promise<boolean> {
  if (!pushSupported()) return true;
  if (Notification.permission === "denied") return true;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** System prompt (browsers show it only after a tap) and sign the device up with the server. */
export async function enablePush(vapidPublicKey: string | null): Promise<NotificationPermission> {
  if (!vapidPublicKey) throw new Error(t`Push is not set up on the server yet.`);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const reg = await navigator.serviceWorker.ready;
  const key = urlBase64ToUint8Array(vapidPublicKey);
  let sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    await api.post("/push/subscriptions", sub.toJSON());
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "endpoint_taken")) throw err;
    // Endpoint known for another account with other keys: a fresh subscription gets a new endpoint
    await sub.unsubscribe();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api.post("/push/subscriptions", sub.toJSON());
  }
  return permission;
}
