# DeliveryOS — what it is and who it's for

*The product in plain language. No code, no architecture.*

For the technical side, see [ARCHITECTURE.md](ARCHITECTURE.md) and
[PLAN.md](PLAN.md).

---

## 1. What we're trying to do

Every team builds its own useful stuff — AI agents, coding rules, starter
projects, login systems, design kits. Almost none of it gets shared. It sits on
someone's laptop, or in a Slack thread from March.

So the same work gets done four times. And on the rare occasion someone does
copy something, they have no way to send fixes back — so their copy drifts, the
original never improves, and eventually nobody trusts either one.

**The hard part was never taking a copy. It's giving one back.**

DeliveryOS is one shelf the whole org looks at, with two buttons:

- **Pull** — get a working copy, with any setup already run for you.
- **Push** — send your improvement back as a normal pull request.

A human always reviews it. Once it's merged, the next person who pulls gets
your fix for free, without doing anything.

It works the same way whether the thing is a two-line checklist or an entire
codebase. That's deliberate — one mechanism for everything worth reusing,
instead of a different tool per category.

**What it isn't:** a package manager (this is stuff you're meant to edit, not
depend on), a wiki (that stores descriptions of work; this stores the work), or
a new place to keep code (it all lives in normal git repos teams already own).

---

## 2. Who it's for

Five kinds of people touch this, and they want different things from it.

### The developer

Building something, already behind. Wants to not rewrite what already exists.

Two rules decide whether they ever use it:

- They'll look for something **only if searching beats writing it.** Thirty
  seconds, fine. Ten minutes reading someone's README to work out whether it
  fits, no — they'll write their own.
- They'll send a fix back **only if it takes under a minute.** They found the
  bug while doing something else.

That's why setup runs automatically, and why Push writes the pull request
description for them.

### The non-technical person

Handed a starter kit or an AI helper. May never have opened a terminal. Uses
the app, never the command line.

Wants the thing to just work, without a setup guide. And because improvements
go back as a normal pull request, **they can improve a real codebase without
knowing what git is.** That's a contributor the org didn't have before.

### The maintainer

Owns the thing being shared. Barely uses DeliveryOS at all.

They just get a normal pull request in a repo they already watch, and review it
their own way. We deliberately didn't build them a review queue — that would be
handing them a second job.

### The team lead

Wants four projects to do login the same way, and wants the good version to
win rather than everyone being creative separately.

Cares less about any single pull, and more about the drift not happening.

### Claude Code

Genuinely a user. There are skills that let an AI assistant check the catalog
*before* writing new code — so the assistant is often the first one to notice
that something already exists.

---

## 3. One small journey

**The developer.** Monday, new client app, needs email login — the kind that
sends you a six-digit code.

Normally that's most of two days.

| When | What happens |
|---|---|
| **Mon 9:12** | Searches "auth". Finds `email-code-auth` — owned by another team, already used in two projects. |
| **Mon 9:14** | Clicks Pull. Files land. It asks for the two values it needs in a plain form, creates the missing files, leaves existing ones alone, and re-runs the build to check nothing broke. |
| **Mon 9:23** | Back on the real work. **Eleven minutes, not two days.** |
| **Wed** | Finds a bug — the email breaks on addresses with a `+` in them. Two-line fix, made locally because they need it working now. |
| **Wed 4:40** | Clicks Push. A real pull request opens against the owning team's repo. Under a minute — which is the only reason it happened. |
| **Next week** | Merged. The next person to pull gets the fix and never hits the bug. |

**That last row is the whole product.** Everything above it is a nicer
copy-paste — useful, but not the point. The point is that the fourth team
needing email login gets something *better* than the first team had, instead of
the fourth slightly-worse copy of it.

Same journey for a non-technical person, minus the terminal. The difference is
the Push step: they just opened a professional code review on a real codebase,
which was closed to them entirely before.
