import { createLeader } from "@web-locks/core";
import type { LeadershipState } from "@web-locks/core";
import { badge, button, card, el } from "./dom.ts";
import type { Tone } from "./dom.ts";

const tones: Record<LeadershipState, Tone> = {
  pending: "neutral",
  leader: "success",
  standby: "warning",
  unsupported: "danger",
};

const MAX_LOG = 50;

export function mount(root: HTMLElement): void {
  const log = el("ol", {
    class:
      "max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-slate-600 dark:text-slate-400",
    attrs: { "aria-label": "Leadership log" },
  });
  const empty = el("li", { text: "No promotions yet. Press Start." });
  log.append(empty);

  const addLog = (message: string) => {
    empty.remove();
    log.prepend(el("li", { text: `${new Date().toLocaleTimeString()}  ${message}` }));
    while (log.children.length > MAX_LOG) log.lastElementChild?.remove();
  };

  const leader = createLeader({
    name: "web-locks-demo.vanilla.leader",
    onPromoted: () => addLog("Promoted: this tab is the leader"),
    onDemoted: () => addLog("Demoted: this tab gave up leadership"),
    onError: (error) => addLog(`Error: ${error instanceof Error ? error.message : String(error)}`),
  });

  const state = badge();
  const start = button("Start", "play", "primary");
  const stop = button("Stop", "square");
  let running = false;

  const render = () => {
    const current = leader.getState();
    state.set(current, tones[current]);
    const unsupported = current === "unsupported";
    start.disabled = unsupported || running;
    stop.disabled = unsupported || !running;
  };

  start.addEventListener("click", () => {
    running = true;
    leader.start();
    render();
  });
  stop.addEventListener("click", async () => {
    stop.disabled = true;
    await leader.stop();
    running = false;
    render();
  });
  leader.subscribe(render);

  const c = card(
    "Leader election",
    "crown",
    "One tab holds the leader lock; the others wait in standby and take over when it stops or closes.",
  );
  c.status.append(state.node);
  c.body.append(
    el("div", { class: "flex flex-wrap gap-2" }, [start, stop]),
    el("div", {}, [
      el("h3", {
        class: "mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500",
        text: "Log",
      }),
      log,
    ]),
  );
  root.append(c.node);
  render();
}
