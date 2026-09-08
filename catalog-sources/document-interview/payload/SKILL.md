---
name: document-interview
description: Interview someone and fill in a document template from their answers. Use when a template declares questions in its frontmatter and the document needs writing for a specific client, project or engagement -- onboarding notes, a proposal, a delivery plan, a business case.
---

# Document interview

You are filling in a document by talking to the person who knows the answers,
then writing the finished document to their project.

Everything specific to a particular document lives in the template. This file
is only the method, so that fixing the method fixes it everywhere rather than
in twenty copies.

## When to use this

A template is present and declares an `interview:` block. The person wants the
finished document, not the blank one.

If the template has no `interview:` block, it is an ordinary template — hand it
over and say so. Do not invent questions for it.

## Two rules that override anything else in this file

**1. Never invent an answer.** If the person does not know, the document says
so. A proposal with a confidently wrong budget in it is worse than one with a
gap, because a gap gets asked about and a wrong number gets approved. Write
`Not established` and move on.

**2. Write the finished document into the project, never into the template's
own folder.** DeliveryOS keeps a private copy of every artifact it installs so
it can tell when you have edited one, and contributing sends your edits back to
a shared library. A finished document left in the template's folder reads as an
edit, and could be published to a shared repository with a real client's
details in it. Nothing prevents this automatically. That is why the rule is
here.

## How to run it

### Step 1 — find the template and read its questions

Look for a markdown file with an `interview:` block in its frontmatter. It will
look like this:

```yaml
---
document: Client onboarding
output: ONBOARDING.md
interview:
  - ask: What does the team use for chat?
    options: [Slack, Microsoft Teams, Google Chat]
  - ask: Where does documentation live?
---
```

`output` is where the finished document goes, relative to the project root.
If a template does not declare one, use the document name in title case with
spaces replaced by hyphens, at the project root.

### Step 2 — check whether it has been done before

If the output file already exists, read it first and treat this as an update
rather than a fresh start. Ask only about things that are missing, marked
`Not established`, or that the person says have changed. Do not re-ask what is
already answered and correct — that is the fastest way to make someone abandon
the interview.

Tell them what you found: *"There is already an ONBOARDING.md with six of the
eight sections filled in. I will ask about the two gaps."*

### Step 3 — ask, one question at a time

- **One question per turn.** A numbered list of eight questions gets one reply
  answering three of them.
- **Offer the options when the template lists them**, but accept anything. The
  options are a prompt, not a menu — if the answer is "Teams for most of it,
  Slack with one client", write that down, not "Microsoft Teams".
- **Follow up when an answer is thin.** The template cannot anticipate every
  useful follow-up; you are in the conversation and it is not. If someone says
  documentation lives in SharePoint, asking whether there is one place people
  actually start is worth a turn.
- **Accept "I don't know" immediately.** Ask who would know, if that is useful,
  and move on. Do not push.

### Step 4 — write the document

Fill the template's structure with what you were told. Then:

- Replace every unanswered placeholder with `Not established`. Do not leave the
  template's own example text in place — a document that still says
  `[client name]` looks unfinished; one that quietly kept an example from the
  template looks *wrong*, which is worse.
- Keep the person's own words where they said something specific. "You raise a
  ticket with IT and it takes about a day" is more useful than "Access is
  managed by IT".
- Do not add sections the template does not have.

### Step 5 — say what you did

Report three things, briefly:

- where the file was written
- how many sections were filled
- **what was left open**, by name

The last one matters most. It is the difference between a document someone can
finish and a document someone has to re-read to find the holes.

## What this skill does not do

- **It does not install or move anything.** If the template is not present,
  say which one is needed and let the person install it.
- **It does not push anything anywhere.** Contributing is a separate,
  deliberate act, and see rule 2 about why that matters here in particular.
- **It does not judge the answers.** If a client's process sounds unusual,
  write it down as described. You are recording how they work, not reviewing
  it.
