import { createLockStatus } from "@web-locks/core";
import type { LockState, LockStatusOptions } from "@web-locks/core";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type UseLockOptions = LockStatusOptions & {
  /** Set to false to release (and not acquire) the lock. Defaults to true. */
  enabled?: boolean;
};

type LockStatus = ReturnType<typeof createLockStatus>;

/** A tiny store that exists before the core status does (that is created in an effect). */
function createStateStore() {
  let state: LockState = "idle";
  let current: LockStatus | null = null;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: LockState) => {
      if (state === next) return;
      state = next;
      for (const listener of listeners) listener();
    },
    attach: (status: LockStatus | null) => {
      current = status;
    },
    release: () => current?.release() ?? Promise.resolve(),
  };
}

/**
 * Hold a named Web Lock for as long as the component is mounted.
 *
 * `status` is "idle" on the server and on the first client render; the
 * acquisition starts after mount ("pending", then "held", "unavailable" with
 * `ifAvailable`, or "unsupported" without the Locks API). The lock is released
 * on unmount, when `enabled` becomes false, and when `name`, `mode`,
 * `ifAvailable`, `steal`, `locks` or `signal` change (then it is re-acquired).
 *
 * `release()` frees the held lock now and returns the status to "idle". It does
 * not re-acquire on the next render: the lock is acquired again only when the
 * name/options above change or the component remounts. Callbacks
 * (`onAcquired`, `onLost`) live in refs, so changing them never re-acquires.
 * Passing a `signal` disables the internal abort-on-release of a queued
 * request; `locks` should be referentially stable.
 */
export function useLock(
  name: string,
  options: UseLockOptions = {},
): { status: LockState; release(): Promise<void> } {
  const { enabled = true, mode, ifAvailable, steal, signal, locks } = options;
  const [store] = useState(createStateStore);

  // Callbacks live in refs so changing them never re-acquires.
  const callbacks = useRef(options);
  useEffect(() => {
    callbacks.current = options;
  });

  useEffect(() => {
    if (!enabled) {
      store.set("idle");
      return;
    }
    const status = createLockStatus(name, {
      mode,
      ifAvailable,
      steal,
      signal,
      locks,
      onAcquired: () => callbacks.current.onAcquired?.(),
      onLost: () => callbacks.current.onLost?.(),
    });
    store.attach(status);
    const sync = () => store.set(status.getState());
    const unsubscribe = status.subscribe(sync);
    status.start();
    sync();
    return () => {
      unsubscribe();
      store.attach(null);
      // release() is async; the core serializes it against later start() calls.
      void status.release();
      store.set("idle");
    };
  }, [name, mode, ifAvailable, steal, signal, locks, enabled, store]);

  const status = useSyncExternalStore(store.subscribe, store.getState, () => "idle" as LockState);
  const release = useCallback(() => store.release(), [store]);
  return { status, release };
}
