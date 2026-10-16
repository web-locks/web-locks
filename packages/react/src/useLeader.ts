import { createLeader } from "@web-locks/core";
import type { LeadershipState, LocksLike } from "@web-locks/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type UseLeaderOptions = {
  /** Runs when this tab becomes the leader. */
  onPromoted?(): void | Promise<void>;
  /** Runs before leadership is released. */
  onDemoted?(): void | Promise<void>;
  /** Set to false to step down (and stay out of the election). Defaults to true. */
  enabled?: boolean;
  /** Lock manager to use; defaults to `navigator.locks`. Keep it referentially stable. */
  locks?: LocksLike;
};

/** A tiny store that exists before the leader does (the leader is created in an effect). */
function createStateStore() {
  let state: LeadershipState = "pending";
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: LeadershipState) => {
      if (state === next) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Leader election across tabs. Returns "pending" on the server and on the
 * first client render; the election starts after mount.
 */
export function useLeader(name: string, options: UseLeaderOptions = {}): LeadershipState {
  const { enabled = true, locks } = options;
  const [store] = useState(createStateStore);

  // Callbacks live in refs so changing them never re-elects.
  const callbacks = useRef(options);
  useEffect(() => {
    callbacks.current = options;
  });

  useEffect(() => {
    if (!enabled) {
      store.set("pending");
      return;
    }
    const leader = createLeader({
      name,
      locks,
      onPromoted: () => callbacks.current.onPromoted?.(),
      onDemoted: () => callbacks.current.onDemoted?.(),
    });
    const sync = () => store.set(leader.getState());
    const unsubscribe = leader.subscribe(sync);
    leader.start();
    sync();
    return () => {
      unsubscribe();
      // stop() is async; the core serializes it against later start() calls.
      void leader.stop();
      store.set("pending");
    };
  }, [name, locks, enabled, store]);

  return useSyncExternalStore(store.subscribe, store.getState, () => "pending");
}
