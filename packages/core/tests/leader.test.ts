import { FakeLockManager } from "@web-locks/fake-locks";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createLeader, windowPageEvents } from "../src/leader.ts";
import type { LeaderOptions, PageEvents } from "../src/leader.ts";
import type { LeadershipState, LocksLike } from "../src/types.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const NAME = "leader";

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function fakePageEvents() {
  const freezeCallbacks = new Set<() => void>();
  const resumeCallbacks = new Set<() => void>();
  const events: PageEvents = {
    onFreeze: (cb) => (freezeCallbacks.add(cb), () => void freezeCallbacks.delete(cb)),
    onResume: (cb) => (resumeCallbacks.add(cb), () => void resumeCallbacks.delete(cb)),
  };
  return {
    events,
    freeze: () => freezeCallbacks.forEach((cb) => cb()),
    resume: () => resumeCallbacks.forEach((cb) => cb()),
    listenerCount: () => freezeCallbacks.size + resumeCallbacks.size,
  };
}

/**
 * Wraps a FakeLockManager so granted callbacks are held back until
 * `runDeferred()`, opening a window between "lock granted" and "callback runs".
 */
function deferringLocks(inner: FakeLockManager) {
  const deferred: Array<() => void> = [];
  const locks: LocksLike = {
    query: () => inner.query(),
    request: ((name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) =>
      inner.request(
        name,
        options,
        (lock) =>
          new Promise((resolve, reject) => {
            deferred.push(() => {
              Promise.resolve(callback(lock)).then(resolve, reject);
            });
          }),
      )) as LocksLike["request"],
  };
  return { locks, runDeferred: () => deferred.splice(0).forEach((run) => run()) };
}

type TabOptions = {
  demoteDelayMs?: number;
  pageEvents?: PageEvents;
  onPromoted?: () => void | Promise<void>;
  onDemoted?: () => void | Promise<void>;
  onError?: (error: unknown) => void;
};

function makeTab(
  name: string,
  locks: LocksLike | undefined,
  log: string[],
  options: TabOptions = {},
) {
  const states: LeadershipState[] = [];
  const leaderOptions: LeaderOptions = {
    name: NAME,
    locks,
    pageEvents: options.pageEvents,
    onError: options.onError,
    onPromoted:
      options.onPromoted ??
      (() => {
        log.push(`${name}:promoted`);
      }),
    onDemoted:
      options.onDemoted ??
      (async () => {
        if (options.demoteDelayMs)
          await new Promise((resolve) => setTimeout(resolve, options.demoteDelayMs));
        log.push(`${name}:demoted`);
      }),
  };
  const leader = createLeader(leaderOptions);
  leader.subscribe(() => states.push(leader.getState()));
  return { leader, leadership: () => leader.getState(), states };
}

