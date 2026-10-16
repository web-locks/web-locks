import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

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

/** A status pill; `role="status"` so screen readers hear state changes (use it for rare changes only). */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      role="status"
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const btnKinds = {
  primary: "bg-indigo-600 text-white enabled:hover:bg-indigo-500",
  secondary:
    "bg-white text-slate-900 ring-1 ring-inset ring-slate-300 enabled:hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600 dark:enabled:hover:bg-slate-700",
  danger: "bg-rose-600 text-white enabled:hover:bg-rose-500",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  kind?: keyof typeof btnKinds;
};

export function Button({ icon: Icon, kind = "secondary", children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${btnKinds[kind]}`}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 rounded border-slate-300 accent-indigo-600"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function Card({
  title,
  icon: Icon,
  description,
  status,
  className = "",
  children,
}: {
  title: string;
  icon: LucideIcon;
  description: string;
  status?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon className="size-5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            <span>{title}</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>
        </div>
        {status}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
