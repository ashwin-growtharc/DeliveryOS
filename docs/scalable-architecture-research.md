# DeliveryOS — Scalable Architecture (Research + Target Design)

**Status:** brainstorm / research, not yet planned into phases — same tier
as [product-roadmap-vision.md](product-roadmap-vision.md), but this doc is
about the *system*, not the *product surface*: what has to change under the
hood for org/team/project/"everything else" to actually hold up, grounded
in what real, adjacent systems already learned. **Related:**
[ARCHITECTURE.md](../ARCHITECTURE.md) (today's design, §9 open risks),
[product-roadmap-vision.md](product-roadmap-vision.md) (what to build),
this doc (how it has to be built to actually scale).

## 1. Why today's architecture is "very generic" — concretely, not vaguely

Checked directly against the current code rather than assumed:

- **No manifest index.** `discoverManifests` ([parser.ts:18](../src/engine/manifest/parser.ts)) walks every artifact folder and re-parses+re-validates every `manifest.yaml` on disk, and `buildCatalog` ([catalog.ts:19](../src/engine/catalog/catalog.ts)) reruns this full walk for *every remote* on *every single* `list`/Browse call — no memoization, no persisted index. Fine at today's real scale; it is a straight-line cost that grows with total artifacts across every remote, not with what's actually being searched for.
- **Full clone per remote, sequential hard-reset on refresh.** `remote add` does a full `simpleGit().clone()` with no `--depth`/`--filter` ([git.ts:10](../src/engine/git/git.ts)); `refreshCatalog` then does `fetch` + `reset --hard` per remote, one at a time ([catalog.ts:50](../src/engine/catalog/catalog.ts)). Multi-remote support is still an open, unchecked Phase 4 item ([PLAN.md](../PLAN.md)) — this path has real scale to prove.
- **Real scale so far: one remote at 210 artifacts, two remotes total, ever.** ([CHANGELOG.md](../CHANGELOG.md) — `growtharc-ai-helpers` at 210 artifacts; `arc_os`'s `catalog/` from Phase 2). Every design decision below is sized against "what happens past that," not against a hypothetical.
- **Lockfile has no concurrency control.** `upsertEntry` ([lockfile.ts:39](../src/engine/lockfile/lockfile.ts)) is an unlocked read-modify-write — a real race already exists today between the 20-minute background auto-sync tick and any concurrent manual action on the same machine, independent of any org rollout.
- **No security/provenance model** (ARCHITECTURE.md §9 risk #2) and **no org/team/project entities** — `owner` is a free string, `tags.roles/teams` are free-form arrays with nothing backing them, ids are flat global strings with no namespace.

None of this was wrong for a single-developer POC — it's exactly what "prove the loop first" should look like. It's the wrong shape for "org, project, everything else," which is the actual ask here.

## 2. Prior art — what four adjacent systems already solved

### Backstage (Spotify's internal software catalog/developer portal)

Entities use a `apiVersion` / `kind` / `metadata` / `spec` shape — DeliveryOS's own manifest already independently arrived at almost this exact shape. Two things Backstage does that DeliveryOS doesn't yet:

- **`apiVersion` lets the schema evolve** (`v1alpha1` → `v1beta1` → `v1`) without ever needing a breaking migration on every existing manifest.
- **`owner` resolves to a real Group/User entity**, not a free string — ownership is a first-class relationship (`ownedBy`), not a tag.
- The catalog itself is a **separately indexed, ingested database** — the portal never live-reads git on every request; a processing pipeline ingests entity files into an index that Browse/search actually queries.

### Sigstore / SLSA (software supply chain security)

Cosign provides free, **keyless signing** using short-lived certificates tied to a CI job's own OIDC identity (via Fulcio), logged to a public transparency log (Rekor). A SLSA provenance attestation (in-toto format) records builder identity, source commit, build parameters, and output digest. Together: the signature proves the artifact wasn't modified after the fact, the provenance proves *how* it was built and by what.

### OCI / Helm registries

Modern registries store immutable **content-addressed digests** (SHA256) alongside a human-readable semver, and unify heterogeneous artifact types (container images, Helm charts) behind one registry, one auth mechanism, one versioning story.

### Multi-tenant SaaS RBAC (industry-standard pattern, not one specific product)

The consistent shape across real implementations: **Actor** (user + tenant/org context) → **Action** → **Resource** (tenant-scoped), with roles and permissions scoped to a tenant rather than global, and a real org → team → project hierarchy backing access decisions rather than flat tags.

### OPA / policy-as-code

Policy lives as its own versioned artifact (a `.rego` file), reviewed and rolled back through the same git workflow as application code, evaluated by a generic engine rather than hardcoded into application logic — used in practice for exactly the kind of "does this need extra approval" gating DeliveryOS will need more of as kinds multiply.

### A cautionary counter-example: VS Code's extension host

Worth naming because it directly touches Wave 4 of the product roadmap (an IDE surface). VS Code extensions **still run with no real permission system** — all extensions in a host process share memory and trust, years into the ecosystem's life; sandboxing proposals are still academic/research-stage, not shipped. This isn't a template to copy — it's confirmation that the three-tier wiring-agent scope model already sketched in the roadmap doc is a **more disciplined starting point** than what the most popular extensible-editor ecosystem in the world actually ships today.

## 3. Target architecture

### 3.1 Entity model — additive, not a rewrite

- Add `apiVersion` to the manifest schema now, while it costs nothing — every future schema change becomes additive/versioned instead of a breaking migration across every remote's every manifest.
- Let `owner` optionally resolve to a real Org/Team/User entity once org modeling exists (§3.5) — keep the free-string form valid as the default so this stays backward compatible.
- Add real relationships beyond flat tags: `dependsOn` (an artifact declares it needs another one — the actual mechanism bundles/recipes need) and `partOf` (groups artifacts into a named bundle entity).
- **Namespace ids** (`owner-scope/id`, the same shape as npm's `@scope/name`) instead of flat global strings — today's flat-id collision-detection-on-propose is a stopgap that gets strictly worse with every new remote; namespacing removes the collision risk structurally instead of catching it after the fact.

### 3.2 A real catalog index — the single highest-leverage change here

Replace "walk and re-parse every manifest on every `list` call" with a persisted, queryable index (this can start as plain SQLite — it doesn't need to be a hosted service to already be a huge win), built by an indexer that ingests manifests from each remote's local cache incrementally, not a full re-walk every time. Browse/search latency then scales with *query result size*, not total artifacts across every registered remote. Pair with **webhook-driven refresh** (a GitHub webhook on the owning remote) as the org-scale replacement for today's manual-refresh/20-minute-poll pattern, keeping the poll only as a fallback for remotes that can't register a webhook.

### 3.3 Security & provenance — closes ARCHITECTURE.md risk #2 with a real standard

At merge time (a GitHub Action on the *owning* remote — not something DeliveryOS's own engine runs), sign the artifact's payload with cosign using that repo's own GitHub Actions OIDC identity (keyless — no key management for any team to own) and publish the SLSA provenance attestation alongside `manifest.yaml`. Pull verifies the signature before writing any files; unsigned or tampered payloads are refused, not silently accepted. This is exactly the "security stops being theoretical" prerequisite the roadmap doc already flagged for the backend-plugin kind — now with a concrete, adoptable mechanism instead of an open question.

### 3.4 A policy layer — keeps `kind` open-ended even as gating rules multiply

Every new kind so far has added its own gating logic in the abstract (scrub-check for data-pipelines, mandatory extra review for backend-plugins, a different review UI entirely for cross-org kinds). Hardcoding each into the engine reintroduces exactly the per-kind special-casing this architecture has deliberately avoided (ARCHITECTURE.md §4.1's callout that `agent-asset` uses the same generic path as everything else, decided on purpose). Express these as declarative policy — OPA/Rego, or a smaller bespoke rule format if Rego is overkill for the actual complexity — evaluated generically against `{kind, tags, actor, context}`. A new rule ships as a reviewed policy-file PR, never an engine release.

### 3.5 Org/team/project as real entities — a shape ready for auth, not auth itself

Model the Actor → Action → Resource pattern now: **Actor** = `{user, current org/team/project context}`, **Action** = `{browse, pull, push, propose}`, **Resource** = an artifact tagged with owner/roles/teams. Org → team → project become real, queryable entities rather than free-form tag strings — buildable *before* real SSO exists, using the same self-declared/unverified identity PLAN.md's Phase 4 deferral note already said could be pulled forward. The payoff: when a real IdP eventually exists, it snaps onto an org/team/project shape that's already there, instead of retrofitting the whole tag system at the same time as standing up auth.

Deliberately **not** proposing per-tenant quota/throttling infrastructure — that solves noisy-neighbor problems in a customer-facing multi-tenant SaaS, which this isn't. Naming it as an explicit non-priority so it reads as a scope cut, not a gap.

### 3.6 Content-addressing — a verifiable pull

Alongside the existing semver `version`, record a content digest (SHA256 of the payload) in the manifest and lockfile. Pairs directly with 3.3: sign the digest, not just "whatever's on the branch right now" — a Pull becomes provably the thing that was actually reviewed, not just the thing currently sitting at a ref.

### 3.7 Lockfile concurrency — a today-sized bug, not a someday one

`upsertEntry`'s unlocked read-modify-write is a real, present-tense race between the background auto-sync tick and a concurrent manual action on the same machine — worth fixing (simple file locking, e.g. an OS-level advisory lock) on its own merits, independent of anything else in this document.

## 4. What this deliberately does not propose

- Hosted multi-tenant SaaS-grade quota/throttling — wrong scale for an internal tool (§3.5).
- A bespoke signing scheme — Sigstore already solved this; don't reinvent it (§3.3).
- A general plugin-sandboxing runtime for the IDE surface on day one — VS Code itself hasn't solved this after years; land the already-designed three-tier wiring-agent scope model first rather than chasing a harder, still-unsolved problem before anything needs it (§2, VS Code counter-example).

## 5. If two things get picked up first

Not a phase plan — but of everything above, two are cheap, high-leverage, and don't wait on any new artifact kind or product decision: **(1)** the lockfile locking fix — a real bug today, not a scale problem — and **(2)** the manifest catalog index — removing the linear-scan bottleneck before it's actually been hit (real scale today is already 210 artifacts in one remote alone).

## Sources

- [Descriptor Format of Catalog Entities — Backstage](https://backstage.io/docs/features/software-catalog/descriptor-format/)
- [Understanding the Backstage System Model — Roadie.io](https://roadie.io/blog/understanding-the-backstage-system-model/)
- [Extending the model — Backstage](https://backstage.io/docs/features/software-catalog/extending-the-model/)
- [How to Implement Supply Chain Security with Sigstore](https://oneuptime.com/blog/post/2026-01-25-sigstore-supply-chain-security/view)
- [Software Supply Chain Security Beyond SBOMs: Sigstore, SLSA, and Build Provenance — AquilaX](https://aquilax.ai/blog/supply-chain-artifact-signing-slsa)
- [Securing Artifacts: Keyless Signing with Sigstore and CI/MON — Cycode](https://cycode.com/blog/securing-artifacts-keyless-signing-with-sigstore-and-ci-mon/)
- [How to Design a Multi-Tenant SaaS Architecture — Clerk](https://clerk.com/blog/how-to-design-multitenant-saas-architecture)
- [How to design an RBAC model for multi-tenant SaaS — WorkOS](https://workos.com/blog/how-to-design-multi-tenant-rbac-saas)
- [Multi-Tenancy Architecture — GeeksforGeeks](https://www.geeksforgeeks.org/system-design/multi-tenancy-architecture-system-design/)
- [Classic Helm Repo vs OCI Helm Package — Medium](https://medium.com/@prayag-sangode/classic-helm-repo-vs-oci-helm-package-understanding-helm-chart-packaging-3ff54bb16b00)
- [OCI Registry Integration — Helm DeepWiki](https://deepwiki.com/helm/helm/6.2-oci-registry-integration)
- [What Is Open Policy Agent? — Orca Security](https://orca.security/resources/blog/what-is-open-policy-agent/)
- [Open Policy Agent official docs](https://www.openpolicyagent.org/docs)
- [How to Implement API Catalog — OneUptime](https://oneuptime.com/blog/post/2026-01-30-api-catalog/view)
- [Automated Security Framework for VS Code Extensions — NHSJS](https://nhsjs.com/2025/automated-security-framework-for-vs-code-extensions-risk-profiling-policy-generation-and-runtime-sandboxing/)
- [VS Code Extensions: Basic Concepts & Architecture — Medium](https://jessvint.medium.com/vs-code-extensions-basic-concepts-architecture-8c8f7069145c)
- [Activation Events — VS Code Extension API](https://code.visualstudio.com/api/references/activation-events)