describe("createLeader", () => {
  it("first tab leads immediately with no standby flash", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const a = makeTab("A", locks, log);
    expect(a.leadership()).toBe("pending");
    a.leader.start();
    expect(a.leadership()).toBe("pending");
    await flush();
    expect(a.leadership()).toBe("leader");
    expect(a.states).toEqual(["leader"]); // already pending, so the only change is to leader
    expect(a.states).not.toContain("standby");
    expect(log).toEqual(["A:promoted"]);
    expect(locks.heldNames()).toEqual([NAME]);
    await a.leader.stop();
    expect(locks.heldNames()).toEqual([]);
  });

  it("second tab is standby then promoted when leader stops", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const a = makeTab("A", locks, log);
    const b = makeTab("B", locks, log);
    a.leader.start();
    await flush();
    b.leader.start();
    await flush();
    expect(a.leadership()).toBe("leader");
    expect(b.leadership()).toBe("standby");
    expect(log).toEqual(["A:promoted"]);
    await a.leader.stop();
    await flush();
    expect(a.leadership()).toBe("pending");
    expect(b.leadership()).toBe("leader");
    expect(b.states).toEqual(["standby", "leader"]);
    expect(log).toEqual(["A:promoted", "A:demoted", "B:promoted"]);
    await b.leader.stop();
  });

  it("onDemoted runs before the lock is released", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const heldDuringDemote: string[][] = [];
    const a = makeTab("A", locks, log, {
      onDemoted: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        heldDuringDemote.push(locks.heldNames());
        log.push("A:demoted");
      },
    });
    const b = makeTab("B", locks, log);
    a.leader.start();
    await flush();
    b.leader.start();
    await flush();
    const stopping = a.leader.stop();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(log).toEqual(["A:promoted"]); // A is still demoting; B must not be promoted yet
    expect(b.leadership()).toBe("standby");
    await stopping;
    await flush();
    expect(heldDuringDemote).toEqual([[NAME]]);
    expect(log).toEqual(["A:promoted", "A:demoted", "B:promoted"]);
    expect(b.leadership()).toBe("leader");
    await b.leader.stop();
    expect(locks.heldNames()).toEqual([]);
  });

  it("stop while queued aborts without ever leading", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const a = makeTab("A", locks, log);
    const b = makeTab("B", locks, log);
    a.leader.start();
    await flush();
    b.leader.start();
    await flush();
    expect((await locks.query()).pending).toHaveLength(1);
    await b.leader.stop();
    expect((await locks.query()).pending).toHaveLength(0); // queued request aborted
    await a.leader.stop();
    await flush();
    expect(log).toEqual(["A:promoted", "A:demoted"]);
    expect(b.leadership()).toBe("pending");
    expect(locks.heldNames()).toEqual([]);
  });

  it("stop between lock grant and callback never promotes and resolves", async () => {
    const inner = new FakeLockManager();
    const { locks, runDeferred } = deferringLocks(inner);
    const log: string[] = [];
    const tab = makeTab("A", locks, log);
    tab.leader.start();
    await flush();
    expect(inner.heldNames()).toEqual([NAME]); // granted, callback held back
    const stopping = tab.leader.stop();
    runDeferred();
    await stopping;
    await flush();
    expect(log).toEqual([]);
    expect(tab.leadership()).toBe("pending");
    expect(inner.heldNames()).toEqual([]);
  });

  it("start/stop/start settles on latest intent", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const a = makeTab("A", locks, log, { demoteDelayMs: 20 });
    a.leader.start();
    await flush();
    expect(a.leadership()).toBe("leader");
    const stopping = a.leader.stop();
    a.leader.start();
    await stopping;
    await flush();
    expect(log).toEqual(["A:promoted", "A:demoted", "A:promoted"]);
    expect(a.leadership()).toBe("leader");
    expect(locks.heldNames()).toEqual([NAME]);
    await a.leader.stop();
    expect(locks.heldNames()).toEqual([]);
  });

  it("stop/start/stop settles on stopped", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const tab = makeTab("A", locks, log);
    tab.leader.start();
    await flush();
    void tab.leader.stop();
    tab.leader.start();
    void tab.leader.stop();
    await flush();
    expect(tab.leadership()).toBe("pending");
    expect(log).toEqual(["A:promoted", "A:demoted"]);
    expect(locks.heldNames()).toEqual([]);
  });

  it("standby stop/start un-awaited leaves exactly one queued request", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const a = makeTab("A", locks, log);
    const b = makeTab("B", locks, log);
    a.leader.start();
    await flush();
    b.leader.start();
    await flush();
    const stopping = b.leader.stop();
    b.leader.start();
    await stopping;
    await flush();
    expect((await locks.query()).pending).toHaveLength(1);
    await a.leader.stop();
    await flush();
    expect(b.leadership()).toBe("leader");
    expect(log.filter((l) => l === "B:promoted")).toHaveLength(1);
    await b.leader.stop();
  });

  it("awaited stop then start leads again", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const tab = makeTab("A", locks, log);
    tab.leader.start();
    await flush();
    await tab.leader.stop();
    expect(tab.leadership()).toBe("pending");
    tab.leader.start();
    await flush();
    expect(log).toEqual(["A:promoted", "A:demoted", "A:promoted"]);
    expect(tab.leadership()).toBe("leader");
    await tab.leader.stop();
  });

  it("concurrent stop() calls await the same teardown", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const tab = makeTab("A", locks, log, { demoteDelayMs: 10 });
    tab.leader.start();
    await flush();
    await Promise.all([tab.leader.stop(), tab.leader.stop(), tab.leader.stop()]);
    expect(tab.leadership()).toBe("pending");
    expect(log).toEqual(["A:promoted", "A:demoted"]);
    expect(locks.heldNames()).toEqual([]);
  });

  it("freeze resigns and resume re-queues", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const page = fakePageEvents();
    const a = makeTab("A", locks, log, { pageEvents: page.events });
    const b = makeTab("B", locks, log);
    a.leader.start();
    await flush();
    b.leader.start();
    await flush();

    page.freeze();
    await flush();
    expect(log).toEqual(["A:promoted", "A:demoted", "B:promoted"]);
    expect(b.leadership()).toBe("leader");
    expect(a.leadership()).toBe("standby");
    expect((await locks.query()).pending).toHaveLength(0); // A stays out of the queue

    page.resume();
    await flush();
    expect(a.leadership()).toBe("standby"); // queued behind B
    expect((await locks.query()).pending).toHaveLength(1);
    await b.leader.stop();
    await flush();
    expect(a.leadership()).toBe("leader");
    expect(log.at(-1)).toBe("A:promoted");
    await a.leader.stop();
    expect(page.listenerCount()).toBe(0);
  });

  it("frozen standby tab is not promoted until resume", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const page = fakePageEvents();
    const a = makeTab("A", locks, log);
    const b = makeTab("B", locks, log, { pageEvents: page.events });
    a.leader.start();
    await flush();
    b.leader.start();
    await flush();
    page.freeze();
    await flush();
    expect(b.leadership()).toBe("standby");
    expect((await locks.query()).pending).toHaveLength(0); // queued request aborted
    await a.leader.stop();
    await flush();
    expect(b.leadership()).toBe("standby");
    expect(log).toEqual(["A:promoted", "A:demoted"]);
    page.resume();
    await flush();
    expect(b.leadership()).toBe("leader");
    expect(log.at(-1)).toBe("B:promoted");
    await b.leader.stop();
  });

  it("freeze between lock grant and callback never promotes", async () => {
    const inner = new FakeLockManager();
    const { locks, runDeferred } = deferringLocks(inner);
    const log: string[] = [];
    const page = fakePageEvents();
    const tab = makeTab("A", locks, log, { pageEvents: page.events });
    tab.leader.start();
    await flush();
    page.freeze();
    await flush();
    runDeferred();
    await flush();
    expect(log).toEqual([]);
    expect(tab.leadership()).toBe("pending");
    expect(inner.heldNames()).toEqual([]);
    await tab.leader.stop();
  });

  it("unsupported locks → state unsupported, start is safe", async () => {
    vi.stubGlobal("navigator", {});
    const log: string[] = [];
    const tab = makeTab("A", undefined, log);
    expect(tab.leadership()).toBe("unsupported");
    expect(() => tab.leader.start()).not.toThrow();
    await flush();
    expect(tab.leadership()).toBe("unsupported");
    await expect(tab.leader.stop()).resolves.toBeUndefined();
    expect(tab.leadership()).toBe("unsupported");
    expect(tab.states).toEqual([]);
    expect(log).toEqual([]);
  });

  it("falls back to navigator.locks when no locks option is given", async () => {
    const locks = new FakeLockManager();
    vi.stubGlobal("navigator", { locks });
    const log: string[] = [];
    const tab = makeTab("A", undefined, log);
    tab.leader.start();
    await flush();
    expect(tab.leadership()).toBe("leader");
    expect(locks.heldNames()).toEqual([NAME]);
    await tab.leader.stop();
  });

  it("onPromoted throwing goes to onError and leadership continues", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const boom = new Error("promote failed");
    const onError = vi.fn();
    const a = makeTab("A", locks, log, {
      onError,
      onPromoted: () => {
        throw boom;
      },
    });
    const b = makeTab("B", locks, log);
    a.leader.start();
    await flush();
    expect(onError).toHaveBeenCalledWith(boom);
    expect(a.leadership()).toBe("leader");
    expect(locks.heldNames()).toEqual([NAME]);
    b.leader.start();
    await flush();
    expect(b.leadership()).toBe("standby");
    await a.leader.stop();
    await flush();
    expect(log).toEqual(["A:demoted", "B:promoted"]);
    expect(b.leadership()).toBe("leader");
    await b.leader.stop();
  });

  it("onDemoted throwing goes to onError and the lock is still released", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const boom = new Error("demote failed");
    const onError = vi.fn();
    const a = makeTab("A", locks, log, {
      onError,
      onDemoted: async () => {
        await Promise.resolve();
        throw boom;
      },
    });
    const b = makeTab("B", locks, log);
    a.leader.start();
    await flush();
    b.leader.start();
    await flush();
    await a.leader.stop();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    expect(a.leadership()).toBe("pending");
    expect(a.states).toEqual(["leader", "standby", "pending"]); // demotion completed normally
    expect(b.leadership()).toBe("leader");
    expect(log).toEqual(["A:promoted", "B:promoted"]);
    await b.leader.stop();
    expect(locks.heldNames()).toEqual([]);
  });

  it("onDemoted throwing alone still releases the lock", async () => {
    const locks = new FakeLockManager();
    const onError = vi.fn();
    const tab = makeTab("A", locks, [], {
      onError,
      onDemoted: () => {
        throw new Error("x");
      },
    });
    tab.leader.start();
    await flush();
    expect(locks.heldNames()).toEqual([NAME]);
    await tab.leader.stop();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(locks.heldNames()).toEqual([]);
  });

  it("hooks are optional and errors without onError go to console.error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const locks = new FakeLockManager();
    const leader = createLeader({ name: NAME, locks });
    leader.start();
    await flush();
    expect(leader.getState()).toBe("leader");
    await leader.stop();
    expect(leader.getState()).toBe("pending");
    expect(locks.heldNames()).toEqual([]);

    const throwing = createLeader({
      name: NAME,
      locks,
      onPromoted: () => {
        throw new Error("x");
      },
    });
    throwing.start();
    await flush();
    expect(throwing.getState()).toBe("leader");
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]![0]).toMatchObject({ message: "x" });
    await throwing.stop();
    expect(locks.heldNames()).toEqual([]);
    consoleError.mockRestore();
  });

  it("retries a failed lock request after 1s and reports it to onError", async () => {
    vi.useFakeTimers();
    const inner = new FakeLockManager();
    const failure = new Error("request failed");
    let calls = 0;
    const locks: LocksLike = {
      query: () => inner.query(),
      request: ((...args: Parameters<LocksLike["request"]>) => {
        calls++;
        if (calls === 1) return Promise.reject(failure);
        return (inner.request as (...a: unknown[]) => Promise<unknown>)(...args);
      }) as LocksLike["request"],
    };
    const onError = vi.fn();
    const tab = makeTab("A", locks, [], { onError });
    tab.leader.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    expect(tab.leadership()).toBe("leader");
    const stopping = tab.leader.stop();
    await vi.advanceTimersByTimeAsync(0);
    await stopping;
    expect(inner.heldNames()).toEqual([]);
  });

  it("subscribe notifies on each state change and unsubscribes", async () => {
    const locks = new FakeLockManager();
    const a = createLeader({ name: NAME, locks });
    const b = createLeader({ name: NAME, locks });
    const seen: LeadershipState[] = [];
    const unsub = b.subscribe(() => seen.push(b.getState()));
    a.start();
    await flush();
    b.start();
    b.start(); // duplicate start: no extra notifications
    await flush();
    expect(seen).toEqual(["standby"]);
    expect(b.getState()).toBe(b.getState()); // stable snapshot
    await a.stop();
    await flush();
    expect(seen).toEqual(["standby", "leader"]);
    unsub();
    await b.stop();
    expect(b.getState()).toBe("pending");
    expect(seen).toEqual(["standby", "leader"]);
  });

  it("windowPageEvents does not touch document until used", async () => {
    expect(typeof document).toBe("undefined"); // module imported above without a document
    const added: Array<[string, unknown]> = [];
    const removed: Array<[string, unknown]> = [];
    vi.stubGlobal("document", {
      addEventListener: (type: string, cb: unknown) => added.push([type, cb]),
      removeEventListener: (type: string, cb: unknown) => removed.push([type, cb]),
    });
    const cb = () => {};
    const offFreeze = windowPageEvents.onFreeze(cb);
    const offResume = windowPageEvents.onResume(cb);
    expect(added).toEqual([
      ["freeze", cb],
      ["resume", cb],
    ]);
    offFreeze();
    offResume();
    expect(removed).toEqual([
      ["freeze", cb],
      ["resume", cb],
    ]);
  });

  it("defaults pageEvents to windowPageEvents only when document exists", async () => {
    const locks = new FakeLockManager();
    // No document: start works without page events.
    const ssr = createLeader({ name: NAME, locks });
    ssr.start();
    await flush();
    expect(ssr.getState()).toBe("leader");
    await ssr.stop();

    const listeners = new Map<string, () => void>();
    vi.stubGlobal("document", {
      addEventListener: (type: string, cb: () => void) => listeners.set(type, cb),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    const tab = createLeader({ name: NAME, locks });
    tab.start();
    await flush();
    expect([...listeners.keys()].sort()).toEqual(["freeze", "resume"]);
    expect(tab.getState()).toBe("leader");
    listeners.get("freeze")!();
    await flush();
    expect(tab.getState()).toBe("standby");
    expect(locks.heldNames()).toEqual([]);
    listeners.get("resume")!();
    await flush();
    expect(tab.getState()).toBe("leader");
    await tab.stop();
    expect(listeners.size).toBe(0);
  });
});

