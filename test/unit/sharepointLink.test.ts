import { describe, it, expect } from 'vitest';
import { parseSharepointLink } from '../../src/engine/remote/sharepointLink';
import { classifyRemoteUrl } from '../../src/engine/remote/classifyRemoteUrl';

/**
 * Reading a SharePoint link well enough to give advice that is actually true
 * for the thing the person is holding.
 *
 * WHY THE URLS HERE ARE FABRICATED
 *
 * Every URL below is structurally identical to a real one and contains no real
 * value. That is deliberate rather than fussy: the short sharing form's opaque
 * segment IS the sharing token, so a real one committed here would put a live
 * grant to somebody's document in a git history forever. The browser form
 * carries a person's account name and a document GUID, which is milder and
 * still not ours to publish.
 *
 * The shapes were taken from real links, checked once at a console, and then
 * rewritten.
 */

const BROWSER_FORM =
  'https://contoso-my.sharepoint.com/:x:/r/personal/rina_patel_contoso_com/_layouts/15/'
  + 'Doc.aspx?sourcedoc=%7B00000000-1111-2222-3333-444444444444%7D'
  + '&file=Build%20Time%20Line.xlsx&action=default&mobileredirect=true';

const SHORT_FORM = 'https://contoso-my.sharepoint.com/:w:/p/rina_patel/AAAAdummyTOKENdummy?web=1';

describe('reading what a SharePoint link says about itself', () => {
  it('reads type, owner and filename out of the browser form', () => {
    // This is the shape you get from "Copy link" with the document open, and it
    // is generous: the name is right there in the query string, unencoded by
    // anything more than percent-escaping.
    const link = parseSharepointLink(BROWSER_FORM);

    expect(link).toMatchObject({
      service: 'OneDrive',
      personal: true,
      kind: 'file',
      app: 'Excel workbook',
      fileName: 'Build Time Line.xlsx',
      ownerSegment: 'rina_patel_contoso_com',
    });
  });

  it('reads type and owner out of the short form, which carries no filename', () => {
    // The short form tells you it is a Word document and whose it is, and
    // nothing else. Reporting `fileName: undefined` rather than inventing one
    // is the point.
    const link = parseSharepointLink(SHORT_FORM);

    expect(link).toMatchObject({
      kind: 'file',
      app: 'Word document',
      ownerSegment: 'rina_patel',
    });
    expect(link?.fileName).toBeUndefined();
  });

  it('does not mistake the `/p/` routing segment for the PowerPoint marker', () => {
    // The regression this guards: `:w:/p/...` has a bare `p` as its second
    // segment. Matching markers without requiring the colons would read that as
    // PowerPoint and describe a Word document as a deck.
    expect(parseSharepointLink(SHORT_FORM)?.app).toBe('Word document');
  });

  it('tells a folder link apart from a file link', () => {
    const folder = parseSharepointLink('https://contoso.sharepoint.com/:f:/s/Delivery/AAAAdummy');
    expect(folder).toMatchObject({ service: 'SharePoint', personal: false, kind: 'folder' });
    expect(folder?.app).toBeUndefined();
  });

  it('recognises a team site path', () => {
    const link = parseSharepointLink('https://contoso.sharepoint.com/sites/Delivery/Shared%20Documents');
    expect(link).toMatchObject({ service: 'SharePoint', personal: false, sitePath: '/sites/Delivery' });
  });

  it('says `unknown` rather than guessing when there is no marker', () => {
    // Most SharePoint links are files, so guessing "file" would be right more
    // often than not -- and would produce confidently wrong advice the rest of
    // the time. An unknown kind falls back to the general message.
    expect(parseSharepointLink('https://contoso.sharepoint.com/sites/HR/Shared%20Documents')?.kind)
      .toBe('unknown');
  });

  it('trusts a filename in the query even when the marker is unrecognised', () => {
    const link = parseSharepointLink(
      'https://contoso.sharepoint.com/:z:/r/sites/HR/_layouts/15/Doc.aspx?file=Policy.docx',
    );
    expect(link?.kind).toBe('file');
    expect(link?.fileName).toBe('Policy.docx');
  });

  it('returns nothing for hosts that are not SharePoint, and never throws', () => {
    expect(parseSharepointLink('https://github.com/acme/artifacts')).toBeUndefined();
    expect(parseSharepointLink('not a url at all')).toBeUndefined();
    expect(parseSharepointLink('')).toBeUndefined();
  });
});

describe('the advice a SharePoint link earns', () => {
  it('tells a document link that a single file can never be a catalog', () => {
    const verdict = classifyRemoteUrl(BROWSER_FORM);

    expect(verdict.supported).toBe(false);
    if (verdict.supported) return;
    // Naming the file is what makes the person certain we read THEIR link.
    expect(verdict.reason).toContain('Build Time Line.xlsx');
    // And this is the correction: the old message sent them off to sync a
    // library, which does not help, because the problem is not where the file
    // is. One file is not a folder of files.
    expect(verdict.reason).toContain('single file');
    expect(verdict.reason).toContain('stays true once the file is on this machine');
  });

  it('names the owner so the person knows which link was read', () => {
    const verdict = classifyRemoteUrl(SHORT_FORM);
    expect(verdict.supported).toBe(false);
    if (verdict.supported) return;
    expect(verdict.reason).toContain('rina_patel');
    expect(verdict.reason).toContain('Word document');
  });

  it('tells a folder link to sync, which is advice that actually works', () => {
    const verdict = classifyRemoteUrl('https://contoso.sharepoint.com/:f:/s/Delivery/AAAAdummy');
    expect(verdict.supported).toBe(false);
    if (verdict.supported) return;
    expect(verdict.reason).toContain('folder');
    expect(verdict.reason).toContain('remote add');
    // A folder link must NOT be told it can never be a catalog -- it can.
    expect(verdict.reason).not.toContain('single file');
  });

  it('distinguishes a personal OneDrive from a team library in the instruction', () => {
    // These are different operations in the product, and telling somebody to
    // hit "Sync" on a document in a colleague's OneDrive sends them looking for
    // a button that is not there.
    const personal = classifyRemoteUrl(SHORT_FORM);
    const team = classifyRemoteUrl('https://contoso.sharepoint.com/:f:/s/Delivery/AAAAdummy');

    expect(personal.supported).toBe(false);
    expect(team.supported).toBe(false);
    if (personal.supported || team.supported) return;
    expect(personal.reason).toContain('Add shortcut to My files');
    expect(team.reason).toContain('"Sync"');
  });
});
