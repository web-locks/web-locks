# @web-locks/react

[![npm version](https://img.shields.io/npm/v/@web-locks/react)](https://www.npmjs.com/package/@web-locks/react)
[![license](https://img.shields.io/npm/l/@web-locks/react)](https://github.com/web-locks/web-locks/blob/main/LICENSE)

```sh
npm i @web-locks/react
```

React hooks for the [Web Locks API](https://developer.mozilla.org/docs/Web/API/Web_Locks_API): elect one leader tab, hold a named lock for as long as a component is mounted, and observe which locks are held. Built on [`@web-locks/core`](https://www.npmjs.com/package/@web-locks/core) (installed automatically), SSR-safe, and StrictMode-safe. Requires React 18 or newer.

[Live demo](https://web-locks.github.io/react/) | [Repository](https://github.com/web-locks/web-locks)

## Examples

### `useLeader`: one active tab

Only one tab at a time is the leader; the others wait in `standby` and take over when the leader closes, crashes or resigns.

```tsx
import { useLeader } from "@web-locks/react";

const startSync = () => console.log("syncing");
const stopSync = () => console.log("stopped syncing");

export function SyncStatus() {
  const state = useLeader("sync-worker", {
    onPromoted: startSync, // this tab became the leader
    onDemoted: stopSync, // runs before leadership is released
  });

  return <p>This tab is: {state}</p>; // pending | leader | standby | unsupported
}
```

### `useLock`: hold a lock while mounted

```tsx
import { useLock } from "@web-locks/react";

export function ExportButton() {
  const { status, release } = useLock("export-job", {
    ifAvailable: true,
    onLost: () => console.warn("the lock was stolen"),
  });

  if (status === "unavailable") return <p>Another tab is already exporting.</p>;
  if (status === "held") return <button onClick={() => void release()}>Finish export</button>;
  return <p>Waiting ({status})</p>;
}
```

### `useLockQuery`: see who holds what

```tsx
import { useLockQuery } from "@web-locks/react";

export function LockList() {
  const { held, pending, refresh } = useLockQuery({ pollInterval: 1000 });

  return (
    <div>
      <p>
        {held.length} held, {pending.length} pending
      </p>
      <ul>
        {held.map((lock, i) => (
          <li key={`${lock.clientId}:${lock.name}:${i}`}>
            {lock.name} ({lock.mode})
          </li>
        ))}
      </ul>
      <button onClick={() => void refresh()}>Refresh</button>
    </div>
  );
}
```

## Pattern: a singleton client shared across tabs

Say your app talks to a web service through a client object that registers itself (a push subscription, a realtime session, a device id) and must exist in exactly one tab. Elect a leader to own it, and hand its state over through `localStorage` so the next leader continues the same session instead of registering again:

- The leader snapshots the client into `localStorage` on every change and on a timer. A crashed tab never runs `onDemoted`, so the periodic snapshot is what the next leader recovers from.
- `onDemoted` takes a final snapshot before the lock is released.
- `onPromoted` restores the snapshot if it is readable, current-version and recent, and otherwise registers a new client.
- The leader also posts each snapshot on a `BroadcastChannel`, so standby tabs can show the live state without owning a client.

Two failure modes to design for. The hooks swallow errors thrown by your callbacks, so a throw in `onPromoted` would leave this tab holding the lock with no client; the sample steps down (`enabled: false`) instead, so another tab can take over. And storage can throw (quota, private mode) or hold data from an older app version, so every read and write is guarded and snapshots are versioned and expire.

```tsx
import { useEffect, useRef, useState } from "react";
import { useLeader } from "@web-locks/react";
// Your own client. Assumed API:
//   ApiClient.register(): Promise<ApiClient>      registers with the service
//   ApiClient.restore(snapshot): ApiClient        resumes without registering
//   client.snapshot(): Snapshot                   plain JSON-serializable state
//   client.onChange(listener): () => void         subscribe, returns unsubscribe
//   client.close(): void
import { ApiClient, type Snapshot } from "./api-client";

const KEY = "api-client";
const VERSION = 1; // bump when the Snapshot shape changes
const MAX_SNAPSHOT_AGE_MS = 5 * 60_000;
const SNAPSHOT_INTERVAL_MS = 10_000;

type Saved = { v: number; savedAt: number; data: Snapshot };

/** The stored snapshot, or null if missing, corrupt, from another version or too old. */
function readSaved(): Snapshot | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    const fresh = saved && Date.now() - saved.savedAt < MAX_SNAPSHOT_AGE_MS;
    return saved?.v === VERSION && fresh ? saved.data : null;
  } catch {
    return null;
  }
}

function startAutosave(client: ApiClient): () => void {
  const channel = new BroadcastChannel(KEY);
  const persist = () => {
    const data = client.snapshot();
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: VERSION, savedAt: Date.now(), data }));
    } catch {
      // storage full or unavailable: keep running, just without crash recovery
    }
    channel.postMessage(data);
  };
  const stopListening = client.onChange(persist); // every state change
  const timer = setInterval(persist, SNAPSHOT_INTERVAL_MS); // crash recovery
  persist();
  return () => {
    stopListening();
    clearInterval(timer);
    persist(); // final snapshot, taken before the lock is released
    channel.close();
  };
}

export function useSharedClient() {
  const client = useRef<ApiClient | null>(null);
  const stopAutosave = useRef<(() => void) | null>(null);
  const [mirror, setMirror] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);

  const state = useLeader("api-client", {
    // If startup fails, step down so another tab can try. A leader that holds
    // the lock without a client is the one outcome to avoid.
    enabled: !failed,
    async onPromoted() {
      try {
        const saved = readSaved();
        client.current = saved ? ApiClient.restore(saved) : await ApiClient.register();
      } catch {
        try {
          client.current = await ApiClient.register(); // restore failed: start fresh
        } catch {
          return setFailed(true); // could not get a client at all
        }
      }
      stopAutosave.current = startAutosave(client.current);
    },
    onDemoted() {
      stopAutosave.current?.();
      stopAutosave.current = null;
      client.current?.close();
      client.current = null;
    },
  });

  // Standby tabs mirror the leader's latest snapshot, starting from storage.
  useEffect(() => {
    setMirror(readSaved());
    const channel = new BroadcastChannel(KEY);
    channel.onmessage = (event: MessageEvent<Snapshot>) => setMirror(event.data);
    return () => channel.close();
  }, []);

  return { state, mirror, getClient: () => client.current };
}
```

The leader owns `getClient()`; every other tab reads `mirror`. A snapshot restored after a crash can be up to one interval old, so choose the interval to match how much your client can lose. Remove the `api-client` key from `localStorage` on logout, so the next user never restores someone else's session. A reusable version of this pattern is planned for `@web-locks/react-extras`.

## API reference

```ts
import { useLeader, useLock, useLockQuery } from "@web-locks/react";
import type {
  LeadershipState,
  LockState,
  LocksLike,
  UseLeaderOptions,
  UseLockOptions,
  UseLockQueryOptions,
  UseLockResult,
  UseLockQueryResult,
} from "@web-locks/react";
```

Every hook takes an optional `locks` (a `LocksLike`, i.e. `Pick<LockManager, "request" | "query">`) so you can inject a lock manager, for example a fake in tests. It defaults to `navigator.locks`. **`locks` must be referentially stable** (a module-level constant, not an object created during render): a new identity restarts the hook.

Callbacks (`onPromoted`, `onDemoted`, `onAcquired`, `onLost`) are read from the latest render, so changing them never re-elects or re-acquires. The hooks swallow errors thrown by your callbacks; handle errors inside them.

### `useLeader(name: string, options?: UseLeaderOptions): LeadershipState`

Leader election across tabs: one exclusive lock, held until this tab resigns, closes, crashes, freezes or unmounts. The browser hands it to the next waiting tab.

| Option       | Type                          | Description                                                                     |
| ------------ | ----------------------------- | ------------------------------------------------------------------------------- |
| `onPromoted` | `() => void \| Promise<void>` | Runs when this tab becomes the leader.                                          |
| `onDemoted`  | `() => void \| Promise<void>` | Runs before leadership is released, so the next leader never overlaps this one. |
| `enabled`    | `boolean`                     | Set to `false` to step down and stay out of the election. Defaults to `true`.   |
| `locks`      | `LocksLike`                   | Lock manager to use. Must be referentially stable.                              |

| State         | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `pending`     | Server render, first client render, `enabled` is `false`, or still deciding. |
| `leader`      | This tab is the leader.                                                      |
| `standby`     | Another tab leads; this tab is queued to take over.                          |
| `unsupported` | No Web Locks API.                                                            |

When the page is frozen (Chromium `freeze` event) the tab resigns and stays out of the queue until `resume`. A frozen page cannot run code, so after a freeze the state reads `standby` even though the tab is not queued. With `enabled={false}` the hook reports `pending`, which is also the server snapshot.

### `useLock(name: string, options?: UseLockOptions): UseLockResult`

Holds the lock `name` for as long as the component is mounted. Returns `{ status: LockState; release(): Promise<void> }`.

| Option        | Type                      | Description                                                                                 |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `mode`        | `"exclusive" \| "shared"` | Lock mode. Defaults to `"exclusive"`.                                                       |
| `ifAvailable` | `boolean`                 | Do not queue: `status` becomes `unavailable` if the lock is taken.                          |
| `steal`       | `boolean`                 | Take the lock from the current holder, whose `onLost` is called.                            |
| `enabled`     | `boolean`                 | Set to `false` to release (and not acquire) the lock. Defaults to `true`.                   |
| `onAcquired`  | `() => void`              | Called each time the lock is acquired.                                                      |
| `onLost`      | `() => void`              | Called if the lock is taken from this component after it was granted (for example, stolen). |
| `locks`       | `LocksLike`               | Lock manager to use. Must be referentially stable.                                          |

There is no `signal` option: the hook aborts a queued request itself on unmount or when its inputs change. `ifAvailable` and `steal` requests never queue.

| State         | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `idle`        | Server render, first client render, `enabled` is `false`, released, or lost. |
| `pending`     | Requested and queued.                                                        |
| `held`        | This tab holds the lock.                                                     |
| `unavailable` | `ifAvailable` was set and the lock was taken.                                |
| `unsupported` | No Web Locks API.                                                            |

The lock is released on unmount, when `enabled` becomes `false`, and when `name`, `mode`, `ifAvailable`, `steal` or `locks` change (it is then re-acquired, once the previous lock is fully released). A stolen lock is not re-acquired automatically: `status` becomes `idle` and `onLost` runs.

`release()` frees the held lock now and returns the status to `idle`. It does **not** re-acquire on the next render: the lock is acquired again only when the deps above change or the component remounts.

### `useLockQuery(options?: UseLockQueryOptions): UseLockQueryResult`

Observes the held and pending locks of the lock manager. Returns `{ held: LockInfo[]; pending: LockInfo[]; refresh(): Promise<void> }`.

| Option         | Type        | Description                                                              |
| -------------- | ----------- | ------------------------------------------------------------------------ |
| `pollInterval` | `number`    | Re-query every this many milliseconds. No polling unless greater than 0. |
| `locks`        | `LocksLike` | Lock manager to query. Must be referentially stable.                     |

`held` and `pending` start empty (also on the server), the first query runs after mount, and `refresh()` queries now and resolves once the result has been applied. A failed query keeps the previous value, results arriving after unmount are ignored, and an unchanged snapshot does not re-render.

### Types

`LeadershipState`, `LockState` and `LocksLike` are re-exported from `@web-locks/core` so you can type your own props. `LockInfo` is the DOM type.

## SSR

Importing the package has no side effects and never touches `navigator` or `document`. On the server and during hydration, `useLeader` returns `pending`, `useLock` returns `status: "idle"`, and `useLockQuery` returns empty lists, so server and client markup match. Elections, requests and queries start in effects after mount.

## StrictMode

Safe. StrictMode's mount, unmount, mount sequence leaves exactly one lock held or queued: the discarded first run is released before the second one requests.

## Browser support

| Feature                                  | Chrome / Edge | Firefox | Safari |
| ---------------------------------------- | ------------- | ------- | ------ |
| Web Locks API                            | 69            | 96      | 15.4   |
| Page `freeze` / `resume` events (leader) | Yes           | No      | No     |

Where `freeze`/`resume` are unavailable, `useLeader` still works; it just does not resign on freeze. Without the Web Locks API the hooks report `unsupported`.

## License

[Apache-2.0](https://github.com/web-locks/web-locks/blob/main/LICENSE)
