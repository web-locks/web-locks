import type { ClientSnapshot } from "./serviceClient.ts";

export const SNAPSHOT_KEY = "web-locks-demo.snapshot";
const VERSION = 1; // bump when ClientSnapshot changes shape
/** Keep at or below the service's session lifetime. */
export const MAX_SNAPSHOT_AGE_MS = 5 * 60_000;

type Saved = { v: number; savedAt: number; data: ClientSnapshot };

function isSnapshot(value: unknown): value is ClientSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.clientId === "string" &&
    typeof s.sessionToken === "string" &&
    typeof s.messageCount === "number"
  );
}

/** Stores the snapshot for the next leader. Never throws; returns whether it was stored. */
export function saveSnapshot(snapshot: ClientSnapshot): boolean {
  try {
    const saved: Saved = { v: VERSION, savedAt: Date.now(), data: snapshot };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false; // storage full or unavailable: no crash recovery for this snapshot
  }
}

/** The stored snapshot, or null if missing, corrupt, another version or too old. */
export function loadSnapshot(now = Date.now()): ClientSnapshot | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? "null") as Saved | null;
    if (!saved || saved.v !== VERSION || typeof saved.savedAt !== "number") return null;
    if (now - saved.savedAt >= MAX_SNAPSHOT_AGE_MS) return null;
    return isSnapshot(saved.data) ? saved.data : null;
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}

export type Mirror = {
  /** Broadcast the latest state (null: the session ended). */
  publish(snapshot: ClientSnapshot | null): void;
  /** Listen for the leader's state; returns the unsubscribe function. */
  subscribe(listener: (snapshot: ClientSnapshot | null) => void): () => void;
  close(): void;
};

/** Live state sharing over a BroadcastChannel. The channel is opened lazily and every call is guarded. */
export function createMirror(): Mirror {
  let channel: BroadcastChannel | null | undefined;
  const open = () => {
    if (channel === undefined) {
      try {
        channel =
          typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SNAPSHOT_KEY);
      } catch {
        channel = null;
      }
    }
    return channel;
  };
  return {
    publish(snapshot) {
      try {
        open()?.postMessage(snapshot);
      } catch {
        // standby tabs miss one update
      }
    },
    subscribe(listener) {
      const current = open();
      if (!current) return () => {};
      const onMessage = (event: MessageEvent<unknown>) => {
        if (event.data === null) listener(null);
        else if (isSnapshot(event.data)) listener(event.data);
      };
      current.addEventListener("message", onMessage);
      return () => current.removeEventListener("message", onMessage);
    },
    close() {
      try {
        channel?.close();
      } catch {
        // already closed
      }
      channel = undefined;
    },
  };
}
