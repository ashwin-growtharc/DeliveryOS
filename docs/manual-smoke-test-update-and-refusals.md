# Manual smoke test: the update path, install_target refusals, audit-log redaction

Three fixes land together here, and all three share the same shape: the thing
that proves them is **on disk in a real project**, not in a return value.
`test/e2e/applyUpdate.e2e.test.ts` asserts `applyAvailableUpdates`' own result
objects, `test/unit/redact.test.ts` asserts the redactor as a pure function,
and `test/e2e/wiring.e2e.test.ts` covers `wiring_actions.targetFile` — none of
them run the real CLI, and none of them can tell you that a file the engine
happily reported as "refused" is nonetheless sitting in `.git/hooks/`, or that
a payload landed in *two* places, or that a plaintext JSONL under `.deliveryos/`
picked up a live credential on the way past. Each of these three bugs was found
by hand, in a real project, and each one's real signature is a filesystem fact.
This runbook checks those facts. Run it after any change to
`src/engine/sync/applyUpdate.ts`, `src/engine/pull/pull.ts`,
`src/engine/pull/wiring.ts`, `src/engine/audit/redact.ts`, or any of the
`append*Log` helpers in `src/engine/pull/` and `src/engine/scan/`.

## Prerequisites

- `npm install` done in this repo. **No `npm run build` needed** — everything
  below runs from source via `tsx`, so nothing can pass or fail on a stale
  `dist/`.
- `git` on PATH.
- Windows PowerShell 5.1. Every command below is 5.1-parseable — no `&&`, no
  ternaries, no bash-isms.
- Set up the session once:
  ```
  $repo  = "C:\path\to\delivery-os"
  $smoke = "C:\deliveryos-smoke"
  $env:DELIVERYOS_HOME = "$smoke\home"
  function dos { & "$repo\node_modules\.bin\tsx.cmd" "$repo\src\index.ts" @args }
  ```
  `dos` is exactly `npx tsx src/index.ts <args>`, just reaching the repo's own
  `tsx` by full path: every command below runs with the *scratch project* as
  the current directory (the CLI reads `process.cwd()` for the project), and a
  bare `npx tsx` outside this repo downloads its own copy of `tsx` instead of
  using the installed one.

  `DELIVERYOS_HOME` keeps every remote registered below out of your real
  `~/.deliveryos`. Everything this runbook creates lives under `$smoke`;
  deleting that directory at the end leaves nothing behind.
- Re-running? Start clean, or the remote names collide:
  ```
  Set-Location $env:USERPROFILE
  Remove-Item -Recurse -Force $smoke
  ```

## Part 1: the update path that has never worked

`pull` records the `adaptSrcDirPath`-shortened install location in the
lockfile. `applyUpdate` re-derived it *raw* from the manifest. In any project
without a `src/` directory those two never matched, so the relocation guard
refused **every** update, permanently — with a message blaming the new version
for a move that never happened.

**Read this before you build the fixture.** The consuming project must contain
a root **`app/`** (or `pages/`) directory. `adaptSrcDirPath`
(`src/engine/paths.ts`) only shortens `src/lib/x` → `lib/x` when it can see
one. In an empty directory it returns `undefined`, `pull` falls back to the
manifest's literal `src/lib/x`, `applyUpdate` resolves that same literal value,
the two agree, and **the bug does not reproduce**. A green run in a project
with no `app/` proves nothing at all — it is a different code path.

1. Build the fixture remote (a plain local git repo — no GitHub, no network):
   ```
   $remote = "$smoke\remote-src"
   New-Item -ItemType Directory -Force "$remote\artifacts\src-smoke\payload" | Out-Null
   @(
     "id: src-smoke",
     "kind: doc",
     "description: Update-path smoke artifact",
     "owner: smoke-team",
     "version: 1.0.0",
     "tags:",
     "  roles: []",
     "  teams: []",
     "  stacks: []",
     "source_repo: https://example.invalid/src-smoke-remote",
     "install_target: src/lib/src-smoke",
     "review_required: false"
   ) | Set-Content -Encoding utf8 "$remote\artifacts\src-smoke\manifest.yaml"
   "# src-smoke v1.0.0" | Set-Content -Encoding utf8 "$remote\artifacts\src-smoke\payload\README.md"
   Set-Location $remote
   git init -q
   git config user.name "Smoke"
   git config user.email "smoke@invalid"
   git add -A
   git commit -q -m "seed src-smoke 1.0.0"
   ```
