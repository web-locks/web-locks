import { describe, expect, it } from "vite-plus/test";
import { FakeLockManager } from "../src/index.ts";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("FakeLockManager", () => {
  it("exclusive requests run one at a time in order", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const a = deferred();
    const pa = locks.request("x", async () => {
      log.push("a:start");
      await a.promise;
      log.push("a:end");
      return 1;
    });
    const pb = locks.request("x", async () => {
      log.push("b:start");
      return 2;
    });
    await tick();
    expect(log).toEqual(["a:start"]);
    a.resolve();
    expect(await pa).toBe(1);
    expect(await pb).toBe(2);
    expect(log).toEqual(["a:start", "a:end", "b:start"]);
    expect(locks.heldNames()).toEqual([]);
  });

  it("shared requests run together, exclusive waits for them", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const s1 = deferred();
    const s2 = deferred();
    const p1 = locks.request("x", { mode: "shared" }, async () => {
      log.push("s1");
      await s1.promise;
    });
    const p2 = locks.request("x", { mode: "shared" }, async () => {
      log.push("s2");
      await s2.promise;
    });
    const pe = locks.request("x", async () => {
      log.push("e");
    });
    const p3 = locks.request("x", { mode: "shared" }, async () => {
      log.push("s3");
    });
    await tick();
    expect(log).toEqual(["s1", "s2"]);
    s1.resolve();
    await p1;
    await tick();
    expect(log).toEqual(["s1", "s2"]);
    s2.resolve();
    await Promise.all([p2, pe, p3]);
    expect(log).toEqual(["s1", "s2", "e", "s3"]);
  });

  it("ifAvailable gives null when held", async () => {
    const locks = new FakeLockManager();
    const d = deferred();
    const p = locks.request("x", () => d.promise);
    await tick();
    const seen = await locks.request("x", { ifAvailable: true }, (lock) => lock);
    expect(seen).toBeNull();
    const free = await locks.request("y", { ifAvailable: true }, (lock) => lock?.name);
    expect(free).toBe("y");
    d.resolve();
    await p;
  });

  it("steal rejects the displaced holder with AbortError and runs immediately", async () => {
    const locks = new FakeLockManager();
    const d = deferred();
    const victim = locks.request("x", () => d.promise);
    const victimResult = victim.catch((e: unknown) => e);
    await tick();
    const result = await locks.request("x", { steal: true }, () => "stolen");
    expect(result).toBe("stolen");
    const err = (await victimResult) as DOMException;
    expect(err.name).toBe("AbortError");
    d.resolve();
  });

  it("aborting a queued request rejects with AbortError and never runs", async () => {
    const locks = new FakeLockManager();
    const d = deferred();
    const holder = locks.request("x", () => d.promise);
    await tick();
    const ac = new AbortController();
    let ran = false;
    const queued = locks.request("x", { signal: ac.signal }, () => {
      ran = true;
    });
    ac.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    const pre = new AbortController();
    pre.abort();
    await expect(locks.request("z", { signal: pre.signal }, () => {})).rejects.toMatchObject({
      name: "AbortError",
    });
    d.resolve();
    await holder;
    await tick();
    expect(ran).toBe(false);
  });

  it("query lists held and pending", async () => {
    const locks = new FakeLockManager();
    const d = deferred();
    const p1 = locks.request("x", () => d.promise);
    const p2 = locks.request("x", { mode: "shared" }, () => {});
    await tick();
    const snap = await locks.query();
    expect(snap.held).toEqual([expect.objectContaining({ name: "x", mode: "exclusive" })]);
    expect(snap.pending).toEqual([expect.objectContaining({ name: "x", mode: "shared" })]);
    expect(locks.heldNames()).toEqual(["x"]);
    d.resolve();
    await Promise.all([p1, p2]);
    expect(await locks.query()).toEqual({ held: [], pending: [] });
  });
});
