import { reportError } from "./errors.ts";
import { resolveLocks } from "./support.ts";
import type { LeadershipState, LocksLike, Store } from "./types.ts";

/** Page-lifecycle hooks: a frozen page gives up leadership until it resumes. */
export type PageEvents = {
  onFreeze(callback: () => void): () => void;
  onResume(callback: () => void): () => void;
};

export type LeaderOptions = {
  /** The lock name every tab competing for leadership uses. */
  name: string;
  /** Runs when this tab becomes the leader. */
  onPromoted?(): void | Promise<void>;
  /** Runs before the lock is released, so the next leader never overlaps this one. */
  onDemoted?(): void | Promise<void>;
  /**
   * Receives errors thrown by the hooks and failed lock requests (which are
   * retried every second). Defaults to the global `reportError` (or
   * `console.error`).
   */
  onError?: (error: unknown) => void;
  /** Lock manager to use; defaults to `navigator.locks`. */
  locks?: LocksLike;
  /** Defaults to `windowPageEvents` when `document` exists. */
  pageEvents?: PageEvents;
};

export type Leader = Store<LeadershipState> & {
  /** Joins the election. Idempotent. */
  start: () => void;
  /** Gives up leadership (or a queued request) and waits until demotion has finished. */
  stop: () => Promise<void>;
};

const RETRY_MS = 1000;

const isAbort = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "AbortError";

/**
 * Leader election with the Web Locks API.
 *
 * One exclusive lock, held by a promise that resolves only when this tab
 * resigns, so leadership lasts until the tab stops, closes, crashes or
 * freezes. The browser hands the lock to the next waiting tab.
 */
export function createLeader(options: LeaderOptions): Leader {
  const { name } = options;
  const pageEvents =
    options.pageEvents ?? (typeof document !== "undefined" ? windowPageEvents : undefined);

  let state: LeadershipState = resolveLocks(options.locks) ? "pending" : "unsupported";
  const listeners = new Set<() => void>();

  let locks: LocksLike | undefined;
  let running = false;
  let paused = false;
  let leading = false;
  let resignRequested = false;
  let resignLead: (() => void) | null = null;
  let currentLead: Promise<void> | null = null;
  let abort: AbortController | null = null;
  let loopPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let generation = 0; // incremented by every start()/stop() call
  let targetStart = false; // latest intent: true = start, false = stop
  const unsubscribers: Array<() => void> = [];

  const setState = (next: LeadershipState) => {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const report = (error: unknown) => reportError(options.onError, error);

  const resign = () => {
    if (!leading) {
      // Queued as standby: drop out of the queue.
      abort?.abort();
      return;
    }
    resignRequested = true;
    resignLead?.();
  };

  const lead = async () => {
    // The lock may be granted after stop()/freeze: then release it at once.
    if (!running || paused) return;
    leading = true;
    resignRequested = false;
    setState("leader");
    try {
      await options.onPromoted?.();
    } catch (error) {
      report(error);
    }
    if (!resignRequested) {
      await new Promise<void>((resolve) => {
        resignLead = resolve;
      });
    }
    resignLead = null;
    try {
      await options.onDemoted?.();
    } catch (error) {
      report(error);
    }
    leading = false;
    setState("standby");
  };

  /** Resolves true if this tab got the lock, false if it was not free (only when `ifAvailable`). */
  const acquire = (ifAvailable: boolean): Promise<boolean> => {
    abort = ifAvailable ? null : new AbortController();
    const lockOptions: LockOptions = abort
      ? { mode: "exclusive", signal: abort.signal }
      : { mode: "exclusive", ifAvailable: true };
    let failed = false;
    const request = locks!.request(name, lockOptions, async (lock) => {
      // A request that already failed (stolen before this callback ran) must not lead.
      if (!lock || failed) return false;
      const led = lead();
      currentLead = led;
      try {
        await led;
      } finally {
        currentLead = null;
      }
      return true;
    }) as Promise<boolean>;
    request.catch(() => {
      failed = true;
    });
    return request;
  };

  const loop = async () => {
    let ifAvailable = true; // first try: if the lock is free we lead at once, with no standby flash
    while (running && !paused) {
      try {
        const led = await acquire(ifAvailable);
        if (!led && running && !paused) setState("standby");
        ifAvailable = false; // from now on, queue behind whoever holds the lock
      } catch (error) {
        // The request failed while our callback was still leading: the lock was
        // taken from us (another context requested it with `steal`). Demote now
        // and wait until onDemoted has finished before queueing again.
        const lost = leading;
        if (lost) {
          resignRequested = true;
          resignLead?.();
          await currentLead;
        }
        // Our own abort (stop or freeze): leave the loop. Stolen locks re-queue.
        if (!running || paused || abort?.signal.aborted) break;
        if (isAbort(error)) {
          // Not our abort, so the lock was stolen (possibly before our callback ran).
          ifAvailable = false; // queue behind the thief
          continue;
        }
        report(error);
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  };

  const runLoop = () => {
    if (loopPromise) return;
    loopPromise = loop().finally(() => {
      loopPromise = null;
      // start() may have been called while the loop was finishing.
      if (running && !paused && targetStart) runLoop();
    });
  };

  const doStart = () => {
    if (running) return;
    locks = resolveLocks(options.locks);
    if (!locks) {
      setState("unsupported");
      return;
    }
    running = true;
    paused = false;
    setState("pending");
    if (pageEvents) {
      unsubscribers.push(
        pageEvents.onFreeze(() => {
          // A frozen page cannot act as leader: resign and stay out of the queue until resume.
          paused = true;
          resign();
        }),
        pageEvents.onResume(() => {
          paused = false;
          if (running) runLoop();
        }),
      );
    }
    runLoop();
  };

  const doStop = async () => {
    if (!running) return;
    const myGeneration = generation;
    stopPromise = (async () => {
      running = false;
      unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
      abort?.abort();
      resign();
      // The loop's finally may start a new loop; wait until none is left.
      while (loopPromise) await loopPromise;
      setState("pending");
    })().finally(() => {
      stopPromise = null;
      // A start() issued while stopping runs now.
      if (targetStart && generation > myGeneration) doStart();
    });
    await stopPromise;
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      generation++;
      targetStart = true;
      // A stop in flight runs this start when it finishes.
      if (stopPromise) return;
      doStart();
    },
    stop: async () => {
      generation++;
      targetStart = false;
      if (stopPromise) {
        await stopPromise;
        return;
      }
      await doStop();
    },
  };
}

/** The real page-lifecycle events (Chromium fires `freeze` and `resume`). Touches `document` only when called. */
export const windowPageEvents: PageEvents = {
  onFreeze(callback) {
    document.addEventListener("freeze", callback);
    return () => document.removeEventListener("freeze", callback);
  },
  onResume(callback) {
    document.addEventListener("resume", callback);
    return () => document.removeEventListener("resume", callback);
  },
};