2. Create the consuming project — **`app/` and nothing else**:
   ```
   $proj = "$smoke\proj"
   New-Item -ItemType Directory -Force "$proj\app" | Out-Null
   Set-Location $proj
   git init -q
   Get-ChildItem $proj -Force | Select-Object -ExpandProperty Name
   ```
   Confirm the listing is exactly `.git` and `app`. If you see a `src`, stop
   and delete it — its presence flips `adaptSrcDirPath` to the other branch and
   the whole part becomes a no-op.
3. Register and pull:
   ```
   dos remote add $remote --name smoke
   dos pull src-smoke
   ```
   Confirm the second line reads `Pulled "src-smoke" -> ...\proj\lib\src-smoke`
   — `lib\src-smoke`, **not** `src\lib\src-smoke`. That shortening is the whole
   precondition for this part.
4. Assert where the payload actually is, on disk:
   ```
   Test-Path "$proj\lib\src-smoke\README.md"
   Test-Path "$proj\src"
   ```
   Must print `True` then `False`.
5. Assert what the lockfile recorded:
   ```
   (Get-Content "$proj\.deliveryos\lock.json" -Raw | ConvertFrom-Json).entries[0]
   ```
   `version` is `1.0.0`, and `installTarget` is an absolute path **ending in
   `\lib\src-smoke`**. If it ends in `\src\lib\src-smoke`, step 2 went wrong —
   go back and check for a stray `src/`.
6. Publish 1.1.0 upstream, with real content changes so the update is provable:
   ```
   Set-Location $remote
   (Get-Content "$remote\artifacts\src-smoke\manifest.yaml") -replace "^version: 1\.0\.0$", "version: 1.1.0" | Set-Content -Encoding utf8 "$remote\artifacts\src-smoke\manifest.yaml"
   "# src-smoke v1.1.0" | Set-Content -Encoding utf8 "$remote\artifacts\src-smoke\payload\README.md"
   "NEW IN 1.1.0" | Set-Content -Encoding utf8 "$remote\artifacts\src-smoke\payload\NEW.md"
   git add -A
   git commit -q -m "bump src-smoke to 1.1.0"
   Set-Location $proj
   ```
7. Detection first — this half was never broken, and confirming it isolates the
   failure to the apply half:
   ```
   dos check-updates
   ```
   Prints `src-smoke (smoke): 1.0.0 -> 1.1.0`.
8. Now the apply half:
   ```
   dos check-updates --apply
   ```
   - **Pre-fix**, one line, and it is a refusal:
     ```
     src-smoke (smoke): NOT updated (1.0.0 -> 1.1.0 available) -- This version moved install_target from "...\proj\lib\src-smoke" to "...\proj\src\lib\src-smoke" -- refusing to auto-update across a location change. Remove and re-pull it instead.
     ```
     Note what that message claims: a move from `lib/...` to `src/lib/...`.
     Nothing upstream moved — 1.1.0's `install_target` is the same string
     1.0.0's was. That "to" path is `applyUpdate` re-deriving it raw.
   - **Post-fix**, one line:
     ```
     src-smoke (smoke): updated 1.0.0 -> 1.1.0
     ```
   `check-updates --apply` **exits 0 either way** — a refusal is a normal,
   reported outcome, not a process failure. Do not assert on `$LASTEXITCODE`
   here; assert on the printed line and on disk.
9. Prove the update was real, not just reported:
   ```
   Get-Content "$proj\lib\src-smoke\README.md"
   Test-Path "$proj\lib\src-smoke\NEW.md"
   Test-Path "$proj\src"
   (Get-Content "$proj\.deliveryos\lock.json" -Raw | ConvertFrom-Json).entries[0]
   ```
   All four must hold:
   - `README.md` reads `# src-smoke v1.1.0` (new content overwrote old).
   - `NEW.md` exists (`True`) — a file only 1.1.0 has.
   - `$proj\src` is **still `False`**. An "update" that reports success and
     creates `src\lib\src-smoke` is a *different bug*, not a fix: the project
     now has two copies of the artifact, the lockfile points at one of them,
     and the next `check-updates` compares against whichever it finds.
   - lockfile `version` is `1.1.0` and `installTarget` is **byte-for-byte the
     same path as in step 5**.
