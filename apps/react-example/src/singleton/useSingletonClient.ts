import { useLeader } from "@web-locks/react";
import type { LeadershipState } from "@web-locks/react";
import { useEffect, useRef, useState } from "react";
import { createMirror, loadSnapshot } from "./handoff.ts";
import * as mockService from "./mockService.ts";
import { ServiceClient } from "./serviceClient.ts";
import type { ClientSnapshot } from "./serviceClient.ts";
import { acquireClient, resetSession, startAutosave } from "./session.ts";
import type { Autosave } from "./session.ts";

export type SingletonClient = {
  state: LeadershipState;
  /** The leader's own client state (null unless this tab is the leader). */
  own: ClientSnapshot | null;
  /** The leader's state as seen from a standby tab (read-only). */
  mirrored: ClientSnapshot | null;
  registrations: number;
  /** The tab dropped out of the election because of a simulated crash. */
  crashed: boolean;
  /** Startup failed, so the tab stepped down. */
  error: string | null;
  send(): void;
  simulateCrash(): void;
  reset(): void;
  /** Rejoin the election after a crash or a failed startup. */
  rejoin(): void;
};

/** One client for the whole origin: the leader owns it, other tabs mirror it. */
export function useSingletonClient(): SingletonClient {
  const client = useRef<ServiceClient | null>(null);
  const autosave = useRef<Autosave | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const crashing = useRef(false);

  const [own, setOwn] = useState<ClientSnapshot | null>(null);
  const [mirrored, setMirrored] = useState<ClientSnapshot | null>(null);
  const [count, setCount] = useState(mockService.registrations);
  const [stopped, setStopped] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCount = () => setCount(mockService.registrations());

  function begin(next: ServiceClient) {
    client.current = next;
    setOwn(next.snapshot());
    detach.current = next.onChange(() => {
      setOwn(next.snapshot());
      refreshCount();
    });
    autosave.current = startAutosave(next);
  }

  /** Stops autosave FIRST; only a clean demotion takes the final snapshot. */
  function teardown(finalSnapshot: boolean) {
    detach.current?.();
    detach.current = null;
    const saving = autosave.current;
    autosave.current = null;
    if (finalSnapshot) saving?.finish();
    else saving?.stop();
    client.current = null;
    setOwn(null);
  }

  function startOrStepDown(create: () => ServiceClient) {
    try {
      begin(create());
      setError(null);
    } catch (e) {
      // A leader without a client is the one outcome to avoid: step down.
      setError(e instanceof Error ? e.message : "Could not start the client.");
      setStopped(true);
    }
    refreshCount();
  }

  const state = useLeader("web-locks-demo.client", {
    enabled: !stopped,
    onPromoted() {
      if (client.current) return; // already own one (never register twice)
      crashing.current = false;
      startOrStepDown(acquireClient);
    },
    onDemoted() {
      teardown(!crashing.current); // a simulated crash skips the clean-demotion snapshot
    },
  });

  // Registration count is shared state: follow changes made by other tabs.
  useEffect(() => {
    const onStorage = () => setCount(mockService.registrations());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Outside the leader role, mirror the leader's live state, starting from storage.
  useEffect(() => {
    if (state === "leader") return;
    setMirrored(loadSnapshot());
    const mirror = createMirror();
    const off = mirror.subscribe((snapshot) => {
      setMirrored(snapshot);
      setCount(mockService.registrations());
    });
    return () => {
      off();
      mirror.close();
    };
  }, [state]);

  return {
    state,
    own,
    mirrored,
    registrations: count,
    crashed,
    error,
    send: () => client.current?.send(),
    simulateCrash() {
      crashing.current = true;
      teardown(false); // stop autosave WITHOUT a final snapshot
      setCrashed(true);
      setStopped(true); // drop the lock; the next tab recovers the last snapshot
    },
    reset() {
      if (!client.current) return;
      teardown(false);
      resetSession(); // standby tabs clear even if re-registering fails
      startOrStepDown(ServiceClient.register);
    },
    rejoin() {
      crashing.current = false;
      setCrashed(false);
      setError(null);
      setStopped(false);
    },
  };
}
