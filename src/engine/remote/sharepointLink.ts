/**
 * Reads what a SharePoint or OneDrive link says about itself, using nothing but
 * the URL text.
 *
 * WHY THIS EXISTS
 *
 * A client hands over a link, and DeliveryOS's answer used to be the same
 * sentence for every one of them: "point at the synced folder instead". That
 * advice is right for a link to a document library and actively wrong for a
 * link to a single document -- there is no folder to point at, because one file
 * is not a catalog no matter where it lands.
 *
 * Telling those apart needs no network call and no sign-in. Microsoft's sharing
 * links carry a type marker in the first path segment, and the browser form
 * carries the file's own name in a query parameter. Both are plain text.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not fetch anything, and it is not a step towards fetching anything.
 * Reading the bytes behind one of these links requires an authenticated
 * Microsoft Graph call -- verified: the Shares API "always requires
 * authentication and can't be used to access anonymously shared content without
 * a user context". This is here to make a refusal specific, not to soften it.
 */

/** What the link points at. `unknown` is a real answer and is used whenever the
 * marker is missing or is one this does not recognise -- guessing "file"
 * because most links are files would produce confident wrong advice. */
export type SharepointTargetKind = 'folder' | 'file' | 'unknown';

export interface SharepointLink {
  service: 'SharePoint' | 'OneDrive';
  /** True for `<tenant>-my.sharepoint.com`, which is a person's own OneDrive
   * rather than a team site. The distinction changes the advice: a team library
   * is synced, someone else's OneDrive is added as a shortcut. */
  personal: boolean;
  kind: SharepointTargetKind;
  /** The application named by the marker, when it names one. Absent for markers
   * that only say "a file" without saying which kind. */
  app?: string;
  /** The file's name, when the URL carries it in the clear. The short sharing
   * form does not, so this is frequently absent even for a definite file. */
  fileName?: string;
  /** The owner's folder segment of a personal link, VERBATIM.
   *
   * Not converted back into an email address, though it looks like it could be:
   * the mangling replaces both `@` and `.` with `_`, so
   * `vaishak_bhuvan_growtharc_com` could reverse to
   * `vaishak.bhuvan@growtharc.com` or `vaishak@bhuvan.growtharc.com` and
   * nothing in the URL says which. A person reading it recognises the name
   * immediately, which is all this is for. */
  ownerSegment?: string;
  /** `/sites/<name>` or `/teams/<name>` for a team-site link. */
  sitePath?: string;
}

/**
 * The type markers Microsoft puts in the first path segment of a sharing link.
 *
 * `folder` is the one that matters most, because it is the only shape that can
 * become a catalog. The rest are recorded so the refusal can name what the
 * person is actually holding.
 *
 * Anything absent from this table falls through to `unknown` rather than being
 * treated as a file.
 */
const MARKERS: Record<string, { kind: SharepointTargetKind; app?: string }> = {
  f: { kind: 'folder' },
  w: { kind: 'file', app: 'Word document' },
  x: { kind: 'file', app: 'Excel workbook' },
  p: { kind: 'file', app: 'PowerPoint presentation' },
  o: { kind: 'file', app: 'OneNote notebook' },
  t: { kind: 'file', app: 'text file' },
  i: { kind: 'file', app: 'image' },
  v: { kind: 'file', app: 'video' },
  // `b` and `u` mean "a file" without saying which kind -- a PDF, or something
  // Office has no viewer for. Deliberately no `app`.
  b: { kind: 'file' },
  u: { kind: 'file' },
};

/** Hostnames this understands. `.sharepoint.com` covers both a tenant's team
 * sites and its `-my` OneDrive host, which are the same product family and the
 * same URL grammar. */
export function isSharepointHost(host: string): boolean {
  const lower = host.toLowerCase();
  return lower === 'sharepoint.com' || lower.endsWith('.sharepoint.com');
}

/**
 * Everything the link says about itself, or `undefined` if the host is not
 * SharePoint at all.
 *
 * Never throws: a malformed link is a link whose fields are absent, and the
 * caller's advice degrades to the general case rather than to an error.
 */
export function parseSharepointLink(url: string): SharepointLink | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }

  const host = parsed.hostname.toLowerCase();
  if (!isSharepointHost(host)) return undefined;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const personal = host.includes('-my.');

  // The marker is `:x:` -- with the colons. They matter: the very next segment
  // of a personal short link is a bare `p` (for "personal"), and without
  // requiring the colons that would parse as the PowerPoint marker.
  const marker = segments[0]?.match(/^:([a-z]):$/i)?.[1]?.toLowerCase();
  const resolved = marker ? MARKERS[marker] : undefined;

  // The browser form carries the real name. `_layouts/15/Doc.aspx?file=...` is
  // what you get from "Copy link" while the document is open, and it is the
  // shape people paste most often.
  const fileName = parsed.searchParams.get('file')?.trim() || undefined;

  const ownerIndex = segments.findIndex((s) => s.toLowerCase() === 'personal');
  const ownerSegment = ownerIndex >= 0
    ? segments[ownerIndex + 1]
    // The short form `/:w:/p/<alias>/<token>` puts the alias straight after the
    // routing segment instead.
    : (segments[1]?.toLowerCase() === 'p' ? segments[2] : undefined);

  const siteIndex = segments.findIndex((s) => s.toLowerCase() === 'sites' || s.toLowerCase() === 'teams');
  const sitePath = siteIndex >= 0 && segments[siteIndex + 1]
    ? `/${segments[siteIndex].toLowerCase()}/${segments[siteIndex + 1]}`
    : undefined;

  return {
    service: personal ? 'OneDrive' : 'SharePoint',
    personal,
    // A filename in the query is positive evidence of a file even when the
    // marker is missing or unrecognised.
    kind: resolved?.kind ?? (fileName ? 'file' : 'unknown'),
    ...(resolved?.app ? { app: resolved.app } : {}),
    ...(fileName ? { fileName } : {}),
    ...(ownerSegment ? { ownerSegment } : {}),
    ...(sitePath ? { sitePath } : {}),
  };
}
