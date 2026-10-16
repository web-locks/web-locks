import { queryLocks } from "@web-locks/core";
import { button, card, checkbox, el } from "./dom.ts";

const columns = ["Name", "Mode", "Client ID"];

function table(title: string, label: string) {
  const tbody = el("tbody", { class: "divide-y divide-slate-200 dark:divide-slate-800" });
  const node = el("div", {}, [
    el("h3", {
      class: "mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500",
      text: title,
    }),
    el("div", { class: "overflow-x-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-800" }, [
      el("table", { class: "w-full text-left text-sm", attrs: { "aria-label": label } }, [
        el("thead", { class: "bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/50" }, [
          el(
            "tr",
            {},
            columns.map((name) =>
              el("th", { class: "px-3 py-2 font-medium", text: name, attrs: { scope: "col" } }),
            ),
          ),
        ]),
        tbody,
      ]),
    ]),
  ]);
  return {
    node,
    fill(locks: readonly LockInfo[]) {
      if (locks.length === 0) {
        tbody.replaceChildren(
          el("tr", {}, [
            el("td", {
              class: "px-3 py-2 text-slate-500",
              text: "None",
              attrs: { colspan: String(columns.length) },
            }),
          ]),
        );
        return;
      }
      tbody.replaceChildren(
        ...locks.map((lock) =>
          el("tr", {}, [
            el("td", { class: "px-3 py-2 font-mono text-xs break-all", text: lock.name ?? "" }),
            el("td", { class: "px-3 py-2", text: lock.mode ?? "" }),
            el("td", { class: "px-3 py-2 font-mono text-xs break-all", text: lock.clientId ?? "" }),
          ]),
        ),
      );
    },
  };
}

export function mount(root: HTMLElement): void {
  const held = table("Held", "Held locks");
  const pending = table("Pending", "Pending lock requests");
  const refreshButton = button("Refresh", "refresh-cw", "primary");
  const auto = checkbox("Auto-refresh every second");
  const updated = el("p", { class: "text-xs text-slate-500", attrs: { "aria-live": "polite" } });

  const refresh = async () => {
    const snapshot = await queryLocks();
    held.fill(snapshot.held ?? []);
    pending.fill(snapshot.pending ?? []);
    updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  auto.input.addEventListener("change", () => {
    clearInterval(timer);
    timer = auto.input.checked ? setInterval(() => void refresh(), 1000) : undefined;
  });
  refreshButton.addEventListener("click", () => void refresh());

  const c = card(
    "Lock inspector",
    "search",
    "A live view of every lock held or waiting in this origin, across all tabs.",
  );
  c.body.append(
    el("div", { class: "flex flex-wrap items-center gap-3" }, [refreshButton, auto.node]),
    held.node,
    pending.node,
    updated,
  );
  root.append(c.node);
  void refresh();
}
