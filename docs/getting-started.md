# Getting started — ten minutes, Windows

For an engineer at GrowthArc who wants to pull something from the catalog and,
later, send a fix back. Nothing here needs a clone of this repository.

**Time yourself.** The product brief claims "eleven minutes, not two days" and
nobody has measured it on a colleague's machine yet. However long this takes
you, tell us — that number goes on this page.

## 1. Install

Download `deliveryos_<version>_x64-setup.exe` from the
[latest release](https://github.com/ashwin-growtharc/DeliveryOS/releases/latest)
and run it. Per-user install, no admin rights. It installs the desktop app and
puts the `deliveryos` command on your PATH.

Then **open a new terminal** — the one you already had open does not see the
new PATH — and check:

```
deliveryos --version
```

If that says the command is not found, stop and tell us. The PATH step is the
one part of the installer that has not been verified on a machine other than
the author's, and "it didn't work" from you is the most useful thing this page
can produce.

You also need `git` on PATH (`git --version`). Nothing else.

## 2. Add the catalog

```
deliveryos remote add https://github.com/ashwin-growtharc/growtharc-ai-helpers.git --name ai-helpers
deliveryos list
```

A fresh install has no sources, so `list` is empty until you add one. The
catalog is about 230 artifacts — Claude Code agents, skills, rules and
commands, plus a handful of templates and backend plugins.

## 3. Pull one

From inside a project directory:

```
deliveryos pull code-reviewer
```

The files land where the artifact says they should (`.claude/agents/` for an
agent), a pristine copy is kept so your edits can be told apart from the
original, and the project's `deliveryos.lock` records what you have.

## 4. Let Claude Code see the catalog

```
claude mcp add deliveryos -- deliveryos mcp
```

Now the agent working in your project can ask what already exists before
writing something new — search, read a skill's text, see what a pull would run.
It cannot install anything; that stays a command you run. Nine tools, five of
them read-only; the [MCP server doc](mcp-server.md) says what each writes.

Point the config at the installed `deliveryos` binary as above, not at
`npx tsx src/index.ts` — that form is for people working on this repository and
costs about four seconds per session start.

## 5. Send a fix back

Edit the pulled file. Then:

```
deliveryos push code-reviewer
```

That opens a real pull request on the catalog's repository, with a description
written for you. Someone reviews it the normal way. Once it merges, the next
person to pull gets your fix.

`push` publishes the whole installed folder, so do not push an artifact you have
filled with real client details — the templates in this catalog say so in their
own READMEs, and the MCP server refuses to contribute without showing you the
file list first.

## When something goes wrong

Open an issue with `deliveryos --version` and the exact command you ran. The
[issue template](https://github.com/ashwin-growtharc/DeliveryOS/issues/new?template=bug.md)
asks for nothing else.

## What this page does not cover

The desktop app (installed alongside — open it if you prefer clicking to
typing; same engine) and building from source
([REQUIREMENTS.md](../REQUIREMENTS.md)).
