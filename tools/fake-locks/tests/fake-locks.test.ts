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

  it("releases the lock and runs the next waiter when the callback throws or rejects", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const boom = new Error("sync boom");
    const p1 = locks.request("x", () => {
      throw boom;
    });
    const boom2 = new Error("async boom");
    const p2 = locks.request("x", async () => {
      log.push("second");
      throw boom2;
    });
    const p3 = locks.request("x", () => {
      log.push("third");
      return "ok";
    });
    await expect(p1).rejects.toBe(boom);
    await expect(p2).rejects.toBe(boom2);
    expect(await p3).toBe("ok");
    expect(log).toEqual(["second", "third"]);
    expect(locks.heldNames()).toEqual([]);
  });

  it("aborting after the lock is granted does not cancel the callback", async () => {
    const locks = new FakeLockManager();
    const ac = new AbortController();
    const d = deferred();
    let finished = false;
    const p = locks.request("x", { signal: ac.signal }, async () => {
      await d.promise;
      finished = true;
      return "done";
    });
    await tick();
    ac.abort();
    await tick();
    expect(locks.heldNames()).toEqual(["x"]);
    d.resolve();
    expect(await p).toBe("done");
    expect(finished).toBe(true);
  });

  it("steal while waiters are queued runs them after the stealer in FIFO order", async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const hold = deferred();
    const victim = locks.request("x", () => hold.promise);
    const victimResult = victim.catch((e: unknown) => e);
    const w1 = locks.request("x", () => void log.push("w1"));
    const w2 = locks.request("x", () => void log.push("w2"));
    await tick();
    const s = deferred();
    const stealer = locks.request("x", { steal: true }, async () => {
      log.push("steal");
      await s.promise;
    });
    await tick();
    expect(log).toEqual(["steal"]);
    s.resolve();
    await Promise.all([stealer, w1, w2]);
    expect(log).toEqual(["steal", "w1", "w2"]);
    expect(((await victimResult) as DOMException).name).toBe("AbortError");
    hold.resolve();
  });

  it("a stolen victim finishing later does not release the stealer's lock", async () => {
    const locks = new FakeLockManager();
    const victimDone = deferred();
    const victim = locks.request("x", () => victimDone.promise).catch(() => {});
    await tick();
    const s = deferred();
    const stealer = locks.request("x", { steal: true }, () => s.promise);
    await tick();
    victimDone.resolve();
    await victim;
    await tick();
    expect(locks.heldNames()).toEqual(["x"]);
    const snap = await locks.query();
    expect(snap.held).toHaveLength(1);
    s.resolve();
    await stealer;
    expect(locks.heldNames()).toEqual([]);
  });

  it("query snapshots do not change after being returned", async () => {
    const locks = new FakeLockManager();
    const d = deferred();
    const p1 = locks.request("x", () => d.promise);
    const p2 = locks.request("x", () => {});
    await tick();
    const snap = await locks.query();
    const copy = JSON.parse(JSON.stringify(snap));
    d.resolve();
    await Promise.all([p1, p2]);
    await locks.request("y", () => {});
    expect(JSON.parse(JSON.stringify(snap))).toEqual(copy);
    expect(snap.held).toHaveLength(1);
    expect(snap.pending).toHaveLength(1);
  });
});
