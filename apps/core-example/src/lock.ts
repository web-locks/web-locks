import { createLockStatus } from "@web-locks/core";
import type { LockState } from "@web-locks/core";
import { badge, button, card, checkbox, el } from "./dom.ts";
import type { Tone } from "./dom.ts";

const tones: Record<LockState, Tone> = {
  idle: "neutral",
  pending: "info",
  held: "success",
  unavailable: "warning",
  unsupported: "danger",
};

const labels: Record<LockState, string> = {
  idle: "released",
  pending: "waiting",
  held: "held",
  unavailable: "unavailable",
  unsupported: "unsupported",
};

const messages: Record<LockState, string> = {
  idle: "Not holding the lock.",
  pending: "Waiting in the queue for another tab to release it.",
  held: "This tab holds the lock. Other tabs cannot acquire it.",
  unavailable: "Another tab holds the lock, so it was not acquired.",
  unsupported: "The Web Locks API is not available in this browser.",
};

export function mount(root: HTMLElement): void {
  const state = badge();
  const message = el("p", { class: "text-sm", attrs: { "aria-live": "polite" } });
  const ifAvailable = checkbox("If available (do not wait; give up if the lock is taken)");
  const acquire = button("Acquire", "lock", "primary");
  const release = button("Release", "lock-open");

  let status: ReturnType<typeof createLockStatus> | null = null;
  let unsubscribe: (() => void) | null = null;
  let current: LockState = "idle";
  let note = "";

  const render = () => {
    state.set(labels[current], tones[current]);
    message.textContent = note && current === "idle" ? note : messages[current];
    const active = current === "pending" || current === "held";
    acquire.disabled = active || current === "unsupported";
    release.disabled = !active;
    ifAvailable.input.disabled = active || current === "unsupported";
  };

  acquire.addEventListener("click", () => {
    unsubscribe?.();
    note = "";
    // The status store is configured once, so build a fresh one per acquire
    // to honor the current "if available" setting.
    const next = createLockStatus("web-locks-demo.vanilla.resource", {
      ifAvailable: ifAvailable.input.checked,
    });
    status = next;
    let previous: LockState = "idle";
    unsubscribe = next.subscribe(() => {
      current = next.getState();
      if (previous === "held" && current === "idle" && !note)
        note = "The lock was lost (taken by another holder).";
      previous = current;
      render();
    });
    next.start();
  });

  release.addEventListener("click", async () => {
    if (!status) return;
    release.disabled = true;
    note = "Lock released.";
    await status.release();
    current = status.getState();
    render();
  });

  const c = card(
    "Exclusive lock",
    "lock",
    "Acquire a named lock. Only one tab can hold it at a time; try it from two tabs.",
  );
  c.status.append(state.node);
  c.body.append(
    ifAvailable.node,
    el("div", { class: "flex flex-wrap gap-2" }, [acquire, release]),
    message,
  );
  root.append(c.node);
  render();
}
