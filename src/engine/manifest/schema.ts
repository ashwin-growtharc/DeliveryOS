import { z } from 'zod';

/**
 * One install-time value a `backend-plugin` artifact (or any future kind
 * that needs it) declares as required/optional at Pull time -- e.g. a
 * session-secret env var, a database URL, an ORM/table name. Distinct from
 * `post_install` (a single fixed shell command, unaware of values at all):
 * this is genuinely new plumbing for Phase 7's first real target (an
 * Auth.js + Prisma module), not an extension of `post_install` itself.
 *
 * `secret` marks a value that must never be defaulted or persisted into an
 * artifact's own manifest/pristine snapshot (a real session secret, a DB
 * password) -- the Detail/Pull UX collects the PROJECT's own value for
 * these, never the artifact's. The `.refine()` below makes "secret with a
 * default" a schema-level impossibility rather than a convention someone
 * could forget: a secret value already means "this shouldn't have a
 * knowable canned value baked in anywhere."
 */
export const InstallParamSchema = z
  .object({
    key: z.string().min(1),
    description: z.string().min(1),
    secret: z.boolean().default(false),
    required: z.boolean().default(true),
    default: z.string().optional(),
  })
  .refine((param) => !(param.secret && param.default !== undefined), {
    message: 'An install_param marked secret cannot also declare a default '
      + '-- the Detail/Pull UX must collect the project\'s own value, never '
      + 'the artifact\'s own.',
  });

export type InstallParam = z.infer<typeof InstallParamSchema>;

/**
 * One Tier-2 ("proposes, waits for confirmation") wiring step a
 * `backend-plugin` artifact declares -- a concrete, tailored suggestion for
 * editing a file at the INSTALLING project's own root (e.g. `auth.ts`,
 * `middleware.ts`), never something DeliveryOS auto-splices into a real
 * project's real source. `type` is kept explicit (even though
 * `suggest_snippet` is the only variant today) so a second variant can be
 * added later without breaking existing manifests -- the same additive
 * posture as every other field in this schema.
 *
 * Deliberately does NOT cover Tier 1 (see `install_params` -- `.env.example`
 * placeholders are derived from it directly, with no separate declared
 * action, since redeclaring the same keys a second time here would just be
 * a real drift risk for no benefit) or Tier 3 (a Prisma schema merge is
 * "DB schema/migrations" -- explicitly a NEVER-touch per the project's own
 * three-tier model, not a lesser form of Tier 2; it needs no mechanism here
 * at all, since the payload's own `.prisma` reference file and rendered
 * README already surface it passively).
 *
 * `whenAbsent`/`whenPresent` are split, not one `snippet` field, because a
 * single string can't honestly serve both "this file doesn't exist yet,
 * here's the full content to create" and "this file already exists, don't
 * blindly overwrite it." `whenPresent` is optional: omitting it means "this
 * already existing is itself the signal -- review before touching it,"
 * with no snippet offered at all (e.g. `auth.ts`/the API route, which this
 * artifact expects to own outright).
 */
const WiringSnippetVariant = z.object({
  instructions: z.string().min(1),
  // Absent when there's nothing safe to paste verbatim (a "this already
  // exists, go look at it yourself" case) -- required for `whenAbsent`
  // itself (a fresh file has nothing to conflict with, so there's always
  // something concrete to hand over), optional for `whenPresent`.
  snippet: z.string().optional(),
});

export const WiringActionSchema = z.object({
  type: z.literal('suggest_snippet'),
  description: z.string().min(1),
  // Resolved against the INSTALLING project's root (`cwd`), same as
  // `.env.local`/`.env.example` -- never `install_target`/payload-relative.
  // This is the one place a future implementer could easily copy the
  // wrong precedent from the rest of pull.ts (everything else there is
  // installTarget-relative); has its own dedicated test for this reason.
  targetFile: z.string().min(1),
  // `snippet` required here, unlike whenPresent below: a fresh file has
  // nothing to conflict with, so there's always something concrete to
  // hand over.
  whenAbsent: WiringSnippetVariant.required({ snippet: true }),
  whenPresent: WiringSnippetVariant.optional(),
});

