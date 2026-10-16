import { FakeLockManager } from "@web-locks/fake-locks";
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { useLock } from "../src/useLock.ts";

const tick = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

describe("useLock", () => {
  it("held while mounted, released on unmount", async () => {
    const locks = new FakeLockManager();
    const onAcquired = vi.fn();
    const { result, unmount } = renderHook(() => useLock("res", { locks, onAcquired }));
    await tick();
    expect(result.current.status).toBe("held");
    expect(locks.heldNames()).toEqual(["res"]);
    expect(onAcquired).toHaveBeenCalledTimes(1);
    unmount();
    await tick();
    expect(locks.heldNames()).toEqual([]);
  });

  it("ifAvailable false -> unavailable", async () => {
    const locks = new FakeLockManager();
    const a = renderHook(() => useLock("res", { locks }));
    await tick();
    const b = renderHook(() => useLock("res", { locks, ifAvailable: true }));
    await tick();
    expect(a.result.current.status).toBe("held");
    expect(b.result.current.status).toBe("unavailable");
    expect(locks.heldNames()).toEqual(["res"]);
  });

  it("release() returns to idle and does not re-acquire", async () => {
    const locks = new FakeLockManager();
    const request = vi.spyOn(locks, "request");
    const { result, rerender } = renderHook(() => useLock("res", { locks }));
    await tick();
    expect(result.current.status).toBe("held");
    await act(async () => {
      await result.current.release();
    });
    expect(result.current.status).toBe("idle");
    expect(locks.heldNames()).toEqual([]);
    rerender();
    await tick();
    expect(result.current.status).toBe("idle");
    expect(locks.heldNames()).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("StrictMode holds exactly one lock", async () => {
    const locks = new FakeLockManager();
    const { result } = renderHook(() => useLock("res", { locks }), { wrapper: StrictMode });
    await tick();
    expect(result.current.status).toBe("held");
    expect(locks.heldNames()).toEqual(["res"]);
    expect((await locks.query()).pending).toEqual([]);
  });

  it("unmount while pending never holds the lock afterward", async () => {
    const locks = new FakeLockManager();
    const a = renderHook(() => useLock("res", { locks }));
    await tick();
    const b = renderHook(() => useLock("res", { locks }));
    await tick();
    expect(b.result.current.status).toBe("pending");
    expect((await locks.query()).pending).toHaveLength(1);
    b.unmount();
    await tick();
    expect((await locks.query()).pending).toEqual([]);
    a.unmount();
    await tick();
    expect(locks.heldNames()).toEqual([]);
  });

  it("unmount before the grant is awaited never holds the lock", async () => {
    const locks = new FakeLockManager();
    const request = vi.spyOn(locks, "request");
    const { unmount } = renderHook(() => useLock("res", { locks }));
    // Request issued in a microtask; unmount synchronously first.
    unmount();
    await tick();
    expect(locks.heldNames()).toEqual([]);
    expect((await locks.query()).pending).toEqual([]);
    expect(request.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("two hooks on one name: second pends until the first unmounts", async () => {
    const locks = new FakeLockManager();
    const a = renderHook(() => useLock("res", { locks }));
    await tick();
    const b = renderHook(() => useLock("res", { locks }));
    await tick();
    expect(a.result.current.status).toBe("held");
    expect(b.result.current.status).toBe("pending");
    a.unmount();
    await tick();
    expect(b.result.current.status).toBe("held");
    expect(locks.heldNames()).toEqual(["res"]);
  });

  it("enabled=false releases, true re-acquires; name change moves the lock", async () => {
    const locks = new FakeLockManager();
    const { result, rerender } = renderHook(
      ({ enabled, name }) => useLock(name, { locks, enabled }),
      { initialProps: { enabled: true, name: "a" } },
    );
    await tick();
    expect(locks.heldNames()).toEqual(["a"]);
    rerender({ enabled: false, name: "a" });
    await tick();
    expect(result.current.status).toBe("idle");
    expect(locks.heldNames()).toEqual([]);
    rerender({ enabled: true, name: "a" });
    await tick();
    expect(locks.heldNames()).toEqual(["a"]);
    rerender({ enabled: true, name: "b" });
    await tick();
    expect(locks.heldNames()).toEqual(["b"]);
    expect(result.current.status).toBe("held");
  });

  it("changing onAcquired does not re-acquire", async () => {
    const locks = new FakeLockManager();
    const request = vi.spyOn(locks, "request");
    const { rerender } = renderHook(({ cb }) => useLock("res", { locks, onAcquired: cb }), {
      initialProps: { cb: () => {} },
    });
    await tick();
    rerender({ cb: () => {} });
    await tick();
    expect(request).toHaveBeenCalledTimes(1);
    expect(locks.heldNames()).toEqual(["res"]);
  });

  it("stolen lock shows idle", async () => {
    const locks = new FakeLockManager();
    const { result } = renderHook(() => useLock("res", { locks }));
    await tick();
    expect(result.current.status).toBe("held");
    // Another context steals the lock.
    void locks.request("res", { steal: true }, () => new Promise<void>(() => {}));
    await tick();
    expect(result.current.status).toBe("idle");
  });

  it('no Locks API -> "unsupported"', async () => {
    vi.stubGlobal("navigator", {});
    try {
      const { result } = renderHook(() => useLock("res"));
      await tick();
      expect(result.current.status).toBe("unsupported");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders "idle" via renderToString', () => {
    const locks = new FakeLockManager();
    function Probe() {
      return <span>{useLock("res", { locks }).status}</span>;
    }
    expect(renderToString(<Probe />)).toContain("idle");
    expect(locks.heldNames()).toEqual([]);
  });
});
