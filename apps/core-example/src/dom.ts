/** Tiny DOM helpers shared by the panels. Text is always set via textContent. */

type Props = {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [key, value] of Object.entries(props.attrs ?? {})) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

/** A lucide icon placeholder; `createIcons()` in main.ts swaps it for the SVG. */
export const icon = (name: string, cls = "size-4") =>
  el("i", { attrs: { "data-lucide": name, class: cls, "aria-hidden": "true" } });

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

// Full class names so Tailwind can see them.
const tones: Record<Tone, string> = {
  neutral:
    "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600",
  success:
    "bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800",
  warning:
    "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800",
  danger:
    "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-800",
  info: "bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-800",
};

/** A status pill; `aria-live` so screen readers hear state changes. */
export function badge(): { node: HTMLElement; set(text: string, tone: Tone): void } {
  const node = el("span", { attrs: { role: "status", "aria-live": "polite" } });
  return {
    node,
    set(text, tone) {
      node.className = `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${tones[tone]}`;
      node.textContent = text;
    },
  };
}

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";
const btnKinds = {
  primary: "bg-indigo-600 text-white enabled:hover:bg-indigo-500",
  secondary:
    "bg-white text-slate-900 ring-1 ring-inset ring-slate-300 enabled:hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600 dark:enabled:hover:bg-slate-700",
};

export function button(label: string, iconName: string, kind: keyof typeof btnKinds = "secondary") {
  return el("button", { class: `${btnBase} ${btnKinds[kind]}`, attrs: { type: "button" } }, [
    icon(iconName),
    el("span", { text: label }),
  ]);
}

/** A card with a heading, description and a body element. */
export function card(title: string, iconName: string, description: string) {
  const status = el("div", { class: "flex items-center gap-2" });
  const body = el("div", { class: "space-y-4" });
  const node = el(
    "section",
    {
      class:
        "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900",
    },
    [
      el("div", { class: "mb-4 flex flex-wrap items-start justify-between gap-3" }, [
        el("div", {}, [
          el("h2", { class: "flex items-center gap-2 text-lg font-semibold" }, [
            icon(iconName, "size-5 text-indigo-600 dark:text-indigo-400"),
            el("span", { text: title }),
          ]),
          el("p", { class: "mt-1 text-sm text-slate-600 dark:text-slate-400", text: description }),
        ]),
        status,
      ]),
      body,
    ],
  );
  return { node, status, body };
}

export function checkbox(label: string) {
  const input = el("input", {
    class: "size-4 rounded border-slate-300 accent-indigo-600",
    attrs: { type: "checkbox" },
  });
  const node = el("label", { class: "inline-flex items-center gap-2 text-sm" }, [
    input,
    el("span", { text: label }),
  ]);
  return { node, input };
}
