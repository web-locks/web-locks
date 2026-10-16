# web-locks

[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![@web-locks/core](https://img.shields.io/npm/v/@web-locks/core?label=%40web-locks%2Fcore)](https://www.npmjs.com/package/@web-locks/core)
[![@web-locks/react](https://img.shields.io/npm/v/@web-locks/react?label=%40web-locks%2Freact)](https://www.npmjs.com/package/@web-locks/react)

The [Web Locks API](https://developer.mozilla.org/docs/Web/API/Web_Locks_API) lets code in different tabs, windows and workers of the same origin take named locks, so only one of them runs a piece of work at a time. This repository provides small, SSR-safe helpers on top of it for cross-tab coordination (leader election and exclusive resources): a framework-agnostic core and React hooks.

## Packages

| Package                                            | Description                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| [`@web-locks/core`](packages/core)                 | Framework-agnostic: leader election, lock handles, observable lock stores. |
| [`@web-locks/react`](packages/react)               | React hooks (`useLeader`, `useLock`, `useLockQuery`) built on the core.    |
| [`@web-locks/react-extras`](packages/react-extras) | Placeholder (private), coming soon.                                        |

Bindings for other frameworks may follow.

## Quickstart

### Core

```sh
npm i @web-locks/core
```

```ts
import { createLeader } from "@web-locks/core";

const leader = createLeader({
  name: "sync-worker",
  onPromoted: () => startSync(),
  onDemoted: () => stopSync(),
  onError: (error) => console.error(error),
});

leader.subscribe(() => {
  console.log("leadership:", leader.getState()); // pending | leader | standby | unsupported
});

leader.start();

// later
await leader.stop();
```

### React

```sh
npm i @web-locks/react
```

Requires React 18 or newer.

```tsx
import { useLeader } from "@web-locks/react";

export function SyncStatus() {
  const state = useLeader("sync-worker", {
    onPromoted: () => console.log("syncing"), // this tab became the leader
    onDemoted: () => console.log("stopped syncing"), // runs before leadership is released
  });

  return <p>This tab is: {state}</p>; // pending | leader | standby | unsupported
}
```

See the package READMEs for the full API: [core](packages/core/README.md) and [react](packages/react/README.md).

## Live demos

- Website: <https://web-locks.github.io/>
- React demo: <https://web-locks.github.io/react/>
- Vanilla (core) demo: <https://web-locks.github.io/vanilla/>

Open a demo in several tabs to watch leadership move between them.

## Repository layout

```
packages/
  core/           @web-locks/core
  react/          @web-locks/react
  react-extras/   placeholder (private)
apps/
  website/        landing page
  react-example/  React demo
  core-example/   vanilla demo
tools/
  fake-locks/     in-memory LockManager for tests
docs/             release guide, design spec and plan
scripts/          site assembly
```

## Development

This is a [Vite+](https://viteplus.dev/) pnpm monorepo; the `vp` CLI drives everything. Node 22.18 or newer is required.

```sh
vp install            # install dependencies
vp check              # format, lint and type-check
vp run -r test        # tests in every package
vp run -r build       # build every package and app
vp run ready          # check + test + build, as CI does
```

Run a site locally with `vp run website#dev`, or `vp dev` inside an app's directory (`apps/website`, `apps/react-example`, `apps/core-example`).

### Testing

Tests do not need a browser's lock manager. `tools/fake-locks` provides an in-memory `LockManager` implementation (exclusive and shared modes, `ifAvailable`, `steal`, abort signals, `query`) that can be injected through the `locks` option every core function and React hook accepts, so multi-tab scenarios run deterministically in one process.

## Releasing

All packages share one version and releases are cut by tagging. See [docs/RELEASING.md](docs/RELEASING.md).

## Contributing

Issues and pull requests are welcome. Please run `vp run ready` before opening a pull request and keep changes focused.

## License

[Apache-2.0](LICENSE)
