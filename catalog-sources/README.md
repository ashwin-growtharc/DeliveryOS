# catalog-sources

Artifacts authored here, before they are proposed to a catalog.

## Why this directory exists

An artifact only becomes usable once it is in a catalog repository — that is
where `deliveryos pull` reads from. But a catalog is a shared remote, and
pushing to one opens a pull request against somebody else's repo.

So artifacts get written here first: version-controlled, reviewable in an
ordinary pull request against *this* repo, and testable locally by registering
this directory as a remote. Proposing them to a real catalog is a separate,
deliberate step.

Not to be confused with:

- **`examples/`** — consumer projects used to test pulling *into* something.
  `backend-plugin-demo` is a real Next.js app, not an artifact.
- **`.claude/skills/`** — skills for working on DeliveryOS itself. Those are
  never distributed.

## Layout

Each artifact is a directory named for its id, containing the payload exactly
as it should land in a catalog:

```
catalog-sources/
  <id>/
    manifest.yaml      what the catalog needs to know about it
    payload/           what a person actually receives
```

## Proposing one to a catalog

```
deliveryos push <id> --new \
  --path catalog-sources/<id>/payload \
  --kind <kind> --owner <you> --description "..." \
  --remote <catalog>
```

That opens a pull request. Nothing here reaches a shared catalog on its own.
