import { FakeLockManager } from "@web-locks/fake-locks";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createLockStatus } from "../src/status.ts";

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
    const holder = await (await import("../src/lock.ts")).acquireLock("x", { locks });
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
    const { acquireLock } = await import("../src/lock.ts");
    const holder = await acquireLock("x", { locks });
    const s = createLockStatus("x", { locks });
    s.start();
    expect(s.getState()).toBe("pending");
    const p = s.release();
    expect(s.getState()).toBe("idle");
    await holder!.release();
    await p;
    await tick();
    expect(s.getState()).toBe("idle");
    expect(locks.heldNames()).toEqual([]);
  });

  it("release during pending releases the late grant when caller supplied a signal", async () => {
    const locks = new FakeLockManager();
    const { acquireLock } = await import("../src/lock.ts");
    const holder = await acquireLock("x", { locks });
    const s = createLockStatus("x", { locks, signal: new AbortController().signal });
    s.start();
    const p = s.release();
    await holder!.release();
    await p;
    await tick();
    expect(s.getState()).toBe("idle");
    expect(locks.heldNames()).toEqual([]);
  });

  it("stale grant does not affect a restarted store", async () => {
    const locks = new FakeLockManager();
    const { acquireLock } = await import("../src/lock.ts");
    const holder = await acquireLock("x", { locks });
    const s = createLockStatus("x", { locks, signal: new AbortController().signal });
    s.start();
    void s.release();
    s.start();
    await holder!.release();
    await tick();
    expect(s.getState()).toBe("held");
    expect(locks.heldNames()).toEqual(["x"]);
    await s.release();
    expect(locks.heldNames()).toEqual([]);
  });

  it("stolen lock returns to idle and calls user onLost", async () => {
    const locks = new FakeLockManager();
    const { acquireLock } = await import("../src/lock.ts");
    const onLost = vi.fn(() => {
      throw new Error("boom");
    });
    const s = createLockStatus("x", { locks, onLost });
    s.start();
    await tick();
    expect(s.getState()).toBe("held");
    const thief = await acquireLock("x", { locks, steal: true });
    await tick();
    expect(s.getState()).toBe("idle");
    expect(onLost).toHaveBeenCalledTimes(1);
    await thief!.release();
  });

  it("onAcquired fires once and a throwing one does not break the store", async () => {
    const locks = new FakeLockManager();
    const onAcquired = vi.fn(() => {
      throw new Error("boom");
    });
    const s = createLockStatus("x", { locks, onAcquired });
    s.start();
    await tick();
    expect(s.getState()).toBe("held");
    expect(onAcquired).toHaveBeenCalledTimes(1);
    await s.release();
  });
});