describe("createLeader with a stolen lock", () => {
  const trackUnhandled = () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    return { unhandled, dispose: () => process.off("unhandledRejection", listener) };
  };

  /** Steals NAME and holds it until the returned release() is called. */
  const steal = (locks: LocksLike) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let granted = false;
    const done = locks.request(NAME, { steal: true }, async () => {
      granted = true;
      await held;
    });
    return { done, release, granted: () => granted };
  };

  it("a stolen leader is demoted once, then re-queues and leads again", async () => {
    const tracker = trackUnhandled();
    try {
      const locks = new FakeLockManager();
      const log: string[] = [];
      const onError = vi.fn();
      const a = makeTab("A", locks, log, { onError });
      a.leader.start();
      await flush();
      expect(a.leadership()).toBe("leader");

      const thief = steal(locks);
      await flush();
      expect(thief.granted()).toBe(true);
      expect(log).toEqual(["A:promoted", "A:demoted"]);
      expect(a.leadership()).toBe("standby");
      expect((await locks.query()).pending).toHaveLength(1); // A queued behind the thief
      expect(onError).not.toHaveBeenCalled();

      thief.release();
      await thief.done;
      await flush();
      expect(log).toEqual(["A:promoted", "A:demoted", "A:promoted"]);
      expect(a.leadership()).toBe("leader");
      expect(a.states).toEqual(["leader", "standby", "leader"]);

      await a.leader.stop();
      expect(log).toEqual(["A:promoted", "A:demoted", "A:promoted", "A:demoted"]);
      expect(a.leadership()).toBe("pending");
      expect(locks.heldNames()).toEqual([]);
      expect((await locks.query()).pending).toEqual([]);
      await flush();
      expect(tracker.unhandled).toEqual([]);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      tracker.dispose();
    }
  });

  it("onDemoted of a stolen leader finishes before it re-queues", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const a = makeTab("A", locks, log, { demoteDelayMs: 20 });
    a.leader.start();
    await flush();
    const thief = steal(locks);
    await flush();
    expect(log).toEqual(["A:promoted"]); // still demoting
    expect((await locks.query()).pending).toEqual([]); // not re-queued yet
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flush();
    expect(log).toEqual(["A:promoted", "A:demoted"]);
    expect((await locks.query()).pending).toHaveLength(1);
    thief.release();
    await flush();
    expect(a.leadership()).toBe("leader");
    await a.leader.stop();
    expect(locks.heldNames()).toEqual([]);
  });

  it("stop() while the stolen lock is held elsewhere resolves and leaves nothing behind", async () => {
    const tracker = trackUnhandled();
    try {
      const locks = new FakeLockManager();
      const log: string[] = [];
      const a = makeTab("A", locks, log);
      const b = makeTab("B", locks, log);
      a.leader.start();
      await flush();
      b.leader.start();
      await flush();
      expect(b.leadership()).toBe("standby");

      const thief = steal(locks); // a steal takes the held lock, never B's queued request
      await flush();
      expect(log).toEqual(["A:promoted", "A:demoted"]);
      expect(a.leadership()).toBe("standby");
      expect(b.leadership()).toBe("standby");
      expect((await locks.query()).pending).toHaveLength(2); // B, then A again

      await b.leader.stop();
      await a.leader.stop();
      expect(a.leadership()).toBe("pending");
      expect(b.leadership()).toBe("pending");
      expect((await locks.query()).pending).toEqual([]);
      expect(locks.heldNames()).toEqual([NAME]); // only the thief
      thief.release();
      await thief.done;
      await flush();
      expect(locks.heldNames()).toEqual([]);
      expect(log).toEqual(["A:promoted", "A:demoted"]);
      expect(tracker.unhandled).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });

  it("stop() during the stolen leader's demotion waits for onDemoted", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const a = makeTab("A", locks, log, { demoteDelayMs: 20 });
    a.leader.start();
    await flush();
    const thief = steal(locks);
    await flush();
    await a.leader.stop();
    expect(log).toEqual(["A:promoted", "A:demoted"]);
    expect(a.leadership()).toBe("pending");
    expect((await locks.query()).pending).toEqual([]);
    thief.release();
    await thief.done;
    await flush();
    expect(locks.heldNames()).toEqual([]);
    expect(log).toEqual(["A:promoted", "A:demoted"]);
  });
});

