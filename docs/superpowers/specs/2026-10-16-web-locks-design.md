# Web Locks monorepo: design

Date: 2026-10-16
Status: draft for review

## 1. Goal

A TypeScript monorepo, published under the `@web-locks` npm scope and hosted at
`https://github.com/web-locks/web-locks`, that wraps the browser Web Locks API
(`navigator.locks`) for cross-tab coordination.

- `@web-locks/core`: framework-agnostic primitives. Zero dependencies.
- `@web-locks/react`: React hooks over core. `react` is a peer dependency
  (>=18); `@web-locks/core` is a runtime dependency.
- `@web-locks/react-extras`: placeholder only. Out of scope; `private: true`,
  not published.
- Angular and other framework packages: out of scope. The core/binding split
  exists so they are cheap to add later.

The origin is the leader-election code in
`/home/timm/TMO/tmo-main/apps/agent/src/lib/agent/leader.ts`. Its hardened
behavior (below) is preserved.

### Constraints

- No runtime dependencies other than the `react` peer. Dev-only tooling is the
  Vite+ toolchain already scaffolded (Vite+ 1.3.0, pnpm workspaces, `vp pack`
  / tsdown, Vitest, Oxlint, Oxfmt, `bumpp`) plus the dev-only React test and
  example packages listed in section 7.
- ESM-only output with `.d.ts` files, as scaffolded.
- Publish-ready to npmjs.com, with a well-written README per package.
- SSR-safe: nothing touches `navigator` or `document` at import time.

## 2. `@web-locks/core`

Every function accepts an optional `locks` (default `navigator.locks`) so tests
can inject a fake.

- `isSupported(locks?) => boolean`
- `createLeader({ name, onPromoted, onDemoted, onError?, locks?, pageEvents? })`
  returns `{ start(), stop(): Promise<void>, getState(), subscribe(listener) }`.
  State: `"pending" | "leader" | "standby" | "unsupported"`. Port of
  `leader.ts` with its behavior kept:
  - first request uses `ifAvailable` so a free lock is taken with no standby
    flash; afterwards it queues behind the holder
  - pauses on `freeze`, resumes on `resume` (`pageEvents` injectable, default
    `document` events)
  - generation-guarded `start`/`stop`; overlapping calls settle on the latest
    intent
  - `onDemoted` runs before the lock is released
  - hook errors are caught and passed to `onError` (the `@lib/logging`
    dependency is dropped)
  - a failed lock request retries after 1s
- `acquireLock(name, { mode?, ifAvailable?, steal?, signal?, locks? })`
  returns `Promise<LockHandle | null>`. The handle has `release()` and holds
  the lock by keeping the underlying request promise pending. Resolves `null`
  when `ifAvailable` finds the lock taken.
- `createLockStatus(...)`: small store for one acquisition's lifecycle
  (`idle | pending | held | unavailable | unsupported`) with `subscribe` and
  `getState`. Shared logic for framework bindings.
- `queryLocks(locks?) => Promise<{ held, pending }>`; empty arrays when
  unsupported.

Not included (YAGNI): provider, callback-scoped `withLock`, default lock-name
prefix.

## 3. `@web-locks/react`

Thin `useSyncExternalStore` layer over core stores.

- `useLeader(name, { onPromoted?, onDemoted?, enabled?, locks? })` returns the
  leadership state. Callbacks live in refs, so changing them never re-elects.
  Leadership is released on unmount and when `enabled` becomes false.
- `useLock(name, { mode?, ifAvailable?, steal?, enabled?, onAcquired?, locks? })`
  returns `{ status, release }`. Holds the lock while mounted or until
  `release()`.
- `useLockQuery({ pollInterval?, locks? })` returns `{ held, pending, refresh }`.
  The Web Locks API has no change events, so refresh is manual or polled.

SSR: hooks return `"pending"`/`"unsupported"` on the server and do nothing
until mounted. Must behave correctly under React StrictMode double mounting.

## 4. Example apps

`core-example` and `react-example` replace the stock Vite starter contents.
Both are `private`.

### `apps/core-example` (vanilla TypeScript + HTML)

One page, three panels: leader (live state, Start/Stop), exclusive lock
(Acquire/Release, `ifAvailable` toggle via `acquireLock`), lock inspector
(`queryLocks`, Refresh, auto-refresh toggle).

### `apps/react-example` (React)

The same three demos as components, plus the centerpiece **singleton client**:

- A simulated `ServiceClient` registers with a mock service. The mock service
  is a `localStorage` entry holding a registration count.
- `useLeader("demo.client", ...)` makes exactly one tab the owner of the
  client. Standby tabs render a read-only view.
