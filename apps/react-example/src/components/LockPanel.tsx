import { useLock } from "@web-locks/react";
import type { LockState } from "@web-locks/react";
import { Lock, LockOpen } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Checkbox } from "./ui.tsx";
import type { Tone } from "./ui.tsx";

const tones: Record<LockState, Tone> = {
  idle: "neutral",
  pending: "info",
  held: "success",
  unavailable: "warning",
  unsupported: "danger",
};

export function LockPanel() {
  const [enabled, setEnabled] = useState(false);
  const [ifAvailable, setIfAvailable] = useState(false);
  const [note, setNote] = useState("");

  const { status, release } = useLock("web-locks-demo.react.resource", {
    enabled,
    ifAvailable,
    onAcquired: () => setNote("Lock acquired."),
    onLost: () => setNote("The lock was lost (taken by another holder)."),
  });

  const message =
    status === "pending"
      ? "Waiting for the lock: another tab holds it."
      : status === "unavailable"
        ? "The lock is taken, and “only if available” was set, so this tab did not wait."
        : note;

  return (
    <Card
      title="Exclusive lock"
      icon={Lock}
      description="Acquire a named lock. Only one tab can hold it at a time; try it from two tabs."
      status={<Badge tone={tones[status]}>{status}</Badge>}
    >
      <Checkbox
        label="Only if available (do not wait)"
        checked={ifAvailable}
        disabled={enabled}
        onChange={setIfAvailable}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          kind="primary"
          icon={Lock}
          disabled={enabled}
          onClick={() => {
            setNote("");
            setEnabled(true);
          }}
        >
          Acquire
        </Button>
        <Button
          icon={LockOpen}
          disabled={!enabled}
          onClick={() => {
            void release();
            setEnabled(false);
            setNote("Lock released.");
          }}
        >
          Release
        </Button>
      </div>
      <p aria-live="polite" className="min-h-5 text-sm text-slate-600 dark:text-slate-400">
        {message}
      </p>
    </Card>
  );
}