describe("createLeader stolen between grant and callback", () => {
  it("never promotes the stale grant and re-queues behind the thief", async () => {
    const inner = new FakeLockManager();
    const { locks, runDeferred } = deferringLocks(inner);
    const log: string[] = [];
    const onError = vi.fn();
    const a = makeTab("A", locks, log, { onError });
    a.leader.start();
    await flush();
    expect(inner.heldNames()).toEqual([NAME]); // granted, callback held back
    let releaseThief!: () => void;
    const thiefDone = inner.request(
      NAME,
      { steal: true },
      () =>
        new Promise<void>((resolve) => {
          releaseThief = resolve;
        }),
    );
    await flush();
    runDeferred(); // the stale callback finally runs
    await flush();
    expect(log).toEqual([]);
    expect(a.leadership()).not.toBe("leader");
    expect((await inner.query()).pending).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
    releaseThief();
    await thiefDone;
    await flush();
    runDeferred();
    await flush();
    expect(log).toEqual(["A:promoted"]);
    expect(a.leadership()).toBe("leader");
    const stopping = a.leader.stop();
    await stopping;
    expect(inner.heldNames()).toEqual([]);
  });
});

describe("createLeader error reporting", () => {
  const failingLocks = (failure: unknown): LocksLike => ({
    query: async () => ({ held: [], pending: [] }),
    request: (() => Promise.reject(failure)) as LocksLike["request"],
  });

  it("a failing request is reported on every retry and stop() ends it", async () => {
    vi.useFakeTimers();
    const failure = new DOMException("denied", "SecurityError");
    const onError = vi.fn();
    const leader = createLeader({ name: NAME, locks: failingLocks(failure), onError });
    leader.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(2);
    const stopping = leader.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;
    expect(leader.getState()).toBe("pending");
    await vi.advanceTimersByTimeAsync(5000);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("without onError a failing request goes to globalThis.reportError, else console.error", async () => {
    vi.useFakeTimers();
    const failure = new Error("nope");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const leader = createLeader({ name: NAME, locks: failingLocks(failure) });
      leader.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(consoleError).toHaveBeenCalledWith(failure);

      const hostReport = vi.fn();
      vi.stubGlobal("reportError", hostReport);
      await vi.advanceTimersByTimeAsync(1000);
      expect(hostReport).toHaveBeenCalledWith(failure);
      expect(consoleError).toHaveBeenCalledTimes(1);

      const stopping = leader.stop();
      await vi.advanceTimersByTimeAsync(1000);
      await stopping;
    } finally {
      consoleError.mockRestore();
    }
  });

  it("a throwing onError is swallowed", async () => {
    const locks = new FakeLockManager();
    const onError = vi.fn(() => {
      throw new Error("handler failed");
    });
    const leader = createLeader({
      name: NAME,
      locks,
      onError,
      onPromoted: () => {
        throw new Error("x");
      },
    });
    leader.start();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(leader.getState()).toBe("leader");
    await leader.stop();
    expect(locks.heldNames()).toEqual([]);
  });

  it("its own aborts (stop while queued, freeze) are not reported", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const locks = new FakeLockManager();
      const page = fakePageEvents();
      const onError = vi.fn();
      const a = createLeader({ name: NAME, locks });
      const b = createLeader({ name: NAME, locks, onError, pageEvents: page.events });
      const c = createLeader({ name: NAME, locks, onError });
      a.start();
      await flush();
      b.start();
      c.start();
      await flush();
      expect((await locks.query()).pending).toHaveLength(2);
      page.freeze(); // B aborts its queued request
      await c.stop(); // C aborts its queued request
      await flush();
      expect((await locks.query()).pending).toEqual([]);
      await a.stop();
      await b.stop();
      expect(onError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