- Handoff: `onDemoted` (which runs before the lock is released) serializes the
  client state (id, session token, message count) to `localStorage`;
  `onPromoted` reads it and resumes the same client without registering again,
  so the registration count stays at 1.
- Crash case: the leader also snapshots on every state change. A "Simulate
  crash" button skips clean demotion to show recovery from the last snapshot.
- Standby tabs mirror the leader live through a `BroadcastChannel`.
- Public-facing polish: "open this page in a second tab" instructions, an
  unsupported-browser message, links to the repo and npm packages.
- Styling: hand-written CSS with design tokens (light and dark). No UI library.

The library itself stays free of any state-sharing opinion; the handoff is a
documented pattern. A reusable helper could later live in `react-extras`.

### `apps/website`

Static landing page for the project: what the packages are, install commands,
links to both live demos, the npm packages and the repo. Replaces the stock
starter contents. Kept small; no framework required.

## 5. Hosting

GitHub serves a project repo at `web-locks.github.io/<repo>/`, so the target
URLs require the org-site repo `web-locks/web-locks.github.io`.

| App | URL | Vite `base` |
| --- | --- | --- |
| `website` | `https://web-locks.github.io/` | `/` |
| `react-example` | `https://web-locks.github.io/react/` | `/react/` |
| `core-example` | `https://web-locks.github.io/vanilla/` | `/vanilla/` |

`base` is set for production builds only, so local `vp dev` serves from `/`.

A workflow in this repo, run on pushes to `main` after `vp check`, tests and
build pass, builds the libraries and the three apps and pushes the combined
output to `web-locks/web-locks.github.io` using plain `git` (no third-party
action). Prerequisites that only the repo owner can do:

1. Create the empty `web-locks/web-locks.github.io` repo and enable Pages from
   its default branch.
2. Add a deploy key (or fine-grained token) with write access to that repo as
   a secret in this repo.

The apps import the workspace packages, so the deployed demos reflect `main`,
not the last npm release. Web Locks needs a secure context; Pages is HTTPS.

## 6. Testing

- Core: Vitest with an in-memory fake `LockManager` (exclusive and shared
  queuing, `ifAvailable`, `steal`, `signal`, `query`). The scenarios from the
  reference `leader.test.ts` are ported and generalized.
- React: Vitest with jsdom and `@testing-library/react`, using the same fake
  through the `locks` option. Covers mount/unmount release, StrictMode double
  mount, and `enabled` toggling.
- Manual: smoke-test both example apps across two tabs in a real browser.
- Gate: `vp check`, `vp run -r test`, `vp run -r build` (the existing
  `ready` script).

## 7. Packaging and publishing

- Replace all starter metadata: description, `repository`
  (`git+https://github.com/web-locks/web-locks.git`, with `directory`),
  `homepage`, `bugs`, `keywords`, `author`, `sideEffects: false`, `engines`.
- `files` allowlist: `dist`, README, LICENSE. `publishConfig`: public access,
  provenance.
- `@web-locks/react`: `peerDependencies.react >=18`; `dependencies`
  `@web-locks/core: workspace:*` (rewritten by pnpm on publish).
- `react-extras`: `private: true`, short "coming soon" README.
- Releases use `bumpp` (already a devDependency). Publish order: core, then
  react. A tag-triggered workflow runs checks and publishes with provenance.
  The exact `bumpp` multi-package invocation is verified during planning.
- Verify with `npm pack --dry-run` and a check that type exports resolve for
  each package.
- New dev-only dependencies: `react`, `react-dom`, `@types/react`,
  `@types/react-dom`, `@vitejs/plugin-react`, `jsdom`,
  `@testing-library/react`.

## 8. Documentation

- Root README: overview, package table, quickstart, links to demos.
- `@web-locks/core` README: full API reference with vanilla examples.
- `@web-locks/react` README: hook reference and examples, the singleton-client
  handoff pattern, SSR and StrictMode notes, browser support table.
- `react-extras` README: placeholder.
- All READMEs written for npm (badges, install, links).
- License: the initial commit had an Apache-2.0 `LICENSE`, but the scaffold
  commit removed it and the package manifests say MIT. This must be resolved
  before publishing (see section 9).

## 9. Open items for the owner

- `apps/website` content is proposed above; adjust if you intended otherwise.
- Pages repo and deploy secret (section 5) must be created by the owner.
- License: Apache-2.0 (restore `LICENSE` from commit 10d7fcf, set each
  package's `license` to `Apache-2.0`) or MIT (add a new `LICENSE`)? Default
  assumption: Apache-2.0, since that was the original choice.
- npm: the `@web-locks` org exists; publishing needs an npm token or
  trusted-publisher configuration for provenance.
