# DeliveryOS demo guide

*A plain-English walkthrough for showing DeliveryOS to anyone — technical or not.*

## What is DeliveryOS, in one sentence?

**It's an internal app store for the company's reusable stuff** — AI helpers,
starter code, checklists — except unlike a normal app store, if you improve
something you got, you can send that improvement back with one click, and
everyone who gets it next automatically receives your fix.

Think of it like this: today, if someone builds a great "code review"
AI helper or a solid starter website template, it lives on their laptop or
buried in a Slack thread. Someone else who needs it either doesn't know it
exists, or copies it by hand and it slowly goes stale. DeliveryOS is the shelf
where these things live, with one button to grab a copy and one button to
suggest a fix.

## The four things to demo

DeliveryOS doesn't care *what* kind of thing it's sharing — a small text file,
an AI assistant's instructions, or an entire software project all work the
same way. Four real examples to show this off:

| # | Name | What it actually is | Where it comes from |
|---|---|---|---|
| 1 | **code-reviewer** | An **agent** — a pre-written set of instructions that turns an AI assistant into an automatic code reviewer | ArcOS's real catalog |
| 2 | **engagement-kickoff** | A **skill** — a step-by-step checklist for kicking off a new client project | ArcOS's real catalog |
| 3 | **arcos-cli** | A **whole software project** — the entire ArcOS codebase, ready to develop on | A copy of the real ArcOS repo |
| 4 | **launchpad-template** | A **starter website kit** — the exact template Launchpad hands every new citizen developer | A copy of Launchpad's real starter kit |

Two of these (#1, #2) are small, single files. Two of these (#3, #4) are
entire folders of real, working code. DeliveryOS treats all four the exact
same way — that's the point of the demo.

## What happens when you click "Pull" — the simple version

No matter which of the four you pick, the same three things happen, in order:

1. **DeliveryOS copies the real files onto your computer**, into a folder you
   picked, exactly where they need to go.
2. **If the thing needs a one-time setup step, DeliveryOS runs it for you.**
   - `code-reviewer` and `engagement-kickoff` need nothing extra — they're
     just instructions, ready to use immediately.
   - `arcos-cli` needs one command (`pip install -e ".[dev]"`) so its command-line
     tool works. DeliveryOS runs that automatically.
   - `launchpad-template` needs one command (`npm install`) so the website's
     building blocks are downloaded. DeliveryOS runs that automatically too.
3. **DeliveryOS remembers what it just gave you**, so later it can tell you
   "this is already pulled" or "you've edited this since you got it."

You never type a command yourself. You click one button, and a few seconds
later, a fully working copy is sitting on your machine.

## What happens when you click "Push" — the simple version

This is the "send my improvement back" button. It only makes sense for
things you can meaningfully change one piece of — so it works for
`launchpad-template`, `code-reviewer`, and `engagement-kickoff`, but **not**
for `arcos-cli`, since that's an entire codebase, not a single tweakable file.

When you click Push:

1. DeliveryOS looks at what you changed on your computer versus what you
   started with.
2. It automatically writes up a description of your change (like a mini
   commit message) — you don't have to write one yourself.
3. It opens a **real GitHub Pull Request** — the exact same review process a
   professional developer would use, with a title, a description, and the
   actual diff of what changed.
4. Whoever owns that project reviews it under their own normal rules.
   Nothing merges automatically — a human always approves it.
5. Once approved and merged, the next person who clicks Pull for that same
   thing automatically gets your improvement. No extra work for them.

## Why this matters (the pitch, in one breath)

Today: reusable stuff is scattered across laptops and Slack, nobody knows
what's available, copies drift out of date, and only people who already know
git can contribute a fix.

With DeliveryOS: one place to look, one click to get a working copy (setup
included), and one click to propose an improvement — no git knowledge
required, and it works identically whether the "thing" is a two-line
checklist or an entire codebase.

## Suggested demo flow

1. **Open the app.** Show the empty Browse screen — nothing pulled yet.
2. **Add a source.** In Settings, register the demo's git repo (this is the
   one-time "where do things come from" step — a normal user would rarely
   touch this, since it'd usually be pre-configured for them).
3. **Browse.** Point out the four cards: two small ones (agent, skill), two
   big ones (whole codebases). Note the search box and filter chips.
4. **Pull the skill or agent first** — instant, no setup step, to show the
   simplest case.
5. **Pull `launchpad-template`** — narrate that `npm install` is running
   automatically in the background; when it's done, open the actual folder
   on disk to prove it's real, working files, not a placeholder.
6. **Pull `arcos-cli`** — same idea, bigger payload, narrate that a full dev
   environment just got set up with one click.
7. **Make a small edit** to the pulled template (e.g. change one line of
   text) and click **Push** — show the real GitHub Pull Request that opens.
   This is the "aha" moment: a non-technical person just opened a proper
   code review, without knowing what git is.
8. **Close the loop**: mention that once someone approves that PR, everyone
   else's next Pull automatically includes the fix.

## One honest caveat worth mentioning if asked

`arcos-cli` and `launchpad-template` are currently pulled from **copies**
of the real ArcOS and Launchpad projects (kept in a separate, safe practice
area), not the live projects themselves — so a real production rollout would
point these at the actual repos directly. The demo mechanics are 100% real;
only the source location is a stand-in for now.
