# document-interview

The method for turning a document template into a finished document by
interviewing the person who knows the answers.

## What's in this pull

`SKILL.md` — instructions for an AI agent. It is plain markdown on purpose, so
it works with whatever agent you already use rather than only one of them.

## What it is for

We hand clients a lot of documents where the *structure* is always ours and
only the *answers* change: onboarding notes, proposals, delivery plans,
business cases, scoping notes. Each one starts from a blank page today.

This is the half that never changes. The questions live in each template, so
adding a new kind of document means writing one more template — no code, no
release, nobody's help.

## Using it

Install this once per project, then install whichever template you need:

```
deliveryos pull document-interview
deliveryos pull client-onboarding
```

Then, in whichever agent you use:

> Run the client-onboarding interview for Acme Corp.

It asks its way through the template's questions, writes the finished document
into your project, and tells you what it could not fill in.

## Two things it will not do, deliberately

**It will not invent an answer.** Anything the client did not know is written
as `Not established` rather than filled with something plausible. A proposal
with a confidently wrong number in it is worse than one with a visible gap.

**It will not write the finished document into the template's own folder.**
That folder is tracked as an installed artifact, and contributing an artifact
sends it back to a shared library — so a finished document left there could be
published with a real client's details in it. The finished document goes in
your project, where it belongs, and stays there.

## Writing a new template

Any markdown file with an `interview:` block in its frontmatter works:

```yaml
---
document: Delivery plan
output: DELIVERY-PLAN.md
interview:
  - ask: What is the first milestone, and when?
  - ask: Who signs off on it?
    options: [Client sponsor, Delivery lead, Both]
---
```

`options` are a prompt rather than a menu — an answer that is not on the list
is recorded as given. Anything without an `interview:` block is just an
ordinary template somebody fills in by hand, which is also fine.
