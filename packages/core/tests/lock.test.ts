import { FakeLockManager } from "@web-locks/fake-locks";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { acquireLock } from "../src/lock.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("acquireLock", () => {
  it("holds the lock until released", async () => {
    const locks = new FakeLockManager();
    const a = await acquireLock("x", { locks });
    expect(a?.name).toBe("x");
    expect(await acquireLock("x", { locks, ifAvailable: true })).toBeNull();
    await a!.release();
    const b = await acquireLock("x", { locks, ifAvailable: true });
    expect(b).not.toBeNull();
    await b!.release();
    expect(locks.heldNames()).toEqual([]);
  });

  it("release is idempotent", async () => {
    const locks = new FakeLockManager();
    const a = await acquireLock("x", { locks });
    await a!.release();
    await a!.release();
    expect(locks.heldNames()).toEqual([]);
  });

  it("shared holders coexist", async () => {
    const locks = new FakeLockManager();
    const a = await acquireLock("x", { locks, mode: "shared" });
    const b = await acquireLock("x", { locks, mode: "shared" });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await a!.release();
    await b!.release();
  });

  it("returns null when unsupported", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(await acquireLock("x")).toBeNull();
  });

  it("steal fires onLost on the displaced handle without unhandled rejection", async () => {
    const locks = new FakeLockManager();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const onLost = vi.fn();
      const a = await acquireLock("x", { locks, onLost });
      const b = await acquireLock("x", { locks, steal: true });
      expect(b).not.toBeNull();
      await tick();
      await tick();
      expect(onLost).toHaveBeenCalledTimes(1);
      await a!.release();
      expect(onLost).toHaveBeenCalledTimes(1);
      await b!.release();
      await tick();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("abort while queued rejects AbortError", async () => {
    const locks = new FakeLockManager();
    const a = await acquireLock("x", { locks });
    const ctrl = new AbortController();
    const pending = acquireLock("x", { locks, signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await a!.release();
  });

  it("propagates non-abort request errors before grant", async () => {
    const boom = new Error("boom");
    const locks = {
      request: () => Promise.reject(boom),
      query: async () => ({ held: [], pending: [] }),
    };
    await expect(acquireLock("x", { locks: locks as never })).rejects.toBe(boom);
  });
});
