import { Bug, Info, Mail, RotateCcw, ServerCog, TriangleAlert, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { LeadershipState } from "@web-locks/react";
import { useSingletonClient } from "../singleton/useSingletonClient.ts";
import type { ClientSnapshot } from "../singleton/serviceClient.ts";
import { Badge, Button, Card } from "./ui.tsx";
import type { Tone } from "./ui.tsx";

const tones: Record<LeadershipState, Tone> = {
  pending: "neutral",
  leader: "success",
  standby: "warning",
  unsupported: "danger",
};

const truncate = (token: string) => (token.length > 10 ? `${token.slice(0, 8)}…` : token);

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`text-lg font-semibold break-all ${mono ? "font-mono text-base" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function ClientStats({ client }: { client: ClientSnapshot | null }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Stat label="Client id" value={client?.clientId ?? "—"} mono />
      <Stat label="Session token" value={client ? truncate(client.sessionToken) : "—"} mono />
      <Stat label="Messages sent" value={client ? String(client.messageCount) : "—"} />
    </dl>
  );
}

/** One toast per leadership transition. */
function useTransitionToasts(state: LeadershipState) {
  const previous = useRef<LeadershipState>("pending");
  useEffect(() => {
    const before = previous.current;
    if (before === state) return;
    previous.current = state;
    if (state === "leader") toast.success("Promoted: this tab now owns the client");
    else if (state === "standby") toast.info("Standby: another tab owns the client");
    else if (before === "leader") toast.warning("Stepped down: this tab no longer owns the client");
  }, [state]);
}

export function SingletonDemo() {
  const demo = useSingletonClient();
  const { state } = demo;
  useTransitionToasts(state);

  const status = (
    <Badge tone={demo.crashed || demo.error ? "danger" : tones[state]}>
      {demo.crashed ? "crashed" : demo.error ? "stopped" : state}
    </Badge>
  );

  return (
    <Card
      title="Singleton client handoff"
      icon={ServerCog}
      description="A client that registers with a service must exist in exactly one tab. The leader owns it; when it goes away, the next tab continues the same session instead of registering again."
      status={status}
      className="lg:col-span-2"
    >
      <div className="flex items-start gap-2 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">How to try it</p>
          <ol className="list-inside list-decimal space-y-0.5">
            <li>Open this page in a second tab. One tab is the leader, the other is on standby.</li>
            <li>Close the leader tab, or press “Simulate crash” in it.</li>
            <li>
              Watch the other tab take over with the same client id while the registration count
              stays at 1.
            </li>
          </ol>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm text-slate-600 dark:text-slate-400">Registrations with the service</p>
        <p className="text-3xl font-bold tabular-nums">{demo.registrations}</p>
      </div>

      {demo.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
        >
          <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            Could not start the client, so this tab stepped down: {demo.error}
          </p>
          <Button icon={RotateCcw} onClick={demo.rejoin}>
            Retry
          </Button>
        </div>
      )}

      {demo.crashed && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <Bug className="size-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            Simulated crash: this tab dropped the lock without a final snapshot. The next leader
            recovers from the last periodic snapshot.
          </p>
          <Button icon={RotateCcw} onClick={demo.rejoin}>
            Rejoin
          </Button>
        </div>
      )}

      {state === "leader" ? (
        <div className="space-y-4">
          <p className="text-sm font-medium">Leader — this tab owns the client.</p>
          <ClientStats client={demo.own} />
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" icon={Mail} onClick={demo.send}>
              Send message
            </Button>
            <Button icon={Zap} onClick={demo.simulateCrash}>
              Simulate crash
            </Button>
            <Button icon={RotateCcw} onClick={demo.reset}>
              Reset demo
            </Button>
          </div>
        </div>
      ) : state === "standby" ? (
        <div className="space-y-4">
          <p className="text-sm font-medium">Standby — another tab owns the client.</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Read-only view of the leader’s live state:
          </p>
          <ClientStats client={demo.mirrored} />
        </div>
      ) : state === "unsupported" ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Without the Web Locks API this tab cannot take part in the election.
        </p>
      ) : (
        !demo.crashed &&
        !demo.error && (
          <p className="text-sm text-slate-600 dark:text-slate-400">Joining the election…</p>
        )
      )}

      {demo.crashed && <ClientStats client={demo.mirrored} />}
    </Card>
  );
}
