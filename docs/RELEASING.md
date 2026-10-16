# Releasing

All packages in the workspace share one version (lockstep). Releases are cut by tagging; CI does the publishing.

## Cut a release

1. Be on a clean, up-to-date `main` (`git status` empty, `git pull`).
2. `vp run ready` (check, test, build) must pass.
3. `vp run release` (runs `bumpp -r`). Pick the new version when prompted. It bumps every `package.json`, commits `release: vX.Y.Z`, tags `vX.Y.Z` and pushes both (`bump.config.ts`; it does not run an install).
4. Watch GitHub Actions:
   - `release.yml` (tag `v*`): verifies the tag equals the `packages/core` version, runs check/test/build, then `vp pm publish -r --access public --provenance --no-git-checks` (pnpm under the hood: topological order, `@web-locks/core` before `@web-locks/react`; private packages are skipped).
   - `deploy-sites.yml` (push to `main`): rebuilds and pushes the website, `/react/` and `/vanilla/` demos to `web-locks/web-locks.github.io`.
   - `ci.yml`: runs on pull requests and on `main`.

## Secrets (on `web-locks/web-locks`)

| Secret               | What                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `NPM_TOKEN`          | npm automation or granular access token with publish rights to the `@web-locks` scope.               |
| `PAGES_DEPLOY_TOKEN` | Fine-grained personal access token with Contents read/write on `web-locks/web-locks.github.io` only. |

Recommended alternative for npm: configure trusted publishing (OIDC) for both packages on npmjs.com, pointing at this repository and `release.yml`. Then `NPM_TOKEN` can be dropped; provenance is attached automatically and the workflow's `id-token: write` permission is already in place (verify that the pinned pnpm, run through `vp pm`, supports OIDC trusted publishing before relying on it; npm itself needs CLI >= 11.5.1).

Provenance requires the source repository `web-locks/web-locks` to be public.

Hardening (recommended):

- Add a tag ruleset restricting who can create `v*` tags. `release.yml` also refuses to publish a tag whose commit is not an ancestor of `origin/main`.
- Move `NPM_TOKEN` into a GitHub Environment (for example `npm`) restricted to `v*` tags, optionally with required reviewers. The workflow does not use an Environment yet: create it first, then add `environment: npm` to the `release` job.
- Versions containing `-` (for example `0.2.0-beta.1`) publish under the `next` dist-tag; others under `latest`.

## One-time Pages setup

1. Create an empty, public repository `web-locks/web-locks.github.io` (no README or license).
2. Create a fine-grained personal access token (Settings, Developer settings): resource owner `web-locks`, repository access limited to `web-locks/web-locks.github.io`, permission Contents: read and write. Set an expiry and calendar the renewal.
3. On `web-locks/web-locks`: Settings, Secrets and variables, Actions, new secret `PAGES_DEPLOY_TOKEN` with the token value.
4. On `web-locks/web-locks.github.io`: Settings, Pages, deploy from branch, the default branch (`main`), folder `/ (root)`.
5. Run the "Deploy sites" workflow via workflow_dispatch to make the first push (an empty repo is handled: the workflow pushes to `main`).

## First-release checklist

- [ ] Packages are at `0.0.0`; `vp run release` and choose `0.1.0`.
- [ ] `NPM_TOKEN` (or trusted publishing) and `PAGES_DEPLOY_TOKEN` are set; the `@web-locks` npm scope exists and you own it.
- [ ] `web-locks.github.io` exists, token secret added, Pages enabled.
- [ ] `vp pm publish -r --dry-run --no-git-checks --access public` lists only `@web-locks/core` and `@web-locks/react`.
- [ ] Do the first release as a dry run (the release workflow's publish step with `--dry-run`, e.g. on a fork or throwaway tag) and verify that the `registry-url` input of `setup-vp` writes the npm auth config (an `.npmrc` using `NODE_AUTH_TOKEN`); without it the real publish fails with `ENEEDAUTH`.
- [ ] After release: check the npm pages show the provenance badge and the site loads at `/`, `/react/`, `/vanilla/`.

## Troubleshooting

- "tag does not match packages/core version": the tag was created by hand or the bump commit is missing. Delete the tag (`git push --delete origin vX.Y.Z`), fix, retag.
- `E403`/`E404` on publish: token lacks rights to the `@web-locks` scope, or the scope does not exist.
- Provenance error: requires GitHub-hosted runners and `id-token: write`; it cannot work from a local machine.
- Deploy fails with a 403 or "Permission denied": `PAGES_DEPLOY_TOKEN` is missing, expired, or lacks Contents read/write on `web-locks.github.io`.
- Pages shows nothing: confirm Pages is on for the default branch and that `.nojekyll` is in the site repo root.
- Preview the Pages tree locally: `vp run -r build && scripts/assemble-site.sh`, then inspect `site/`.
