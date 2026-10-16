import { queryLocks } from "@web-locks/core";
import type { LocksLike } from "@web-locks/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type UseLockQueryOptions = {
  /** Re-query every this many milliseconds. No polling unless greater than 0. */
  pollInterval?: number;
  /** Lock manager to query. Defaults to `navigator.locks`; should be referentially stable. */
  locks?: LocksLike;
};

type Snapshot = { held: LockInfo[]; pending: LockInfo[] };

// Stable initial value: identical on the server and the first client render.
const EMPTY: Snapshot = { held: [], pending: [] };

function sameList(a: LockInfo[], b: LockInfo[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]!;
      return x.name === y.name && x.mode === y.mode && x.clientId === y.clientId;
    })
  );
}

/**
 * Observe the held and pending locks of the lock manager.
 *
 * Starts empty (also on the server), queries once after mount, and re-queries
 * every `pollInterval` ms when that is greater than 0. `refresh()` queries now
 * and resolves once the result has been applied (or discarded). Results that
 * arrive after unmount, or after a newer query started, are ignored; a failed
 * query keeps the previous value. An unchanged snapshot does not re-render.
 */
export function useLockQuery(options: UseLockQueryOptions = {}): {
  held: LockInfo[];
  pending: LockInfo[];
  refresh: () => Promise<void>;
} {
  const { pollInterval, locks } = options;
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const mounted = useRef(false);
  const latest = useRef(0);
  const current = useRef(EMPTY);

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    let result: LockManagerSnapshot;
    try {
      result = await queryLocks(locks);
    } catch {
      return; // keep the previous value
    }
    if (!mounted.current || id !== latest.current) return;
    const next = { held: result.held ?? [], pending: result.pending ?? [] };
    const prev = current.current;
    if (sameList(prev.held, next.held) && sameList(prev.pending, next.pending)) return;
    current.current = next;
    setSnapshot(next);
  }, [locks]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer =
      pollInterval !== undefined && pollInterval > 0
        ? setInterval(() => void refresh(), pollInterval)
        : undefined;
    return () => {
      mounted.current = false;
      latest.current++; // invalidate anything in flight
      if (timer !== undefined) clearInterval(timer);
    };
  }, [refresh, pollInterval]);

  return { held: snapshot.held, pending: snapshot.pending, refresh };
}
