import type { ClientSnapshot } from "./serviceClient.ts";

export const REGISTRATIONS_KEY = "web-locks-demo.react.registrations";

/** How many clients have registered with the (mock) service. */
export function registrations(): number {
  try {
    const count = Number(localStorage.getItem(REGISTRATIONS_KEY));
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Registers a new client: the service counts it and hands out an id and a session token. */
export function register(): ClientSnapshot {
  localStorage.setItem(REGISTRATIONS_KEY, String(registrations() + 1));
  return {
    clientId: `client-${randomId().slice(0, 6)}`,
    sessionToken: randomId(),
    messageCount: 0,
  };
}

/** Forgets every registration (the demo's Reset button). */
export function reset(): void {
  try {
    localStorage.removeItem(REGISTRATIONS_KEY);
  } catch {
    // storage unavailable: nothing to reset
  }
}
