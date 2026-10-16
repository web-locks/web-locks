import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  SNAPSHOT_KEY,
} from "../src/singleton/handoff.ts";
import * as mockService from "../src/singleton/mockService.ts";
import { ServiceClient } from "../src/singleton/serviceClient.ts";
import { acquireClient, startAutosave } from "../src/singleton/session.ts";

const snap = { clientId: "c-1", sessionToken: "tok-abcdefgh", messageCount: 3 };

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("service client", () => {
  it("register increments the count once", () => {
    expect(mockService.registrations()).toBe(0);
    const client = ServiceClient.register();
    expect(mockService.registrations()).toBe(1);
    expect(client.snapshot().messageCount).toBe(0);
  });

  it("resume does not register again", () => {
    const client = ServiceClient.resume(snap);
    expect(mockService.registrations()).toBe(0);
    expect(client.snapshot()).toEqual(snap);
  });

  it("send bumps the message count and notifies listeners", () => {
    const client = ServiceClient.resume(snap);
    const seen: number[] = [];
    const off = client.onChange(() => seen.push(client.snapshot().messageCount));
    client.send();
    off();
    client.send();
    expect(seen).toEqual([4]);
  });

  it("reset clears the registrations", () => {
    ServiceClient.register();
    mockService.reset();
    expect(mockService.registrations()).toBe(0);
  });
});

describe("snapshots", () => {
  it("loadSnapshot returns what saveSnapshot saved", () => {
    saveSnapshot(snap);
    expect(loadSnapshot()).toEqual(snap);
  });

  it("corrupt snapshot JSON yields null", () => {
    localStorage.setItem(SNAPSHOT_KEY, "{not json");
    expect(loadSnapshot()).toBeNull();
  });

  it("a snapshot of the wrong shape yields null", () => {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ v: 1, savedAt: Date.now(), data: { x: 1 } }),
    );
    expect(loadSnapshot()).toBeNull();
  });

  it("expired snapshot yields null", () => {
    saveSnapshot(snap);
    expect(loadSnapshot(Date.now() + 60 * 60_000)).toBeNull();
  });

  it("mismatched-version snapshot yields null", () => {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ v: 999, savedAt: Date.now(), data: snap }));
    expect(loadSnapshot()).toBeNull();
  });

  it("clearSnapshot removes it", () => {
    saveSnapshot(snap);
    clearSnapshot();
    expect(loadSnapshot()).toBeNull();
  });

  it("saveSnapshot does not throw when storage does", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(saveSnapshot(snap)).toBe(false);
    spy.mockRestore();
  });
});

describe("session handoff", () => {
  it("a second acquire after a clean handoff resumes instead of registering", () => {
    // This is the StrictMode / next-leader sequence: promote, demote, promote.
    const first = acquireClient();
    const autosave = startAutosave(first);
    first.send();
    autosave.finish();
    const second = acquireClient();
    expect(mockService.registrations()).toBe(1);
    expect(second.snapshot()).toEqual(first.snapshot());
  });

  it("a crash (stop without the final snapshot) still recovers the last change", () => {
    const first = acquireClient();
    const autosave = startAutosave(first);
    first.send();
    autosave.stop();
    first.send(); // after the crash nothing is saved any more
    const second = acquireClient();
    expect(mockService.registrations()).toBe(1);
    expect(second.snapshot().messageCount).toBe(1);
  });

  it("a corrupt snapshot falls back to registering", () => {
    localStorage.setItem(SNAPSHOT_KEY, "garbage");
    acquireClient();
    expect(mockService.registrations()).toBe(1);
  });

  it("the timer snapshots even without changes", () => {
    vi.useFakeTimers();
    const client = acquireClient();
    const autosave = startAutosave(client);
    clearSnapshot();
    vi.advanceTimersByTime(10_000);
    expect(loadSnapshot()).toEqual(client.snapshot());
    autosave.stop();
  });
});