10. **Control case — a genuine relocation must still be refused.** Publish a
    version that really does move `install_target`:
    ```
    Set-Location $remote
    (Get-Content "$remote\artifacts\src-smoke\manifest.yaml") -replace "^version: 1\.1\.0$", "version: 1.2.0" -replace "^install_target: src/lib/src-smoke$", "install_target: vendor/src-smoke" | Set-Content -Encoding utf8 "$remote\artifacts\src-smoke\manifest.yaml"
    "# src-smoke v1.2.0 relocated" | Set-Content -Encoding utf8 "$remote\artifacts\src-smoke\payload\README.md"
    git add -A
    git commit -q -m "relocate src-smoke install_target in 1.2.0"
    Set-Location $proj
    dos check-updates --apply
    ```
    Confirm it is refused, naming both real locations:
    ```
    src-smoke (smoke): NOT updated (1.1.0 -> 1.2.0 available) -- This version moved install_target from "...\proj\lib\src-smoke" to "...\proj\vendor\src-smoke" -- refusing to auto-update across a location change. Remove and re-pull it instead.
    ```
    And that nothing was written:
    ```
    Test-Path "$proj\vendor"
    Get-Content "$proj\lib\src-smoke\README.md"
    (Get-Content "$proj\.deliveryos\lock.json" -Raw | ConvertFrom-Json).entries[0].version
    ```
    `False`, still `# src-smoke v1.1.0`, still `1.1.0`.

    This control is the more important half of Part 1. Step 8's refusal and
    step 10's refusal print the *same sentence*; the only thing separating a
    fixed guard from a deleted one is that step 10 still refuses. **A change
    that makes the control case pass has removed a real safety guard, not
    fixed a bug.**

## Part 2: the `install_target` denylist refusal

`SENSITIVE_TARGET_PREFIXES` in `src/engine/pull/wiring.ts` — `.git/`,
`.github/workflows/`, `.vscode/`, `.husky/`, and now `.deliveryos/` — was only
ever consulted for `wiring_actions.targetFile`. An artifact's `install_target`
walked straight past it into `fs.cpSync`. Since `pull` needs no confirmation
for the payload copy, any manifest in any catalog could drop a real
`post-checkout` hook or a CI workflow into a project with nothing asking first.
That is now refused at pull time.

**The assertion that matters is on disk, not stdout.** A message printed after
`cpSync` has already run is not a refusal — it is a report of something that
already happened. Check the file, and check the lockfile.

1. Build one fixture remote holding every case at once:
   ```
   $deny = "$smoke\remote-deny"
   $specs = @(
     @{ id = "deny-git";        target = ".git/hooks";         file = "post-checkout" },
     @{ id = "deny-workflows";  target = ".github/workflows";  file = "pwned.yml" },
     @{ id = "deny-vscode";     target = ".vscode";            file = "tasks.json" },
     @{ id = "deny-husky";      target = ".husky";             file = "pre-commit" },
     @{ id = "deny-deliveryos"; target = ".deliveryos";        file = "planted.txt" },
     @{ id = "allow-claude";    target = ".claude/agents";     file = "my-agent.md" },
     @{ id = "allow-gitlab";    target = ".gitlab";            file = "ci.yml" },
     @{ id = "allow-ghactions"; target = "docs/github-actions"; file = "notes.md" }
   )
   foreach ($s in $specs) {
     $d = "$deny\artifacts\$($s.id)"
     New-Item -ItemType Directory -Force "$d\payload" | Out-Null
     @(
       "id: $($s.id)",
       "kind: doc",
       "description: Denylist smoke artifact",
       "owner: smoke-team",
       "version: 1.0.0",
       "tags:",
       "  roles: []",
       "  teams: []",
       "  stacks: []",
       "source_repo: https://example.invalid/deny-smoke",
       "install_target: $($s.target)",
       "review_required: false"
     ) | Set-Content -Encoding utf8 "$d\manifest.yaml"
     "PLANTED-BY-$($s.id)" | Set-Content -Encoding utf8 "$d\payload\$($s.file)"
   }
   Set-Location $deny
   git init -q
   git config user.name "Smoke"
   git config user.email "smoke@invalid"
   git add -A
   git commit -q -m "seed denylist artifacts"
   ```
