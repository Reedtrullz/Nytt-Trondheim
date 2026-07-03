import type { PushSubscriptionInput } from "@nytt/shared";

export type PushBrowserSupport = "supported" | "unsupported" | "insecure" | "permission_denied";

export function pushBrowserSupport(): PushBrowserSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext && window.location.hostname !== "localhost") return "insecure";
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "permission_denied";
  return "supported";
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

export async function subscribeBrowserToPush(
  publicKey: string,
  minSeverity: PushSubscriptionInput["minSeverity"] = "warning",
): Promise<PushSubscriptionInput> {
  const support = pushBrowserSupport();
  if (support !== "supported") {
    throw new Error("Denne nettleseren kan ikke abonnere på varsler.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Varsler ble ikke tillatt i nettleseren.");
  }
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  const registration = await navigator.serviceWorker.register("/notification-sw.js");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey.buffer.slice(
      applicationServerKey.byteOffset,
      applicationServerKey.byteOffset + applicationServerKey.byteLength,
    ) as ArrayBuffer,
  });
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) {
    throw new Error("Nettleseren returnerte et ufullstendig push-abonnement.");
  }
  return {
    endpoint: serialized.endpoint,
    expirationTime: serialized.expirationTime ?? null,
    keys: {
      p256dh: serialized.keys.p256dh,
      auth: serialized.keys.auth,
    },
    userAgent: navigator.userAgent,
    minSeverity,
    kinds: [],
  };
}
