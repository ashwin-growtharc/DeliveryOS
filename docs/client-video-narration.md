# DeliveryOS — client video narration

A short, spoken-narration script for a screen-recorded video walkthrough —
distinct from [demo-script.md](demo-script.md) (a detailed live-presenter run
sheet with real registered remotes/artifacts and reset steps) and
[demo-guide.md](demo-guide.md) (the plain-English pitch write-up). Use those
two if you're presenting live or want the fully verified, specific-artifact
version; use this one to actually read from while recording a quick video.

You're already inside the app when you start recording — bracketed lines are
what to click/show, not things to say out loud.

---

## 1. Greeting (~15 sec)

> Hey — thanks for taking the time. I want to show you something we've been
> building called DeliveryOS. It's a small tool, but it solves a problem
> every team our size eventually runs into. Let me just walk you through it
> live rather than talk in the abstract.

---

## 2. Overview — the core concept (~45 sec)

> Here's the problem: every team ends up building its own pile of internal
> stuff — AI agents, prompt templates, coding rules, starter projects — and
> none of it is shared. Someone on one team writes a great "code reviewer"
> agent, and three other teams go build their own slightly-worse version of
> the same thing next month, because there's no easy way to find and reuse
> what already exists.
>
> DeliveryOS is built around one idea: **reusability**. Every one of these
> things — an agent, a skill, a rule, a template, a whole starter project —
> is just a folder in a normal git repo, with a little manifest describing
> what it is. DeliveryOS lets anyone **browse** what's already out there,
> **pull** it straight into their own project, and just as easily **propose
> improvements back** — as a real GitHub pull request, so nothing happens
> silently. It's git, doing what git's good at, with a UI on top that makes
> "find and reuse" as easy as "search and click."

[Switch to the app, land on **Browse**]

---

## 3. Walkthrough (~2–3 min)

### Browse

> This is the home view — every artifact available from wherever your team
> keeps its shared repo. Each card tells you what it is, who owns it, and
> whether you've already got it pulled locally.

[Point at a couple of cards, show the status badges — Not pulled / Pulled / Update available]

> You can filter by kind — agents, skills, commands, rules, templates — or
> just search by name.

[Type something in the search box, click a Kind tab]

### Browse by tag

[Click **Browse by tag**]

> If you don't know the exact name of what you want, you can browse by
> what it's tagged with instead — stack, role, project. Say I only care
> about Python tooling —

[Click into a stack value, show the filtered results grouped by kind]

> — that's every Python-relevant artifact across every kind, in one place.

### Pulling something

[Go back to Browse, pick an artifact, click Pull]

> Pulling something is one click. DeliveryOS clones it straight into your
> project at whatever path the artifact defines, runs any setup step it
> needs —

[Point at the live progress log as it runs]

> — and from then on, your lockfile tracks it, so if the artifact gets
> updated upstream, you'll see that here as "Update available" next time
> you pull.

### Proposing something new

[Click **Add New**]

> And this is the other half of it — if YOUR team builds something worth
> sharing, you don't need repo access or a manual PR process. Fill this
> out —

[Step through a field or two of the wizard]

> — kind, description, a few tags, point it at the files — and DeliveryOS
> opens a real pull request against the shared repo for someone to review.
> Nothing gets merged silently; it's a normal PR, same as any other code
> change.

### Settings

[Click **Settings**]

> And this is just remote management — which git repos DeliveryOS is
> pulling from. A team can point this at more than one shared repo if they
> need to.

---

## 4. Closing (~15 sec)

> That's really the whole loop: browse what exists, pull what you need,
> push back what's worth sharing — all through normal git, all through
> real PRs, no new process for anyone to learn. Happy to dig into any part
> of this deeper, or talk about what it'd take to point this at your own
> repo.

---

**Total runtime: ~4–5 minutes.** Trim the Walkthrough section first if you
need it shorter — Browse + Pull + Add New are the three moments that
actually sell it; Browse-by-tag and Settings are the first things to cut.
