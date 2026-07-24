# Manual smoke test: `deliveryos push`

The automated suite (`test/e2e/push.e2e.test.ts`) exercises the entire push
orchestrator against a real local git repo with a *fake* Octokit client, so it
never hits the network. This runbook is the complementary manual check that
`deliveryos push` also works against the *real* GitHub API, using your own
`gh` auth. Run it once after any change that touches `src/engine/github/`,
`src/engine/push/`, or `src/cli/commands/push.ts`.

## Prerequisites

- `gh auth login` completed (`gh auth status` should show you logged in).
- A throwaway scratch repo on GitHub you can open PRs against (e.g.
  `your-username/deliveryos-smoke-test`), cloneable over SSH or HTTPS.
- The repo seeded with at least one DeliveryOS artifact, e.g.:
  ```
  artifacts/smoke-artifact/manifest.yaml
  artifacts/smoke-artifact/payload/README.md
  ```
  (see `test/fixtures/testRemote.ts` for a minimal manifest.yaml shape).
- `npm install && npm run build` done locally in this repo (or use
  `npm run dev -- <args>` / `npx tsx src/index.ts <args>` to run from source).

## Part 1: edit mode

1. Register the scratch repo as a remote and pull the seeded artifact:
   ```
   deliveryos remote add git@github.com:<you>/deliveryos-smoke-test.git --name smoke
   deliveryos pull smoke-artifact
   ```
2. Edit the pulled payload locally, e.g. append a line to
   `smoke-artifact/README.md`.
3. Run the real push:
   ```
   deliveryos push smoke-artifact
   ```
4. Confirm the command prints something like:
   ```
   Opened PR #<n>: https://github.com/<you>/deliveryos-smoke-test/pull/<n> (branch deliveryos/smoke-artifact/<timestamp>-<hex>)
   ```
5. Open the printed PR URL in a browser and confirm:
   - **Branch name** matches `deliveryos/smoke-artifact/YYYYMMDDHHmmss-xxxx`
     (14-digit UTC timestamp, 4 lowercase hex chars).
   - **Diff** shows exactly the edit you made under
     `artifacts/smoke-artifact/payload/README.md` — nothing else changed.
   - **Title** is `[DeliveryOS] Update smoke-artifact (v<version>)`.
   - **Body** lists the changed file(s) under a "Changed files" section, and
     shows the artifact's kind/owner/version.
6. Cleanup (courtesy, not required — the repo is throwaway): close the PR
   and delete the `deliveryos/smoke-artifact/...` branch.

## Part 2: propose-new mode

1. Create a small local payload directory that isn't part of any pulled
   artifact, e.g.:
   ```
   mkdir smoke-new-payload
   echo "# brand new artifact" > smoke-new-payload/README.md
   ```
2. Run the real push in propose-new mode:
   ```
   deliveryos push smoke-new-artifact --new --remote smoke \
     --path smoke-new-payload --kind doc --owner your-team \
     --description "Smoke test of propose-new mode" \
     --artifact-version 1.2.0
   ```
   Note it's `--artifact-version`, not `--version`: `--version`/`-V` is
   reserved globally by Commander for the CLI's own `deliveryos --version`
   (prints the installed package version and exits immediately, doing no
   git/GitHub work at all) -- passing `--version` to the `push` subcommand
   would silently hit that global flag instead of setting the artifact's
   version.
3. Confirm the command prints the PR URL/branch, same as Part 1.
4. Open the PR and confirm:
   - **Branch name** matches `deliveryos/smoke-new-artifact/YYYYMMDDHHmmss-xxxx`.
   - **New files** in the diff: `artifacts/smoke-new-artifact/manifest.yaml`
     and `artifacts/smoke-new-artifact/payload/README.md`, and nothing else.
   - **Title** is `[DeliveryOS] Propose new artifact: smoke-new-artifact`.
   - **Body** lists the new files under a "New files" section and shows the
     kind/owner/version/tags you passed on the command line (version should
     read `1.2.0`, matching `--artifact-version` above).
5. Re-running the same command again (without changing the id) should now
   hard-error with an id-collision message, since `smoke-new-artifact` exists
   in the remote's catalog as of the PR branch... note: the collision check
   is against the remote's default branch, not open PR branches, so this
   only reproduces once the PR from step 2 is merged. To manually exercise
   the collision error before merging, just re-run step 2's command with an
   id that's already merged into the remote (e.g. the `smoke-artifact` id
   from Part 1).
6. Cleanup (courtesy, not required): close the PR and delete the
   `deliveryos/smoke-new-artifact/...` branch.
