import { createMirror, loadSnapshot, saveSnapshot } from "./handoff.ts";
import { ServiceClient } from "./serviceClient.ts";

export const SNAPSHOT_INTERVAL_MS = 3_000;

/**
 * Restores the client from the stored snapshot, and registers a new one only if
 * there is none (or it cannot be used). A throw from `register()` propagates.
 */
export function acquireClient(): ServiceClient {
  const saved = loadSnapshot();
  if (saved) {
    try {
      return ServiceClient.resume(saved);
    } catch {
      // restore failed: start fresh
    }
  }
  return ServiceClient.register();
}

export type Autosave = {
  /** Stops autosaving without a final snapshot (what a crash looks like). */
  stop(): void;
  /** Stops autosaving, then takes one last snapshot (a clean demotion). */
  finish(): void;
};

/**
 * Snapshots the client on every change and on a timer, and mirrors it to standby
 * tabs. Never throws; each part degrades on its own. Idempotent to stop.
 */
export function startAutosave(client: ServiceClient): Autosave {
  const mirror = createMirror();
  const persist = () => {
    let data;
    try {
      data = client.snapshot();
    } catch {
      return;
    }
    mirror.publish(data);
    saveSnapshot(data);
  };
  let stopListening = () => {};
  try {
    stopListening = client.onChange(persist);
  } catch {
    // the timer still covers it
  }
  const timer = setInterval(persist, SNAPSHOT_INTERVAL_MS);
  persist();
  let stopped = false;
  const stop = () => {
    if (stopped) return false;
    stopped = true;
    stopListening();
    clearInterval(timer);
    return true;
  };
  return {
    stop() {
      if (stop()) mirror.close();
    },
    finish() {
      if (!stop()) return;
      persist();
      mirror.close();
    },
  };
}
