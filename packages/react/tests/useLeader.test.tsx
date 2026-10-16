import { FakeLockManager } from "@web-locks/fake-locks";
import { act, render, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { useLeader } from "../src/useLeader.ts";

const tick = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

describe("useLeader", () => {
  it("becomes leader then standby tabs follow", async () => {
    const locks = new FakeLockManager();
    const a = renderHook(() => useLeader("app", { locks }));
    await tick();
    const b = renderHook(() => useLeader("app", { locks }));
    await tick();
    expect(a.result.current).toBe("leader");
    expect(b.result.current).toBe("standby");
  });

  it("unmount hands leadership to the next", async () => {
    const locks = new FakeLockManager();
    const a = renderHook(() => useLeader("app", { locks }));
    await tick();
    const b = renderHook(() => useLeader("app", { locks }));
    await tick();
    expect(b.result.current).toBe("standby");
    a.unmount();
    await tick();
    expect(b.result.current).toBe("leader");
    expect(locks.heldNames()).toEqual(["app"]);
  });

  it("enabled=false releases, true re-queues", async () => {
    const locks = new FakeLockManager();
    const { result, rerender } = renderHook(({ enabled }) => useLeader("app", { locks, enabled }), {
      initialProps: { enabled: true },
    });
    await tick();
    expect(result.current).toBe("leader");
    rerender({ enabled: false });
    await tick();
    expect(result.current).toBe("pending");
    expect(locks.heldNames()).toEqual([]);
    rerender({ enabled: true });
    await tick();
    expect(result.current).toBe("leader");
    expect(locks.heldNames()).toEqual(["app"]);
  });

  it("changing callbacks does not re-elect, and the latest callback runs", async () => {
    const locks = new FakeLockManager();
    const request = vi.spyOn(locks, "request");
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ onDemoted }) => useLeader("app", { locks, onDemoted }),
      { initialProps: { onDemoted: first } },
    );
    await tick();
    const count = request.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    rerender({ onDemoted: second });
    await tick();
    expect(request.mock.calls.length).toBe(count);
    expect(locks.heldNames()).toEqual(["app"]);
    unmount();
    await tick();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("calls onPromoted when elected", async () => {
    const locks = new FakeLockManager();
    const onPromoted = vi.fn();
    renderHook(() => useLeader("app", { locks, onPromoted }));
    await tick();
    expect(onPromoted).toHaveBeenCalledTimes(1);
  });

  it("StrictMode leaves exactly one lock held", async () => {
    const locks = new FakeLockManager();
    const { result } = renderHook(() => useLeader("app", { locks }), { wrapper: StrictMode });
    await tick();
    expect(locks.heldNames().length).toBe(1);
    expect(result.current).toBe("leader");
  });

  it('reports "unsupported" once mounted without a lock manager', async () => {
    vi.stubGlobal("navigator", {});
    try {
      expect(globalThis.navigator.locks).toBeUndefined();
      const { result } = renderHook(() => useLeader("app"));
      await tick();
      expect(result.current).toBe("unsupported");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("unmounting a standby leaves the queue; unmounting the leader frees the lock", async () => {
    const locks = new FakeLockManager();
    const a = renderHook(() => useLeader("app", { locks }));
    await tick();
    const b = renderHook(() => useLeader("app", { locks }));
    await tick();
    expect(b.result.current).toBe("standby");
    expect((await locks.query()).pending).toHaveLength(1);
    b.unmount();
    await tick();
    expect((await locks.query()).pending).toEqual([]);
    expect(locks.heldNames()).toEqual(["app"]);
    a.unmount();
    await tick();
    expect(locks.heldNames()).toEqual([]);
  });

  it("disabling while the grant is in flight holds nothing afterwards", async () => {
    const locks = new FakeLockManager();
    const request = vi.spyOn(locks, "request");
    const { rerender } = renderHook(({ enabled }) => useLeader("app", { locks, enabled }), {
      initialProps: { enabled: true },
    });
    // The effect has run and requested the lock, but the grant (a microtask) has not been awaited.
    expect(request).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    await tick();
    expect(locks.heldNames()).toEqual([]);
    expect((await locks.query()).pending).toEqual([]);
  });

  it('renders "pending" via renderToString', () => {
    const locks = new FakeLockManager();
    function Probe() {
      return <span>{useLeader("app", { locks })}</span>;
    }
    expect(renderToString(<Probe />)).toContain("pending");
    expect(locks.heldNames()).toEqual([]);
  });

  it("renders the state in a component", async () => {
    const locks = new FakeLockManager();
    function Probe() {
      return <span data-testid="s">{useLeader("app", { locks })}</span>;
    }
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("s").textContent).toBe("pending");
    await tick();
    expect(getByTestId("s").textContent).toBe("leader");
  });

  it("forwards errors to onError; changing onError does not re-elect and the latest one is used", async () => {
    const locks = new FakeLockManager();
    const request = vi.spyOn(locks, "request");
    const boom = new Error("demote failed");
    const first = vi.fn();
    const second = vi.fn();
    const onDemoted = () => {
      throw boom;
    };
    const { rerender, unmount, result } = renderHook(
      ({ onError }) => useLeader("app", { locks, onDemoted, onError }),
      { initialProps: { onError: first } },
    );
    await tick();
    expect(result.current).toBe("leader");
    const count = request.mock.calls.length;
    rerender({ onError: second });
    await tick();
    expect(request.mock.calls.length).toBe(count);
    unmount();
    await tick();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(boom);
    expect(locks.heldNames()).toEqual([]);
  });

  it("reports a failing lock request to onError", async () => {
    const failure = new DOMException("denied", "SecurityError");
    const locks = {
      request: () => Promise.reject(failure),
      query: async () => ({ held: [], pending: [] }),
    } as never;
    const onError = vi.fn();
    const { unmount } = renderHook(() => useLeader("app", { locks, onError }));
    await tick();
    expect(onError).toHaveBeenCalledWith(failure);
    unmount();
  });

  it("without onError, errors go to the global reportError", async () => {
    const hostReport = vi.fn();
    vi.stubGlobal("reportError", hostReport);
    try {
      const locks = new FakeLockManager();
      const boom = new Error("promote failed");
      const { unmount } = renderHook(() =>
        useLeader("app", {
          locks,
          onPromoted: () => {
            throw boom;
          },
        }),
      );
      await tick();
      expect(hostReport).toHaveBeenCalledWith(boom);
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
