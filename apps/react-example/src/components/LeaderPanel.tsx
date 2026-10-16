import { useLeader } from "@web-locks/react";
import type { LeadershipState } from "@web-locks/react";
import { Crown, Play, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, Card } from "./ui.tsx";
import type { Tone } from "./ui.tsx";

const tones: Record<LeadershipState, Tone> = {
  pending: "neutral",
  leader: "success",
  standby: "warning",
  unsupported: "danger",
};

const MAX_LOG = 50;

type Entry = { id: number; text: string };

export function LeaderPanel() {
  const [running, setRunning] = useState(true);
  const [log, setLog] = useState<Entry[]>([]);
  const nextId = useRef(0);

  const add = (message: string) =>
    setLog((entries) =>
      [
        { id: nextId.current++, text: `${new Date().toLocaleTimeString()}  ${message}` },
        ...entries,
      ].slice(0, MAX_LOG),
    );

  const state = useLeader("web-locks-demo.leader", {
    enabled: running,
    onPromoted: () => add("Promoted: this tab is the leader"),
    onDemoted: () => add("Demoted: this tab gave up leadership"),
  });

  return (
    <Card
      title="Leader election"
      icon={Crown}
      description="One tab at a time is the leader. Close the leader tab and the next one takes over."
      status={
        <Badge tone={running ? tones[state] : "neutral"}>{running ? state : "stopped"}</Badge>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" icon={Play} disabled={running} onClick={() => setRunning(true)}>
          Start
        </Button>
        <Button icon={Square} disabled={!running} onClick={() => setRunning(false)}>
          Stop
        </Button>
      </div>
      <ol
        aria-label="Leadership log"
        className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-slate-600 dark:text-slate-400"
      >
        {log.length === 0 && <li>No promotions yet.</li>}
        {log.map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ol>
    </Card>
  );
}
