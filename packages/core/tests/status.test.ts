import { FakeLockManager } from "@web-locks/fake-locks";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { acquireLock } from "../src/lock.ts";
import { createLockStatus } from "../src/status.ts";
import type { LocksLike } from "../src/types.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createLockStatus", () => {
  it("goes idle -> pending -> held and notifies only on change", async () => {
    const locks = new FakeLockManager();
    const onAcquired = vi.fn();
    const s = createLockStatus("x", { locks, onAcquired });
    const seen: string[] = [];
    const unsub = s.subscribe(() => seen.push(s.getState()));
    expect(s.getState()).toBe("idle");
    s.start();
    s.start();
    expect(s.getState()).toBe("pending");
    await tick();
    expect(s.getState()).toBe("held");
    expect(seen).toEqual(["pending", "held"]);
    expect(onAcquired).toHaveBeenCalledTimes(1);
    await s.release();
    expect(s.getState()).toBe("idle");
    expect(locks.heldNames()).toEqual([]);
    unsub();
    s.start();
    await tick();
    expect(s.getState()).toBe("held");
    expect(seen).toEqual(["pending", "held", "idle"]);
    await s.release();
  });

  it("ifAvailable lost -> unavailable", async () => {
    const locks = new FakeLockManager();
    const holder = await acquireLock("x", { locks });
    const onAcquired = vi.fn();
    const s = createLockStatus("x", { locks, ifAvailable: true, onAcquired });
    s.start();
    await tick();
    expect(s.getState()).toBe("unavailable");
    expect(onAcquired).not.toHaveBeenCalled();
    await holder!.release();
  });

  it("unsupported stays unsupported", () => {
    vi.stubGlobal("navigator", {});
    const s = createLockStatus("x");
    s.start();
    expect(s.getState()).toBe("unsupported");
    s.start();
    expect(s.getState()).toBe("unsupported");
  });

  it("release during pending releases the late grant (ifAvailable-free, aborts queue)", async () => {
    const locks = new FakeLockManager();
    const holder = await acquireLock("x", { locks });
    const s = createLockStatus("x", { locks });
    s.start();
    expect(s.getState()).toBe("pending");
    await tick();
    expect((await locks.query()).pending).toHaveLength(1);
    const p = s.release();
    expect(s.getState()).toBe("idle");
    await tick();
    expect((await locks.query()).pending).toEqual([]);
    await holder!.release();
    await p;
    await tick();
    expect(s.getState()).toBe("idle");
    expect(locks.heldNames()).toEqual([]);
  });

  it("release during pending releases the late grant when caller supplied a signal", async () => {
    const locks = new FakeLockManager();
    const holder = await acquireLock("x", { locks });
    const s = createLockStatus("x", { locks, signal: new AbortController().signal });
    s.start();
    await tick();
    expect((await locks.query()).pending).toHaveLength(1);
    const p = s.release();
    await holder!.release();
    await p;
    await tick();
    expect(s.getState()).toBe("idle");
    expect(locks.heldNames()).toEqual([]);
  });

  it("stale grant does not affect a restarted store", async () => {
    const locks = new FakeLockManager();
    const holder = await acquireLock("x", { locks });
    const s = createLockStatus("x", { locks, signal: new AbortController().signal });
    s.start();
    await tick();
    void s.release();
    s.start();
    await tick();
    expect(s.getState()).toBe("pending");
    expect(locks.heldNames()).toEqual(["x"]);
    await holder!.release();
    await tick();
    await tick();
    expect(s.getState()).toBe("held");
    expect(locks.heldNames()).toEqual(["x"]);
    await s.release();
    expect(locks.heldNames()).toEqual([]);
  });

  it("stolen lock returns to idle and calls user onLost (a throw goes to onError)", async () => {
    const locks = new FakeLockManager();
    const boom = new Error("boom");
    const onLost = vi.fn(() => {
      throw boom;
    });
    const onError = vi.fn();
    const s = createLockStatus("x", { locks, onLost, onError });
    s.start();
    await tick();
    expect(s.getState()).toBe("held");
    const thief = await acquireLock("x", { locks, steal: true });
    await tick();
    expect(s.getState()).toBe("idle");
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    await thief!.release();
  });

  it("onAcquired fires once and a throwing one goes to onError without breaking the store", async () => {
    const locks = new FakeLockManager();
    const boom = new Error("boom");
    const onAcquired = vi.fn(() => {
      throw boom;
    });
    const onError = vi.fn();
    const s = createLockStatus("x", { locks, onAcquired, onError });
    s.start();
    await tick();
    expect(s.getState()).toBe("held");
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
    await s.release();
  });

  it("start, release, start with ifAvailable ends held", async () => {
    const locks = new FakeLockManager();
    const s = createLockStatus("x", { locks, ifAvailable: true });
    s.start();
    void s.release();
    s.start();
    expect(s.getState()).toBe("pending");
    await tick();
    await tick();
    expect(s.getState()).toBe("held");
    await s.release();
    expect(locks.heldNames()).toEqual([]);
  });

  it("start, release, start with steal does not fire onLost for the stale acquisition", async () => {
    const locks = new FakeLockManager();
    const onLost = vi.fn();
    const s = createLockStatus("x", { locks, steal: true, onLost });
    s.start();
    void s.release();
    s.start();
    await tick();
    await tick();
    expect(s.getState()).toBe("held");
    expect(onLost).not.toHaveBeenCalled();
    await s.release();
  });

  it("start, release, release before the second request is issued never acquires", async () => {
    const locks = new FakeLockManager();
    const s = createLockStatus("x", { locks, ifAvailable: true });
    s.start();
    void s.release();
    s.start();
    await s.release();
    await tick();
    expect(s.getState()).toBe("idle");
    expect(locks.heldNames()).toEqual([]);
  });

  it("start, grant, release, start with ifAvailable ends held", async () => {
    const locks = new FakeLockManager();
    const s = createLockStatus("x", { locks, ifAvailable: true });
    s.start();
    await tick();
    expect(s.getState()).toBe("held");
    void s.release();
    s.start();
    await tick();
    await tick();
    expect(s.getState()).toBe("held");
    expect(locks.heldNames()).toEqual(["x"]);
    await s.release();
    expect(locks.heldNames()).toEqual([]);
  });

  it("start, grant, release, start with steal never fires onLost", async () => {
    const locks = new FakeLockManager();
    const onLost = vi.fn();
    const s = createLockStatus("x", { locks, steal: true, onLost });
    s.start();
    await tick();
    expect(s.getState()).toBe("held");
    void s.release();
    s.start();
    await tick();
    await tick();
    expect(s.getState()).toBe("held");
    expect(onLost).not.toHaveBeenCalled();
    await s.release();
  });

  describe("error reporting", () => {
    const failingLocks = (failure: unknown): LocksLike => ({
      query: async () => ({ held: [], pending: [] }),
      request: (() => Promise.reject(failure)) as LocksLike["request"],
    });

    it("a request failing before the grant is reported, then idle", async () => {
      const failure = new DOMException("steal and ifAvailable", "NotSupportedError");
      const onError = vi.fn();
      const s = createLockStatus("x", { locks: failingLocks(failure), onError });
      s.start();
      expect(s.getState()).toBe("pending");
      await tick();
      expect(s.getState()).toBe("idle");
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it("without onError the failure goes to console.error and nothing rejects", async () => {
      const unhandled: unknown[] = [];
      const listener = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", listener);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const failure = new Error("nope");
        const s = createLockStatus("x", { locks: failingLocks(failure) });
        s.start();
        await tick();
        expect(s.getState()).toBe("idle");
        expect(consoleError).toHaveBeenCalledWith(failure);
        await s.release();
        await tick();
        expect(unhandled).toEqual([]);
      } finally {
        consoleError.mockRestore();
        process.off("unhandledRejection", listener);
      }
    });

    it("a throwing onError is swallowed", async () => {
      const onError = vi.fn(() => {
        throw new Error("handler failed");
      });
      const s = createLockStatus("x", { locks: failingLocks(new Error("nope")), onError });
      s.start();
      await tick();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(s.getState()).toBe("idle");
    });

    it("release() aborting a queued request is not reported", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const locks = new FakeLockManager();
        const holder = await acquireLock("x", { locks });
        const onError = vi.fn();
        const s = createLockStatus("x", { locks, onError });
        s.start();
        await tick();
        expect((await locks.query()).pending).toHaveLength(1);
        await s.release();
        await tick();
        expect((await locks.query()).pending).toEqual([]);
        expect(onError).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        await holder!.release();
      } finally {
        consoleError.mockRestore();
      }
    });

    it("a caller-supplied signal aborting a queued request is not reported", async () => {
      const locks = new FakeLockManager();
      const holder = await acquireLock("x", { locks });
      const ctrl = new AbortController();
      const onError = vi.fn();
      const s = createLockStatus("x", { locks, signal: ctrl.signal, onError });
      s.start();
      await tick();
      ctrl.abort();
      await tick();
      expect(s.getState()).toBe("idle");
      expect(onError).not.toHaveBeenCalled();
      await holder!.release();
    });
  });
});
