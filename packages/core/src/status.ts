import { reportError } from "./errors.ts";
import { acquireLock } from "./lock.ts";
import type { AcquireOptions, LockHandle } from "./lock.ts";
import { resolveLocks } from "./support.ts";
import type { LockState, Store } from "./types.ts";

export type LockStatusOptions = AcquireOptions & {
  /** Called once each time the lock is acquired. Errors it throws go to `onError`. */
  onAcquired?: () => void;
  /**
   * Receives errors thrown by `onAcquired`/`onLost` and failed lock requests
   * (e.g. invalid option combinations such as `steal` with `ifAvailable`).
   * Defaults to the global `reportError` (or `console.error`). Aborts made by
   * the store itself are not reported.
   */
  onError?: (error: unknown) => void;
};

/** The store returned by {@link createLockStatus}. */
export type LockStatus = Store<LockState> & {
  /** Requests the lock (when `idle`). */
  start: () => void;
  /** Releases the held lock or aborts the queued request; resolves once it is free. */
  release: () => Promise<void>;
};

/**
 * A small store tracking one lock's lifecycle:
 * `idle` -> `pending` -> `held` | `unavailable` | `unsupported`.
 *
 * A `start()` issued after `release()` waits for the earlier acquisition to
 * finish. If that earlier request was queued with a caller-supplied `signal`
 * (so the store cannot abort it), the new start stays `pending` until that
 * request settles.
 *
 * A request that fails before the grant (other than through an abort) is
 * reported to `onError` and the state returns to `idle`.
 */
export function createLockStatus(name: string, options: LockStatusOptions = {}): LockStatus {
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
    const { onAcquired, onLost, onError, ...rest } = options;
    const canAbort = !rest.signal && !rest.ifAvailable && !rest.steal;
    abort = canAbort ? new AbortController() : null;
    set("pending");
    const signal = abort ? abort.signal : rest.signal;
    // Serialize: wait until any earlier run has fully finished (request settled,
    // handle released) before issuing our own request.
    inflight = inflight.then(() => {
      if (id !== run) return;
      return acquireLock(name, {
        ...rest,
        signal,
        onLost: () => {
          if (id !== run) return;
          handle = null;
          set("idle");
          try {
            onLost?.();
          } catch (error) {
            reportError(onError, error);
          }
        },
      }).then(
        (h) => {
          if (id !== run) return h?.release();
          if (!h) {
            set("unavailable");
            return;
          }
          handle = h;
          set("held");
          try {
            onAcquired?.();
          } catch (error) {
            reportError(onError, error);
          }
        },
        (error: unknown) => {
          // An aborted signal (ours on release, or the caller's) is not an error;
          // anything else failed the request. Either way: back to idle.
          if (!signal?.aborted) reportError(onError, error);
          if (id === run) set("idle");
        },
      );
    });
  }

  function release(): Promise<void> {
    run++;
    const h = handle;
    handle = null;
    abort?.abort();
    abort = null;
    set("idle");
    inflight = Promise.all([inflight, h?.release()]).then(() => {});
    return inflight;
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    release,
  };
}
