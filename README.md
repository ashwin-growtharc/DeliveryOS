# DeliveryOS

Standalone, org-wide artifact-sharing platform. See [ARCHITECTURE.md](ARCHITECTURE.md)
for the full design (five-layer model, kinds, manifest schema, decisions, risks).
See [PLAN.md](PLAN.md) for the phase-by-phase task breakdown — start there for
"what do I actually build next."

**Status:** planning. Nothing built yet. Phase 0 is next.

**Relationship to ArcOS:** standalone project, not an ArcOS extension. Physically
nested inside the `arc_os` folder for convenience only — its own git repo,
ignored by ArcOS's `.gitignore`, no code or dependency relationship. ArcOS's
`catalog/` becomes DeliveryOS's first registered remote (Phase 2), nothing more.
