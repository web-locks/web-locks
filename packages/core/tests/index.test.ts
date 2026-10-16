import { describe, expect, it } from "vite-plus/test";
import * as api from "../src/index.ts";

describe("public API", () => {
  it("exports the documented public API", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "acquireLock",
        "createLeader",
        "createLockStatus",
        "isSupported",
        "queryLocks",
        "windowPageEvents",
      ].sort(),
    );
    for (const fn of [
      "acquireLock",
      "createLeader",
      "createLockStatus",
      "isSupported",
      "queryLocks",
    ] as const) {
      expect(typeof api[fn]).toBe("function");
    }
    expect(typeof api.windowPageEvents.onFreeze).toBe("function");
  });
});