2. Pull each one into its **own fresh project that is a real `git init` repo**
   — a `.git/` target is only meaningful against a directory that actually has
   one, and `pull`'s gitignore check reads the repo too:
   ```
   $first = $true
   foreach ($s in $specs) {
     $p = "$smoke\proj-$($s.id)"
     New-Item -ItemType Directory -Force $p | Out-Null
     Set-Location $p
     git init -q
     if ($first) { dos remote add $deny --name deny | Out-Null; $first = $false }
     Write-Output "--- $($s.id)  install_target: $($s.target) ---"
     dos pull $s.id
     $code = $LASTEXITCODE
     $landed = Test-Path (Join-Path $p ($s.target + "\" + $s.file))
     $locked = Test-Path "$p\.deliveryos\lock.json"
     Write-Output "exit=$code  fileLanded=$landed  hasLockfile=$locked"
   }
   ```
3. Post-fix, every line must match this table exactly:

   | id | `install_target` | exit | `fileLanded` | lockfile entry |
   |---|---|---|---|---|
   | `deny-git` | `.git/hooks` | non-zero | **False** | none |
   | `deny-workflows` | `.github/workflows` | non-zero | **False** | none |
   | `deny-vscode` | `.vscode` | non-zero | **False** | none |
   | `deny-husky` | `.husky` | non-zero | **False** | none |
   | `deny-deliveryos` | `.deliveryos` | non-zero | **False** | none |
   | `allow-claude` | `.claude/agents` | 0 | True | 1 entry |
   | `allow-gitlab` | `.gitlab` | 0 | True | 1 entry |
   | `allow-ghactions` | `docs/github-actions` | 0 | True | 1 entry |

   Each refusal must also print a message that **names the reason**, not a bare
   stack trace — it reads like this, with that artifact's own id and
   `install_target` in it:
   ```
   Error: Artifact "deny-git"'s install_target (".git/hooks") is inside a location whose contents can run on their own -- a git hook, CI workflow, editor auto-run task, or DeliveryOS's own project state. Refusing to install; nothing was written. Review this manifest by hand.
   ```
   "nothing was written" is a claim the `fileLanded=False` column is what
   actually verifies. Read it as a promise the next column has to keep.
