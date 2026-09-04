# Command registry — the proof, and why it is worth doing

**Status:** scoped, not started. This file exists so the *reason* survives the
week it was found in.

Every number below was measured against this repo on 2026-09-04, with the
command that produced it. Re-run them before trusting them; the point of
recording the command is that the claim stays checkable rather than becoming
folklore.

---

## The argument, in one line

The registry is not about catching misspelled RPC names. **It is about making
argument shapes comparable across surfaces**, which is the one kind of drift
none of our existing guards can see.

That distinction matters because the obvious version of this argument is
measurably false here.

---

## What does NOT drift, measured

Every RPC name the desktop UI sends is declared by the sidecar. Zero drift:

```bash
# 55 call sites, 40 distinct names
grep -cE "\bcall\(" src-tauri/spike-ui/app.js                        # 55
grep -oE "\bcall\('[a-zA-Z._]+'" src-tauri/spike-ui/app.js | sort -u | wc -l   # 40
grep -oE "'[a-z][a-zA-Z]*\.[a-zA-Z]+':" src/sidecar.ts | sort -u | wc -l       # 40

# names app.js uses that the sidecar does not declare:
comm -23 <(...app.js names...) <(...sidecar names...)                # empty
```

So a registry whose value proposition is "stop typos in RPC strings" would buy
**nothing today**. Worth stating plainly, because that is the version of the
pitch that comes to mind first, and it is the version the evidence refutes.

The bare strings are a real maintenance cost — 55 call sites in 7,605 untyped
lines — but they are not currently *wrong*.

---

## What DOES drift — the concrete evidence

`sync.applyUpdate` was declared on both surfaces. `src/capabilities.ts` checked
it and passed. Both declarations agreed the operation exists; both agreed it is
destructive, network-touching, project-scoped. **Every risk flag matched.**

And the two surfaces could not express the same request:

| surface | scope |
|---|---|
| sidecar `artifact.applyUpdate` | **requires** an id, updates exactly one |
| CLI `check-updates --apply` | had no id at all, updated **every** installed artifact |

Same engine function. `applyAvailableUpdates(cwd, onProgress?, onlyId?)` had
accepted `onlyId` the whole time — the sidecar passed it, the CLI never exposed
the parameter. So the capability existed, was implemented, was tested, and was
unreachable from the surface most people use.

**The manifest could not have caught it, and still cannot.** It compares
*whether* an operation exists and *how risky* it is. These declarations
disagreed about **granularity** — one scopeable, one not — and nothing compares
argument shapes. The guard checks that both surfaces declare the same operation
at the same risk. It cannot check that they can express the same *requests*.

That note now lives in `src/capabilities.ts`'s header beside the fixed entry,
so it is read where the guard is read rather than only here.

Fixed in `cli/scope-check-updates`. The fix is not the point; **the class is.**
Nothing we run today would have found it, and nothing we run today would find
the next one.

---

## Why schema-derived validation is the thing that closes it

Argument shapes are only comparable if they are *declared* somewhere a machine
can read. Today they are asserted imperatively, per call site:

```bash
grep -cE "assert[A-Z][a-zA-Z]*\(|requireString\(" src/sidecar.ts   # 73
grep -rcE "assert[A-Z][a-zA-Z]*\(|requireString\(" src/ --include=*.ts | \
  awk -F: '{s+=$2} END{print s}'                                    # 87
```

87 hand-rolled validation call sites, 73 of them in `sidecar.ts`, backed by two
local helpers (`requireString`, `requireProjectDir` at `sidecar.ts:112` and
`:133`). Imperative assertions validate; they do not *describe*. There is
nothing for a guard to compare one surface's shape against another's, which is
precisely why the granularity drift was invisible.

A schema per operation makes the shape a value. Then the anti-drift guard that
already exists for names and risk flags extends to arguments for free.

---

## Scope, and the long pole

- ~87 validation call sites across `src/`, concentrated in `sidecar.ts`
- **`src-tauri/spike-ui/app.js`: 7,605 untyped lines**, calling 40 distinct RPCs
  by bare string across 55 call sites

The second is the long pole and the open question. A registry that types the
TypeScript half while `app.js` keeps sending bare strings gets the smaller share
of the benefit, since `app.js` is one of the two surfaces the drift is between.

**Do not begin a full migration until the `app.js` typing question is
answered.**

## The proof

Start as a proof on **8 read-only operations**. Read-only bounds the blast
radius, and 8 is enough to show the shape without committing to the migration.

What the proof has to demonstrate — and this is the acceptance criterion, not a
nice-to-have:

> A granularity difference between two surfaces — same operation, same risk
> flags, different argument shapes — **fails a guard**.

If the proof does not demonstrate that, it has re-implemented the manifest with
more types and closed nothing. `check-updates` is the regression case: run the
guard against the pre-fix declarations and it must fail.

---

## Why this file exists at all

Rationales decay into *"we wanted types"* within a month, and then the work
looks like taste. The `check-updates` defect is the concrete evidence that
granularity drift is invisible to every guard we have and that it cost
something real — a capability that existed, worked, and could not be reached.

Evidence in a rationale outlives the argument that produced it. The argument is
already half-forgotten; the measurement is not.
