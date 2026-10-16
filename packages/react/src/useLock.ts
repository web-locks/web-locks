import { createLockStatus } from "@web-locks/core";
import type { LockState, LockStatusOptions } from "@web-locks/core";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type UseLockOptions = Omit<LockStatusOptions, "signal"> & {
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
 * `ifAvailable`, `steal` or `locks` change (then it is re-acquired, after the
 * previous lock has been fully released). A lock stolen from this component is
 * NOT re-acquired automatically: `status` becomes "idle" and `onLost` runs.
 *
 * `release()` frees the held lock now and returns the status to "idle". It does
 * not re-acquire on the next render: the lock is acquired again only when the
 * name/options above change or the component remounts. Callbacks
 * (`onAcquired`, `onLost`) live in refs, so changing them never re-acquires.
 * Queued requests are aborted by the hook itself on unmount (there is no
 * `signal` option); `ifAvailable` and `steal` requests never queue. `locks`
 * should be referentially stable.
 */
export function useLock(
  name: string,
  options: UseLockOptions = {},
): { status: LockState; release(): Promise<void> } {
  const { enabled = true, mode, ifAvailable, steal, locks } = options;
  const [store] = useState(createStateStore);

  // Callbacks live in refs so changing them never re-acquires.
  const callbacks = useRef(options);
  useEffect(() => {
    callbacks.current = options;
  });

  // Each effect run creates its own core status, which serializes only within
  // itself. This promise chains the previous runs' releases so the next run
  // waits until the old lock is truly free before requesting (otherwise an
  // `ifAvailable` request could see this hook's own old lock). Never rejects.
  const previousRelease = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!enabled) {
      store.set("idle");
      return;
    }
    const status = createLockStatus(name, {
      mode,
      ifAvailable,
      steal,
      locks,
      onAcquired: () => callbacks.current.onAcquired?.(),
      onLost: () => callbacks.current.onLost?.(),
    });
    store.attach(status);
    let cancelled = false;
    let unsubscribe = () => {};
    const sync = () => store.set(status.getState());
    store.set("pending");
    void previousRelease.current.then(() => {
      if (cancelled) return;
      unsubscribe = status.subscribe(sync);
      status.start();
      sync();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      store.attach(null);
      // release() is async; chain it so the next effect run waits for it.
      const released = status.release().catch(() => {});
      previousRelease.current = Promise.all([previousRelease.current, released]).then(() => {});
      store.set("idle");
    };
  }, [name, mode, ifAvailable, steal, locks, enabled, store]);

  const status = useSyncExternalStore(store.subscribe, store.getState, () => "idle" as LockState);
  const release = useCallback(() => store.release(), [store]);
  return { status, release };
}
