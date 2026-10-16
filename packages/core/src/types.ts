/** The subset of `LockManager` this library depends on. */
export type LocksLike = Pick<LockManager, "request" | "query">;

/** Minimal external store contract (compatible with `useSyncExternalStore`). */
export type Store<T> = {
  getState: () => T;
  subscribe: (listener: () => void) => () => void;
};

export type LeadershipState = "pending" | "leader" | "standby" | "unsupported";

export type LockState = "idle" | "pending" | "held" | "unavailable" | "unsupported";
