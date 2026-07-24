# DeliveryOS

Standalone, org-wide artifact-sharing platform. See [ARCHITECTURE.md](ARCHITECTURE.md)
for the full design (five-layer model, kinds, manifest schema, decisions, risks).
See [PLAN.md](PLAN.md) for the phase-by-phase task breakdown — start there for
"what do I actually build next."

**Status:** Phase 0 (Engine MVP) built — `remote add` / `list` / `pull` work
end to end against a git-backed remote, no auth, no UI yet. Phase 1 (push) is
next.

**Relationship to ArcOS:** standalone project, not an ArcOS extension. Physically
nested inside the `arc_os` folder for convenience only — its own git repo,
ignored by ArcOS's `.gitignore`, no code or dependency relationship. ArcOS's
`catalog/` becomes DeliveryOS's first registered remote (Phase 2), nothing more.

## CLI

```
npm install
npm run build

deliveryos remote add <git-url> [--name <name>]   # register a git-backed remote
deliveryos list [--remote <name>] [--json]         # list available artifacts
deliveryos pull <id> [--remote <name>]             # pull an artifact locally
```

Each remote is a plain git repo with one manifest per artifact:

```
<remote root>/artifacts/<id>/manifest.yaml
<remote root>/artifacts/<id>/payload/...    # copied to install_target on pull
```

The remote registry/cache lives under `~/.deliveryos` (override with the
`DELIVERYOS_HOME` env var, e.g. for tests); the per-project lockfile lives at
`.deliveryos/lock.json` in whatever directory you run `pull` from.

## Development

```
npm run typecheck
npm run lint
npm test
```
