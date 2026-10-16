import { isSupported } from "@web-locks/core";
import {
  AppWindow,
  Code,
  Crown,
  ExternalLink,
  Lock,
  LockOpen,
  Package,
  Play,
  RefreshCw,
  Search,
  Square,
  TriangleAlert,
  createIcons,
} from "lucide";
import "./style.css";
import { button, el, icon } from "./dom.ts";
import { mount as mountInspector } from "./inspector.ts";
import { mount as mountLeader } from "./leader.ts";
import { mount as mountLock } from "./lock.ts";

const link = (href: string, label: string, iconName: string) =>
  el(
    "a",
    {
      class:
        "inline-flex items-center gap-1.5 hover:text-indigo-600 hover:underline dark:hover:text-indigo-400",
      attrs: { href, target: "_blank", rel: "noopener noreferrer" },
    },
    [icon(iconName), el("span", { text: label })],
  );

const app = document.querySelector<HTMLDivElement>("#app")!;

const openTab = button("Open in a new tab", "app-window", "primary");
openTab.addEventListener("click", () => window.open(location.href, "_blank", "noopener"));

const banner = el(
  "div",
  {
    class:
      "flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
    attrs: { role: "alert" },
  },
  [
    icon("triangle-alert", "size-5 shrink-0"),
    el("p", {
      text: 'The Web Locks API is not supported in this browser. The panels below will report "unsupported".',
    }),
  ],
);

const main = el("main", { class: "grid gap-6 lg:grid-cols-2" });
const leaderRoot = el("div");
const lockRoot = el("div");
const inspectorRoot = el("div", { class: "lg:col-span-2" });
main.append(leaderRoot, lockRoot, inspectorRoot);

const container = el("div", { class: "mx-auto max-w-5xl space-y-6 px-4 py-8 sm:py-12" }, [
  el("header", { class: "space-y-3" }, [
    el("h1", { class: "flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl" }, [
      icon("lock", "size-7 text-indigo-600 dark:text-indigo-400"),
      el("span", { text: "@web-locks/core — vanilla demo" }),
    ]),
    el("p", {
      class: "max-w-2xl text-slate-600 dark:text-slate-400",
      text: "Leader election, an exclusive lock and a lock inspector built on the Web Locks API, in plain TypeScript with no framework.",
    }),
    el(
      "div",
      {
        class:
          "flex flex-wrap items-center gap-3 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200",
      },
      [
        el("p", {
          class: "font-medium",
          text: "Open this page in a second tab to see the locks interact.",
        }),
        openTab,
      ],
    ),
  ]),
  main,
  el(
    "footer",
    {
      class:
        "flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400",
    },
    [
      link("https://github.com/web-locks/web-locks", "GitHub", "code"),
      link("https://www.npmjs.com/package/@web-locks/core", "npm", "package"),
      link("https://web-locks.github.io/react/", "React demo", "external-link"),
    ],
  ),
]);

if (!isSupported()) container.querySelector("header")!.after(banner);

app.replaceChildren(container);
mountLeader(leaderRoot);
mountLock(lockRoot);
mountInspector(inspectorRoot);

createIcons({
  icons: {
    AppWindow,
    Code,
    Crown,
    ExternalLink,
    Lock,
    LockOpen,
    Package,
    Play,
    RefreshCw,
    Search,
    Square,
    TriangleAlert,
  },
});
