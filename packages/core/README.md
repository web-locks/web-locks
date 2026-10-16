# @web-locks/core

[![npm version](https://img.shields.io/npm/v/@web-locks/core)](https://www.npmjs.com/package/@web-locks/core)
[![license](https://img.shields.io/npm/l/@web-locks/core)](https://github.com/web-locks/web-locks/blob/main/LICENSE)

```sh
npm i @web-locks/core
```

Framework-agnostic helpers for the [Web Locks API](https://developer.mozilla.org/docs/Web/API/Web_Locks_API): leader election across tabs, a promise-based lock handle, and a small observable store for a lock's lifecycle. Zero dependencies, tree-shakeable, and safe to import during SSR.

[Live demo](https://web-locks.github.io/vanilla/) | [Repository](https://github.com/web-locks/web-locks)

## Examples

### `createLeader`: one active tab

```ts
import { createLeader } from "@web-locks/core";

const leader = createLeader({
  name: "sync-worker",
  onPromoted: () => startSync(),
  onDemoted: () => stopSync(),
  onError: (error) => console.error(error),
});

const unsubscribe = leader.subscribe(() => {
  console.log("leadership:", leader.getState()); // pending | leader | standby | unsupported
});

leader.start();

// later
await leader.stop();
unsubscribe();
```

### `acquireLock`: hold a lock until released

```ts
import { acquireLock } from "@web-locks/core";

const handle = await acquireLock("db-migration", { ifAvailable: true });
if (handle) {
  try {
    await migrate();
  } finally {
    await handle.release();
  }
} else {
  console.log("another tab holds the lock (or the API is unsupported)");
}
```

### `createLockStatus`: a lock as an observable store

```ts
import { createLockStatus } from "@web-locks/core";

const status = createLockStatus("export-job", {
  onAcquired: () => console.log("got it"),
});

status.subscribe(() => {
  console.log(status.getState()); // idle | pending | held | unavailable | unsupported
});

status.start();
// ...
await status.release();
```

### `queryLocks`: inspect held and pending locks

```ts
import { queryLocks } from "@web-locks/core";

const { held = [], pending = [] } = await queryLocks();
console.log(
  held.map((lock) => lock.name),
  pending.length,
);
```

### `isSupported`

```ts
import { isSupported } from "@web-locks/core";

if (!isSupported()) showFallback();
```

## API reference

Every function accepts an optional `locks` (a `LocksLike`, i.e. `Pick<LockManager, "request" | "query">`) so you can inject a lock manager, for example a fake in tests. It defaults to `navigator.locks`.

### `isSupported(locks?: LocksLike): boolean`

`true` when the Web Locks API (or the given `locks`) is available.

### `queryLocks(locks?: LocksLike): Promise<LockManagerSnapshot>`

Resolves `navigator.locks.query()`: `{ held?, pending? }` (both fields are optional in the DOM type, so default them). Resolves `{ held: [], pending: [] }` when unsupported.

### `acquireLock(name: string, options?: AcquireOptions): Promise<LockHandle | null>`

Requests the lock `name` and resolves a handle once it is granted.

| Option        | Type                      | Description                                                                                     |
| ------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `mode`        | `"exclusive" \| "shared"` | Lock mode. Defaults to `"exclusive"`.                                                           |
| `ifAvailable` | `boolean`                 | Do not queue: resolve `null` if the lock is taken.                                              |
| `steal`       | `boolean`                 | Take the lock from the current holder, whose `onLost` is called.                                |
| `signal`      | `AbortSignal`             | Abort a queued request. The promise rejects with `AbortError`.                                  |
| `locks`       | `LocksLike`               | Lock manager to use.                                                                            |
| `onLost`      | `() => void`              | Called if the lock is taken from this holder after it was granted (for example, it was stolen). |

Resolves `null` when the API is unsupported or when `ifAvailable` finds the lock taken. A `LockHandle` has `name` and `release(): Promise<void>`; `release()` is idempotent and resolves once the underlying request has finished.

### `createLockStatus(name: string, options?: LockStatusOptions): Store<LockState> & { start(): void; release(): Promise<void> }`

Tracks one lock's lifecycle. Takes every `acquireLock` option plus `onAcquired?: () => void` (called each time the lock is acquired; errors are swallowed). Returns a `Store<LockState>` (`getState()`, `subscribe(listener)`; compatible with `useSyncExternalStore`) plus:

- `start(): void` begins acquiring. No-op unless the state is `idle`.
- `release(): Promise<void>` releases the lock or cancels a queued request, returns to `idle`, and resolves when the release has finished.

| State         | Meaning                                       |
| ------------- | --------------------------------------------- |
| `idle`        | Not started, released, or the lock was lost.  |
| `pending`     | Requested and queued.                         |
| `held`        | This tab holds the lock.                      |
| `unavailable` | `ifAvailable` was set and the lock was taken. |
| `unsupported` | No Web Locks API.                             |

A `start()` issued after `release()` waits for the earlier acquisition to finish. If that earlier request was queued with a caller-supplied `signal` (so the store cannot abort it), the new start stays `pending` until that request settles.

### `createLeader(options: LeaderOptions): Leader`

Leader election: one exclusive lock, held until this tab resigns, closes, crashes or freezes. The browser hands the lock to the next waiting tab.

| Option       | Type                          | Description                                                                   |
| ------------ | ----------------------------- | ----------------------------------------------------------------------------- |
| `name`       | `string`                      | Lock name every competing tab uses.                                           |
| `onPromoted` | `() => void \| Promise<void>` | Runs when this tab becomes the leader.                                        |
| `onDemoted`  | `() => void \| Promise<void>` | Runs before the lock is released, so the next leader never overlaps this one. |
| `onError`    | `(error: unknown) => void`    | Receives errors thrown by the hooks and failed lock requests.                 |
| `locks`      | `LocksLike`                   | Lock manager to use.                                                          |
| `pageEvents` | `PageEvents`                  | Freeze/resume source. Defaults to `windowPageEvents` when `document` exists.  |

Returns a `Store<LeadershipState>` plus `start(): void` and `stop(): Promise<void>` (gives up leadership or a queued request and resolves once demotion has finished).

| State         | Meaning                                             |
| ------------- | --------------------------------------------------- |
| `pending`     | Not started, or deciding whether the lock is free.  |
| `leader`      | This tab is the leader.                             |
| `standby`     | Another tab leads; this tab is queued to take over. |
| `unsupported` | No Web Locks API.                                   |

When the page is frozen (Chromium `freeze` event) the tab resigns and stays out of the queue until `resume`. A frozen page cannot run code, so while frozen the state reads `standby` even though the tab is not queued.

### `windowPageEvents: PageEvents`

The real page-lifecycle bridge: `onFreeze(cb)` and `onResume(cb)` listen on `document` and return an unsubscribe function. `document` is touched only when these are called. Supply your own `PageEvents` to `createLeader` to customise or test.

### Types

`LocksLike`, `Store<T>`, `LeadershipState`, `LockState`, `AcquireOptions`, `LockHandle`, `LockStatusOptions`, `LeaderOptions`, `Leader`, `PageEvents`.

## SSR

Importing the package has no side effects and never touches `navigator` or `document`. Without the Web Locks API (server rendering, older browsers), `createLeader` and `createLockStatus` report `unsupported`, `acquireLock` resolves `null`, and `queryLocks` resolves an empty snapshot.

## Browser support

| Feature                                  | Chrome / Edge | Firefox | Safari |
| ---------------------------------------- | ------------- | ------- | ------ |
| Web Locks API                            | 69            | 96      | 15.4   |
| Page `freeze` / `resume` events (leader) | Yes           | No      | No     |

Where `freeze`/`resume` are unavailable, `createLeader` still works; it just does not resign on freeze.

## License

[Apache-2.0](https://github.com/web-locks/web-locks/blob/main/LICENSE)
