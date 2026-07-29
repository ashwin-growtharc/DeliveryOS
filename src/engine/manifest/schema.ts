import { z } from 'zod';

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
});

export type Manifest = z.infer<typeof ManifestSchema>;
