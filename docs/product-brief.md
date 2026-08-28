# DeliveryOS — product brief

*The product lens: what we're trying to do, who for, and what one day of using
it actually looks like. For anyone who needs to understand DeliveryOS without
reading a line of code.*

The technical counterparts are [ARCHITECTURE.md](../ARCHITECTURE.md) (how it's
built) and [PLAN.md](../PLAN.md) (what's shipped and what's next). This document
deliberately contains no implementation detail.

---

## 1. What are we trying to do

**The problem.** Every team builds its own pile of internal reusable things —
AI agents and skills, coding rules, starter projects, design systems, whole
backend features like email login. Almost none of it is shared. It lives on
one person's laptop or three levels deep in a Slack thread.

So the same work gets done repeatedly. One engineer writes a good code-reviewer
agent; three other teams build their own slightly worse version over the next
quarter, because there was no way to find out the first one existed. And where
something *is* copied, the copy immediately starts drifting — the person who
took it has no way to send a fix back, so the original never improves and the
two versions diverge until neither is trusted.

**The insight.** Reuse doesn't fail because taking a copy is hard. It fails
because *giving something back* is hard. A copy-paste is a dead end: the moment
you improve it, your improvement is stranded in your project.

**What we're building.** One shelf the whole org looks at, with two buttons.

- **Pull** — take a working copy into your project, with any setup it needs
  already run for you.
- **Push** — send an improvement back as a real pull request against whoever
  owns it.

Nothing merges silently; a human always reviews. Once merged, the next person
who pulls gets your fix automatically, without doing anything.

The scope is deliberately indifferent to *what* is being shared. A two-line
checklist, an AI agent, a design system, and an entire codebase all move
through the same two buttons. That's the point — it means one mechanism covers
the whole long tail of "things worth reusing" rather than a tool per category.

**What it is not.** Not a package manager (these are things you're meant to
edit, not depend on). Not a wiki (a wiki holds descriptions of work; this holds
the work). Not a new place to store code — everything lives in ordinary git
repos that teams already own.

---

## 2. Who is our user persona

Two types of person use this, and they want opposite things from it. Designing
for one without the other breaks it.

### Type 1 — The developer

Ships client projects on a schedule. Comfortable with git. Usually starting
something new, usually behind.

| | |
|---|---|
| **Wants** | To not write something that already exists somewhere in the org |
| **Doesn't want** | To become the person who curates a reusable-component library |
| **Today** | Asks in Slack, gets no answer in ten minutes, writes their own |

Two thresholds decide whether this person uses the product at all:

- They reuse something **only if finding it is faster than writing it.** Thirty
  seconds of searching is fine. Ten minutes of reading someone else's README to
  work out whether it fits is not — they'll just write it themselves.
- They contribute a fix back **only if it costs them almost nothing.** They
  found the bug while doing something else. If sending it back means forking an
  unfamiliar repo, learning its conventions and writing up a description, they
  fix it locally and move on. Every time.

That's why setup runs automatically on pull, and why push writes the pull
request description for them.

### Type 2 — The non-technical person

Handed a starter kit or an AI helper. May never have opened a terminal. Uses
the desktop app, never the command line.

| | |
|---|---|
| **Wants** | A working copy of the thing, without a setup guide |
| **Doesn't want** | To find out they need git, Node, or a walkthrough first |
| **Today** | Waits for someone technical to have time for them |

The thing this type unlocks is worth stating plainly: because improvements go
back as a normal pull request, **this person can suggest a fix to a real
codebase without knowing what git is.** They click one button; a developer on
the owning team sees an ordinary PR. That's a contributor the org didn't have
before.

### And the person on the other end

Whoever owns the thing being shared. They barely use DeliveryOS — they just
receive a normal pull request in a repo they already watch, reviewed under
their own existing rules. Deliberately so: giving them a review queue of their
own would mean adding a person's job to the product.

---

## 3. One small user journey

Following **Type 1, the developer.** They start a new client app on Monday. It
needs email login — the kind where you get a six-digit code in your inbox.

Without DeliveryOS that's most of two days: pick a library, wire it up, build
the code-sending part, get the environment variables right, and find out on
Tuesday what they got wrong.

**Monday, 9:12am — they look first.**
They open DeliveryOS and type "auth". `email-code-auth` comes up, owned by
another team, already used in two other projects. They can see what it installs
and what it will need from them before committing to anything.

**9:14am — they pull it.**
The files land in their project. It asks for the two values it needs — a secret
and a URL — in a plain form rather than a config file to hand-edit, and writes
them where they belong. It creates the files that don't exist yet, leaves the
ones that do alone and says which those were, then re-runs the build to confirm
nothing broke.

**9:23am — back on the actual client work.** Eleven minutes, not two days.

**Wednesday — they find a bug.**
The code email mishandles addresses with a `+` in them. It's a two-line fix,
and they make it in their own project because they need it working now.

**Wednesday, 4:40pm — they send it back.**
One click on Push. DeliveryOS works out what changed against what was
originally pulled, writes the description, and opens a real pull request
against the owning team's repo. It took under a minute — which is the only
reason it happened at all.

**The following week — someone else pulls it.**
The owning team reviewed and merged the fix. The next person to pull
`email-code-auth` gets the corrected version and never hits the bug.

**That last step is the whole product.** Everything before it is a nicer way to
copy files — worth something, but not much. The reason to build this is that
the fourth team needing email login gets something *better* than the first team
had, instead of the fourth slightly-different copy of it.

### The same journey for Type 2

A non-technical person doing this never sees a terminal. Steps 1 and 2 are the
same clicks in the desktop app. The difference is the last one: when they hit
something wrong and click Push, they have just opened a professional code
review on a real codebase — something that was previously closed to them
entirely.

---

## Where this actually is today

Stated plainly, because a brief that oversells is worth less than no brief.

**Built and working:** the full loop above — browse, pull with setup and
configuration, edit, and push as a real GitHub pull request. Two ways in, a
command line and a desktop app. It runs against a real catalog of 234
artifacts.

**The open question is adoption, not capability.** Nearly every push recorded
so far has been the build team testing its own loop, not another engineer
solving their own problem. Getting one engineer outside the build team through
a real pull-edit-push cycle on work they'd have done anyway is the single
highest-priority item on the plan, ahead of any new feature. Until that happens
once, the value described here is a well-founded expectation rather than a
demonstrated result.

**Not yet built:** usage tracking, so "is this working" can be answered with a
number instead of an impression.
