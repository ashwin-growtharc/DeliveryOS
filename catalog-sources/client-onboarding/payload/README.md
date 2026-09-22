# client-onboarding

A template for the document a new person on a client engagement reads in their
first week — filled in by interviewing the client rather than by guessing.

## What's in this pull

`client-onboarding.md` — the template. Its questions are declared at the top,
in the frontmatter, where an AI agent can read them.

## How to use it

Install the method alongside it, once per project:

```
deliveryos pull document-interview
deliveryos pull client-onboarding
```

Then, in whichever agent you use:

> Run the client-onboarding interview for Acme Corp.

It works through the nine questions, writes `ONBOARDING.md` into your project,
and tells you which sections it could not fill.

**Or fill it in by hand.** It is an ordinary markdown template with placeholders
and instructions, and it works perfectly well without an agent anywhere near
it. The interview is a convenience, not a requirement.

## Where the finished document goes

`ONBOARDING.md`, at the root of your project — **not** in this folder.

That is deliberate. This folder is tracked as an installed artifact, and
contributing an artifact sends it back to the shared library. A finished
onboarding document left here could be published with a real client's details
in it.

## What it asks about

The nine questions are the ones that actually cost a new joiner time, rather
than the ones that look tidy in a document:

- what the work is
- chat, documentation and code — **where people actually look**, not where
  things are supposed to live
- how access is granted on day one, including how long it really takes
- who decides, and who signs off
- how work gets from done to live
- which meetings we are expected at
- anything about this client that has already surprised us

That last one is the one people skip and the one that saves the next person a
week.

## Changing it

The questions are just a list at the top of the file. Edit it for your own
engagement, or copy the whole thing as the starting point for a different
document — a proposal, a delivery plan, a business case. Any template with an
`interview:` block works with the same method.
