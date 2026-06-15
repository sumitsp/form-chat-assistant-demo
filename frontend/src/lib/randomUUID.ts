const nativeRandomUUID: (() => string) | null =
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
    : null;

/** RFC 4122 v4 UUID without requiring a secure context (HTTPS / localhost). */
function fallbackRandomUUID(): string {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Prefer native UUID when available (secure context); otherwise use a polyfill. */
export function randomUUID(): string {
  if (nativeRandomUUID) return nativeRandomUUID();
  return fallbackRandomUUID();
}

/**
 * Patch `crypto.randomUUID` on HTTP LAN dev URLs (e.g. http://192.168.x.x:5173)
 * so existing call sites keep working on mobile Safari.
 */
export function installRandomUUIDPolyfill(): void {
  if (nativeRandomUUID) return;
  const c = globalThis.crypto;
  if (!c || typeof c.randomUUID === "function") return;
  const gen = () => fallbackRandomUUID();
  try {
    Object.defineProperty(c, "randomUUID", { value: gen, configurable: true, writable: true });
  } catch {
    /* crypto may be frozen — use randomUUID() from this module directly */
  }
}
