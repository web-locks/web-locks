import { FakeLockManager } from "@web-locks/fake-locks";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { queryLocks } from "../src/query.ts";
import { isSupported } from "../src/support.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isSupported", () => {
  it("is false with no navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isSupported()).toBe(false);
  });

  it("is true with injected fake", () => {
    expect(isSupported(new FakeLockManager())).toBe(true);
  });
});

describe("queryLocks", () => {
  it("returns {held:[],pending:[]} when unsupported", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(await queryLocks()).toEqual({ held: [], pending: [] });
  });

  it("reflects fake state", async () => {
    const locks = new FakeLockManager();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const done = locks.request("a", () => held);
    const snap = await queryLocks(locks);
    expect(snap.held?.map((l) => l.name)).toEqual(["a"]);
    release();
    await done;
    expect((await queryLocks(locks)).held).toEqual([]);
  });
});