export type WiringAction = z.infer<typeof WiringActionSchema>;

export const ManifestSchema = z.object({
  id: z.string().min(1),
  // Deliberately a plain string, not a closed enum: `kind` is an
  // open-ended vocabulary that new artifact authors can extend freely.
  kind: z.string().min(1),
  description: z.string().min(1),
  owner: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  refresh: z.string().optional(),
  tags: z
    .object({
      roles: z.array(z.string()).default([]),
      teams: z.array(z.string()).default([]),
      stacks: z.array(z.string()).default([]),
      // Free-form category values for `kind: "ui-component"` artifacts
      // (e.g. "button", "navbar", "card") -- same open-ended, free-text
      // shape as roles/teams/stacks, just a distinct tag dimension. Empty
      // for every other kind; never required, so this stays additive to
      // every existing artifact's manifest.
      componentTypes: z.array(z.string()).default([]),
    })
    .default({}),
  source_repo: z.string().min(1),
  install_target: z.string().min(1),
  // Optional escape hatch from the artifacts/<id>/payload/ convention: when
  // set, points directly at the artifact's real payload location, relative
  // to the remote's root (same relativity convention as install_target) --
  // may name a single file or a directory. This lets a remote register
  // already-existing, actively-maintained files (e.g. ArcOS's real catalog)
  // as a DeliveryOS artifact without duplicating them into a shadow copy
  // under artifacts/<id>/payload/. When absent, behavior is unchanged:
  // the payload resolves to artifacts/<id>/payload/.
  payload_path: z.string().optional(),
  review_required: z.boolean(),
  // Shell command run in install_target after the payload copy, if present.
  post_install: z.string().optional(),
  // Shell command run in install_target during `deliveryos remove`, before
  // any files are deleted, if present -- the symmetric teardown half of
  // post_install (e.g. stopping a local dev service post_install started).
  // Unlike post_install, a failing post_remove never blocks the removal
  // itself (see removeArtifact.ts's own doc comment for why) -- it's
  // reported, not fatal.
  post_remove: z.string().optional(),
  // Install-time parameters a Pull needs to collect from the installing
  // project before the artifact is meaningfully usable (Phase 7's first
  // real gap -- post_install alone has no concept of values at all).
  // Additive/defaulted like every other field here: absent entirely on
  // every manifest before Phase 7, and still perfectly valid absent on any
  // future manifest that simply doesn't need any (agent-asset, ui-component).
  install_params: z.array(InstallParamSchema).default([]),
  // sha256 content digest of the payload (PLAN.md Phase 7 / scalable-
  // architecture-research.md §3.6) -- what actually gets signed is this
  // digest, not "whatever's on the branch right now". Optional: only
  // present once an artifact has been through the (not yet built) signing
  // workflow on its owning remote.
  content_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
  // Cosign/SLSA-style provenance record (§3.3), written by a GitHub Action
  // on the artifact's OWNING remote at merge time -- never something
  // DeliveryOS's own engine produces itself. Optional for the same reason
  // as content_digest: absent until that workflow exists and has actually
  // run for a given artifact. `algorithm` is a literal (not a free string)
  // since Pull's eventual verification step needs to dispatch on it
  // explicitly, not guess from an arbitrary value.
  signature: z
    .object({
      algorithm: z.literal('cosign'),
      certificate_identity: z.string().min(1),
      oidc_issuer: z.string().min(1),
    })
    .optional(),
  // Tier-2 wiring steps (see WiringActionSchema's own doc comment) --
  // additive/defaulted like install_params, absent for every kind that
  // doesn't need one.
  wiring_actions: z.array(WiringActionSchema).default([]),
});

export type Manifest = z.infer<typeof ManifestSchema>;
