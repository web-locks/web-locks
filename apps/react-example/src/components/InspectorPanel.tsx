import { useLockQuery } from "@web-locks/react";
import { RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { Button, Card, Checkbox } from "./ui.tsx";

function LockList({ title, locks }: { title: string; locks: LockInfo[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        {title} <span className="font-normal text-slate-500">({locks.length})</span>
      </h3>
      {locks.length === 0 ? (
        <p className="text-sm text-slate-500">None.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {locks.map((lock, i) => (
            <li
              key={`${lock.clientId}-${lock.name}-${i}`}
              className="rounded-lg bg-slate-100 px-3 py-2 break-words dark:bg-slate-800"
            >
              <span className="font-mono font-medium">{lock.name}</span>{" "}
              <span className="text-slate-500">
                {lock.mode}, client {lock.clientId}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function InspectorPanel() {
  const [auto, setAuto] = useState(false);
  const { held, pending, refresh } = useLockQuery({ pollInterval: auto ? 1000 : undefined });

  return (
    <Card
      title="Lock inspector"
      icon={Search}
      description="Every lock currently held or waiting on this origin, across all tabs."
      className="lg:col-span-2"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={RefreshCw} onClick={() => void refresh()}>
          Refresh
        </Button>
        <Checkbox label="Auto-refresh every second" checked={auto} onChange={setAuto} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <LockList title="Held" locks={held} />
        <LockList title="Pending" locks={pending} />
      </div>
    </Card>
  );
}
