import { describe, expect, it } from "vite-plus/test";
import * as api from "../src/index.ts";

describe("public API", () => {
  it("exports the three hooks", () => {
    expect(Object.keys(api).sort()).toEqual(["useLeader", "useLock", "useLockQuery"]);
    for (const hook of Object.values(api)) expect(typeof hook).toBe("function");
  });
});
