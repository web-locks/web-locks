import { acquireLock } from "./lock.ts";
import type { AcquireOptions, LockHandle } from "./lock.ts";
import { resolveLocks } from "./support.ts";
import type { LockState, Store } from "./types.ts";

export type LockStatusOptions = AcquireOptions & {
  /** Called once each time the lock is acquired. Errors are swallowed. */
  onAcquired?: () => void;
};

/**
 * A small store tracking one lock's lifecycle:
 * `idle` -> `pending` -> `held` | `unavailable` | `unsupported`.
 */
export function createLockStatus(
  name: string,
  options: LockStatusOptions = {},
): Store<LockState> & { start(): void; release(): Promise<void> } {
  let state: LockState = "idle";
  let run = 0;
  let handle: LockHandle | null = null;
  let abort: AbortController | null = null;
  let inflight: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  function set(next: LockState): void {
    if (state === next) return;
    state = next;
    for (const l of listeners) l();
  }

  function start(): void {
    if (state !== "idle") return;
    if (!resolveLocks(options.locks)) {
      set("unsupported");
      return;
    }
    const id = ++run;
    const { onAcquired, onLost, ...rest } = options;
    const canAbort = !rest.signal && !rest.ifAvailable && !rest.steal;
    abort = canAbort ? new AbortController() : null;
    set("pending");
    inflight = acquireLock(name, {
      ...rest,
      signal: abort ? abort.signal : rest.signal,
      onLost: () => {
        if (id === run) {
          handle = null;
          set("idle");
        }
        try {
          onLost?.();
        } catch {
          // ignore
        }
      },
    }).then(
      (h) => {
        if (id !== run) {
          void h?.release();
          return;
        }
        if (!h) {
          set("unavailable");
          return;
        }
        handle = h;
        set("held");
        try {
          onAcquired?.();
        } catch {
          // ignore
        }
      },
      () => {
        // AbortError from our own abort, or any other failure: back to idle.
        if (id === run) set("idle");
      },
    );
  }

  function release(): Promise<void> {
    run++;
    const h = handle;
    const pending = inflight;
    handle = null;
    abort?.abort();
    abort = null;
    set("idle");
    return Promise.all([pending, h?.release()]).then(() => {});
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    release,
  };
}
