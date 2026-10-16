import { FakeLockManager } from "@web-locks/fake-locks";
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useLockQuery } from "../src/useLockQuery.ts";

const tick = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const never = () => new Promise<void>(() => {});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const info = (name: string): LockInfo => ({ name, mode: "exclusive", clientId: "c" });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useLockQuery", () => {
  it("starts empty and loads on mount", async () => {
    const locks = new FakeLockManager();
    void locks.request("a", never);
    const query = vi.spyOn(locks, "query");
    const { result } = renderHook(() => useLockQuery({ locks }));
    expect(result.current.held).toEqual([]);
    expect(result.current.pending).toEqual([]);
    await tick();
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.current.held.map((l) => l.name)).toEqual(["a"]);
  });

  it("initial value is a stable constant and SSR renders empty", () => {
    const locks = new FakeLockManager();
    const seen: unknown[] = [];
    const { result, rerender } = renderHook(() => {
      const value = useLockQuery({ locks });
      seen.push(value.held);
      return value;
    });
    rerender();
    expect(seen[0]).toBe(seen[1]);
    expect(result.current.held).toEqual([]);
    const html = renderToString(
      (() => {
        function C() {
          const { held, pending } = useLockQuery({ locks });
          return <span>{`${held.length}/${pending.length}`}</span>;
        }
        return <C />;
      })(),
    );
    expect(html).toContain("0/0");
  });

  it("refresh() updates after a lock is taken", async () => {
    const locks = new FakeLockManager();
    const { result } = renderHook(() => useLockQuery({ locks }));
    await tick();
    expect(result.current.held).toEqual([]);
    void locks.request("b", never);
    expect(result.current.held).toEqual([]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.held.map((l) => l.name)).toEqual(["b"]);
  });

  it("lists pending requests", async () => {
    const locks = new FakeLockManager();
    void locks.request("p", never);
    void locks.request("p", never);
    const { result } = renderHook(() => useLockQuery({ locks }));
    await tick();
    expect(result.current.held.length).toBe(1);
    expect(result.current.pending.length).toBe(1);
  });

  it("refresh identity is stable across renders, changes with locks", async () => {
    const a = new FakeLockManager();
    const b = new FakeLockManager();
    const { result, rerender } = renderHook(({ locks }) => useLockQuery({ locks }), {
      initialProps: { locks: a },
    });
    const first = result.current.refresh;
    rerender({ locks: a });
    await tick();
    expect(result.current.refresh).toBe(first);
    rerender({ locks: b });
    expect(result.current.refresh).not.toBe(first);
  });

  it("does not poll without pollInterval", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    const query = vi.spyOn(locks, "query");
    renderHook(() => useLockQuery({ locks }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("polls at pollInterval and stops on unmount", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    const query = vi.spyOn(locks, "query");
    const { result, unmount } = renderHook(() => useLockQuery({ locks, pollInterval: 1000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(query).toHaveBeenCalledTimes(1);
    void locks.request("x", never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(result.current.held.map((l) => l.name)).toEqual(["x"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(query).toHaveBeenCalledTimes(4);
    unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(query).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts the timer when pollInterval changes", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    const query = vi.spyOn(locks, "query");
    const { rerender } = renderHook(({ ms }) => useLockQuery({ locks, pollInterval: ms }), {
      initialProps: { ms: 1000 },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ ms: 0 });
    const before = query.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(query.mock.calls.length).toBe(before);
  });

  it("no state update after unmount", async () => {
    const locks = new FakeLockManager();
    const d = deferred<LockManagerSnapshot>();
    vi.spyOn(locks, "query").mockReturnValue(d.promise);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useLockQuery({ locks }));
    await tick();
    unmount();
    d.resolve({ held: [info("late")], pending: [] });
    await tick();
    expect(error).not.toHaveBeenCalled();
    expect(result.current.held).toEqual([]);
  });

  it("refresh() after unmount resolves without updating", async () => {
    const locks = new FakeLockManager();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useLockQuery({ locks }));
    await tick();
    unmount();
    void locks.request("z", never);
    await result.current.refresh();
    expect(error).not.toHaveBeenCalled();
    expect(result.current.held).toEqual([]);
  });

  it("unsupported -> empty arrays", async () => {
    vi.stubGlobal("navigator", {});
    const { result } = renderHook(() => useLockQuery());
    await tick();
    expect(result.current.held).toEqual([]);
    expect(result.current.pending).toEqual([]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.held).toEqual([]);
  });

  it("a slower older response does not overwrite a newer one", async () => {
    const locks = new FakeLockManager();
    const slow = deferred<LockManagerSnapshot>();
    const fast = deferred<LockManagerSnapshot>();
    vi.spyOn(locks, "query").mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const { result } = renderHook(() => useLockQuery({ locks }));
    await tick(); // mount request is in flight (slow)
    let refreshed!: Promise<void>;
    await act(async () => {
      refreshed = result.current.refresh();
    });
    await act(async () => {
      fast.resolve({ held: [info("new")], pending: [] });
      await refreshed;
    });
    expect(result.current.held.map((l) => l.name)).toEqual(["new"]);
    await act(async () => {
      slow.resolve({ held: [info("old")], pending: [] });
    });
    await tick();
    expect(result.current.held.map((l) => l.name)).toEqual(["new"]);
  });

  it("a rejected query keeps the previous value and does not reject", async () => {
    const locks = new FakeLockManager();
    void locks.request("keep", never);
    const { result } = renderHook(() => useLockQuery({ locks }));
    await tick();
    vi.spyOn(locks, "query").mockRejectedValue(new Error("boom"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.held.map((l) => l.name)).toEqual(["keep"]);
  });

  it("an unchanged snapshot does not re-render", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    void locks.request("same", never);
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useLockQuery({ locks, pollInterval: 1000 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.held.length).toBe(1);
    const held = result.current.held;
    const settled = renders;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(renders).toBe(settled);
    expect(result.current.held).toBe(held);
    // and a real change still renders
    void locks.request("other", never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(renders).toBe(settled + 1);
    expect(result.current.held.length).toBe(2);
  });

  it("StrictMode still loads and polls", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    void locks.request("s", never);
    const { result } = renderHook(() => useLockQuery({ locks, pollInterval: 500 }), {
      wrapper: StrictMode,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.held.map((l) => l.name)).toEqual(["s"]);
    void locks.request("t", never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.held.length).toBe(2);
  });
});