4. **Pre-fix, for comparison** (this is what the five deny cases really did
   before the fix, measured, not assumed):
   - `.git/hooks`, `.github/workflows`, `.vscode`, `.husky` all printed a
     cheerful `Pulled "<id>" -> <path>`, exited **0**, left the planted file on
     disk and wrote a lockfile entry. A live git hook, installed silently.
   - `.deliveryos` exited **1** — but only after the copy. It printed a raw
     Node stack trace out of `writePristineSnapshot`
     (`Cannot copy ...\.deliveryos\ to a subdirectory of self ...`), and
     `planted.txt` was **already sitting in `.deliveryos\`**. This is precisely
     the case the on-disk assertion exists for: a non-zero exit that looks like
     a refusal, wasn't one, and would have let an artifact write next to
     `lock.json`.
5. **Negative control 1 — `.claude/agents/my-agent.md` must still pull.** This
   is not a nice-to-have. `deliveryos scan` generates `.claude/` install
   targets itself, and every real agent and skill artifact in the catalog
   installs there. Denying `.claude/` would make the entire scanned agent/skill
   half of the catalog unpullable in one move. This step is the guard against
   someone "tightening" the list later:
   ```
   Get-Content "$smoke\proj-allow-claude\.claude\agents\my-agent.md"
   ```
   Must print `PLANTED-BY-allow-claude`.
6. **Negative control 2 — no over-matching.** `.gitlab/` starts with `.git`
   but is not `.git/`, and a directory literally named `github-actions` is not
   `.github/workflows/`. Both must pull:
   ```
   Get-Content "$smoke\proj-allow-gitlab\.gitlab\ci.yml"
   Get-Content "$smoke\proj-allow-ghactions\docs\github-actions\notes.md"
   ```
   A prefix check written with `String.Contains` or a bare `.git` prefix passes
   every deny case above and still fails here.

## Part 3: audit-log redaction

The three append-only audit logs under `.deliveryos/` —
`wiring-merge-log.jsonl`, `build-fix-log.jsonl`, `design-fix-log.jsonl` —
each store the **full text of a real project file, twice** (`before` and
`after`), which is the right payload for the Activity tab's diff disclosure and
was, until now, entirely unredacted. `auth.ts` is the file the wiring-merge
flow touches more often than any other. Nothing gitignores `.deliveryos/`, so
this was one `git add -A` away from committing live credentials.

Redaction is at the **write** site (`appendWiringMergeLog` and friends), not at
display. That distinction is the whole test: **grep the file on disk. Never
judge this from the Activity panel** — a display-time filter looks identical in
the UI and leaves the credential in the file forever, and these logs are
append-only, so anything that lands in one is permanent.

1. Plant the canaries. One credential of each shape the redactor handles, plus
   the env reference that must survive, plus ordinary source that must survive:
   ```
   $p3 = "$smoke\proj-redact"
   New-Item -ItemType Directory -Force $p3 | Out-Null
   @(
     'import NextAuth from "next-auth";',
     '',
     'const AUTH_SECRET = "CANARY-hunter2-literal";',
     'const OPENAI_API_KEY = "sk-CANARY1234567890abcdefghijklmn";',
     'const headers = { Authorization: "Bearer CANARY-bearer-0987654321" };',
     'const env = "AWS_SECRET_ACCESS_KEY=CANARY-wJalrXUtnFEMIK7MDENG";',
     'const DATABASE_PASSWORD = "postgres://user:CANARY-pw@localhost:5432/db";',
     '',
     'export const authOptions = {',
     '  secret: process.env.AUTH_SECRET,',
     '  providers: [],',
     '};'
   ) | Set-Content -Encoding utf8 "$p3\auth.ts"
   ```
   (PowerShell 5.1's `Set-Content -Encoding utf8` writes a BOM; you will see it
   at the head of the log's `before` field. Harmless — ignore it.)
2. Trigger the merge flow. The apply half is what writes the log, and it takes
   the merged file directly, so this needs no `claude` and no network. The
   project has no `package.json`, so `runProjectBuild` reports `ran: false`,
   nothing is rolled back, and the log entry is written unconditionally:
   ```
   $merged = (Get-Content "$p3\auth.ts" -Raw) + "`nexport const merged = 1;`n"
   $req = @{
     id = "1"
     command = "artifact.applyWiringMerge"
     args = @{
       cwd = $p3
       targetFile = "auth.ts"
       mergedFile = $merged
       description = "Smoke: wire auth.ts"
       remote = "smoke"
       id = "smoke-plugin"
     }
   } | ConvertTo-Json -Depth 6 -Compress
   $req | & "$repo\node_modules\.bin\tsx.cmd" "$repo\src\sidecar.ts"
   ```
   Expect exactly one JSON line back:
   ```
   {"id":"1","ok":true,"result":{"applied":true,"rolledBack":false,"build":{"ran":false}}}
   ```
3. **The assertion.** Grep the file on disk for the canary:
   ```
   Select-String -Path "$p3\.deliveryos\*.jsonl" -Pattern "CANARY" -SimpleMatch
   ```
   **Must print nothing at all.** One hit is a failed test, whatever the
   Activity panel shows.
4. **The other half of the assertion** — redaction that empties the field
   destroys the log's whole purpose and fails this test just as hard:
   ```
   Get-Content "$p3\.deliveryos\wiring-merge-log.jsonl" -Raw
   ```
   Confirm the entry still carries real diff context: `import NextAuth from
   "next-auth";`, `export const authOptions = {`, `providers: []`, the added
   `export const merged = 1;` in `after`, and `targetFile` /`description` /
   `remoteName` / `artifactId` intact. Each planted credential should read as
   its own surroundings with `[redacted]` in the value slot, e.g.
   `const AUTH_SECRET = "[redacted]";`, `Authorization: "Bearer [redacted]"`,
   `AWS_SECRET_ACCESS_KEY=[redacted]`. The value goes; the line stays.
5. **`process.env.AUTH_SECRET` must be PRESERVED.** Confirm it explicitly:
   ```
   Select-String -Path "$p3\.deliveryos\wiring-merge-log.jsonl" -Pattern "process.env.AUTH_SECRET" -SimpleMatch
   ```
   Must return a hit. An env *reference* is a variable name, not a credential —
   the secret lives in `.env`, which this flow never reads. Redacting it turns
   `secret: process.env.AUTH_SECRET` into `secret: [redacted]`, which is the
   single most common line in the file this flow touches most, and the Activity
   diff for `auth.ts` goes blank at exactly the line someone opened it to read.
   This one is easy to "fix" back into a regression, so check it every time.
6. Repeat for the build-fix log, which additionally redacts `buildError` (a
   failing build routinely dumps the environment into its own stderr):
   ```
   $err = "Error: build failed`nAWS_SECRET_ACCESS_KEY=CANARY-wJalrXUtnFEMIK7MDENG`n  at Object.<anonymous> (/app/build.js:1:1)"
   $req2 = @{
     id = "2"
     command = "artifact.applyBuildFix"
     args = @{
       cwd = $p3
       filePath = "auth.ts"
       fixedFile = (Get-Content "$p3\auth.ts" -Raw) + "`nexport const fixed = 1;`n"
       buildError = $err
       remote = "smoke"
       id = "smoke-plugin"
     }
   } | ConvertTo-Json -Depth 6 -Compress
   $req2 | & "$repo\node_modules\.bin\tsx.cmd" "$repo\src\sidecar.ts"
   Select-String -Path "$p3\.deliveryos\*.jsonl" -Pattern "CANARY" -SimpleMatch
   Get-Content "$p3\.deliveryos\build-fix-log.jsonl" -Raw
   ```
   Same two assertions: the sweep prints nothing, and `buildError` still reads
   `Error: build failed` / `AWS_SECRET_ACCESS_KEY=[redacted]` / `at
   Object.<anonymous> (/app/build.js:1:1)` — **redacted, not shortened**. The
   Activity panel shows this string verbatim for every ordinary build failure;
   truncating it would change what every one of those looks like.
7. The third log, `design-fix-log.jsonl`, is written by the scan/design-fix
   flow (`applyAntiPatternFix`), which re-compiles a candidate's live preview
   and so needs a real `ui-component` payload — drive it from the desktop app's
   Scan view rather than scripting it. The assertion is identical: plant a
   canary in the candidate's own source file, apply a fix, then
   `Select-String` the `.jsonl`.

**Known limits — state these honestly, they are not test failures.** This is a
heuristic keyed on the name a value is assigned to, not a secret scanner:

- `export const authSecret = "hunter2"` (camelCase) **passes through
  unredacted**. The key regex requires a word boundary or `_` before the
  sensitive word, so `AUTH_SECRET` and `auth_secret` match and `authSecret`
  does not.
- A connection string under a key the list doesn't know is untouched:
  `DATABASE_PASSWORD=postgres://user:pw@host/db` redacts, but
  `DATABASE_URL=postgres://user:pw@host/db` does not — there is no plain `url`
  entry in `SENSITIVE_KEY`, only `webhook_url`.
- There is a fourth log, `wiring-placement-log.jsonl`, which is **not** run
  through the redactor. It stores no file bodies (only paths and a reasoning
  string), so the `before`/`after` leak doesn't apply to it — but its
  `rebuildOutput` is appended raw, unlike the redacted `rebuildOutput` in the
  other three. A failing build's env dump lands there verbatim.

## Cleanup

```
Set-Location $env:USERPROFILE
Remove-Item -Recurse -Force $smoke
Remove-Item Env:\DELIVERYOS_HOME
```

Nothing above ever touched your real `~/.deliveryos`, so there are no remotes
to unregister — but if you skipped the `DELIVERYOS_HOME` line in the
prerequisites, undo it now with `dos remote remove smoke` and
`dos remote remove deny`.
