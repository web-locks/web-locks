import { isSupported } from "@web-locks/core";
import { AppWindow, Code, ExternalLink, Lock, Package, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Toaster } from "sonner";
import { InspectorPanel } from "./components/InspectorPanel.tsx";
import { LeaderPanel } from "./components/LeaderPanel.tsx";
import { LockPanel } from "./components/LockPanel.tsx";
import { SingletonDemo } from "./components/SingletonDemo.tsx";
import { Button } from "./components/ui.tsx";

function FooterLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: LucideIcon;
  children: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{children}</span>
    </a>
  );
}

export function App() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:py-12">
      <header className="space-y-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <Lock
            className="size-7 shrink-0 text-indigo-600 dark:text-indigo-400"
            aria-hidden="true"
          />
          <span>@web-locks/react — React demo</span>
        </h1>
        <p className="max-w-2xl text-slate-600 dark:text-slate-400">
          The useLeader, useLock and useLockQuery hooks on the Web Locks API, plus a singleton
          client that survives its tab.
        </p>
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200">
          <p className="font-medium">Open this page in a second tab to see the locks interact.</p>
          <Button
            kind="primary"
            icon={AppWindow}
            onClick={() => window.open(location.href, "_blank", "noopener")}
          >
            Open in a new tab
          </Button>
        </div>
      </header>

      {!isSupported() && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
          <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
          <p>
            The Web Locks API is not supported in this browser. The panels below will report
            “unsupported”.
          </p>
        </div>
      )}

      <main className="grid gap-6 lg:grid-cols-2">
        <SingletonDemo />
        <LeaderPanel />
        <LockPanel />
        <InspectorPanel />
      </main>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <FooterLink href="https://github.com/web-locks/web-locks" icon={Code}>
          GitHub
        </FooterLink>
        <FooterLink href="https://www.npmjs.com/package/@web-locks/react" icon={Package}>
          npm
        </FooterLink>
        <FooterLink href="https://web-locks.github.io/vanilla/" icon={ExternalLink}>
          Vanilla demo
        </FooterLink>
      </footer>
      <Toaster richColors closeButton position="bottom-right" />
    </div>
  );
}
