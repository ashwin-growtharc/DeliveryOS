import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describeOfficeFile, isOfficeFile } from '../../src/engine/adopt/officeText';

/**
 * Describing a Word document, spreadsheet or deck well enough to put it in a
 * catalog.
 *
 * WHY THE FIXTURES ARE BUILT HERE RATHER THAN CHECKED IN
 *
 * An Office file is a ZIP of XML, and a binary fixture in a repository is a
 * thing nobody can review: a reader cannot tell what a committed `.docx`
 * contains, or why a test expects a particular string out of it. Written by
 * hand, the input is visible in the test.
 *
 * Store-only (no compression) is used because it keeps the writer to about
 * thirty lines. The reader handles both, and the real `.xlsx` in our own
 * catalog -- which is deflated -- was used to check that path by hand.
 */

let dir: string;

/** A minimal ZIP writer: local headers, central directory, end record. */
function writeZip(file: string, files: Record<string, string>): void {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const data = Buffer.from(content, 'utf-8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0, 14); // crc, unchecked by the reader
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10); // stored
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  fs.writeFileSync(file, Buffer.concat([...locals, centralBuf, eocd]));
}

function core(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([tag, value]) => `<${tag}>${value}</${tag}>`)
    .join('');
  return `<?xml version="1.0"?><cp:coreProperties>${body}</cp:coreProperties>`;
}

function docx(file: string, paragraphs: string[][], props?: Record<string, string>): void {
  const body = paragraphs
    .map((runs) => `<w:p>${runs.map((r) => `<w:t>${r}</w:t>`).join('')}</w:p>`)
    .join('');
  writeZip(path.join(dir, file), {
    'docProps/core.xml': core(props ?? { 'dc:title': '', 'dc:description': '' }),
    'word/document.xml': `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-office-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('describing a Word document', () => {
  it('uses the first paragraph, joining runs a formatting change split apart', () => {
    // Word breaks a sentence into separate runs whenever formatting changes
    // mid-line, so a bolded word arrives on its own. Taking only the first run
    // would describe this template as "Proposal ".
    docx('proposal.docx', [['Proposal ', 'template', ' for new engagements'], ['Body text here.']]);

    const result = describeOfficeFile(path.join(dir, 'proposal.docx'));
    expect(result?.description).toBe('Proposal template for new engagements');
  });

  it('does NOT run the whole document together', () => {
    // The counterweight. Paragraphs are separate thoughts; joining them gives a
    // description that is the document, which is useless in a list where the
    // point is telling two templates apart at a glance.
    docx('long.docx', [['Statement of work'], ['This document sets out the scope.'], ['More.']]);

    const result = describeOfficeFile(path.join(dir, 'long.docx'));
    expect(result?.description).toBe('Statement of work');
  });

  it('skips leading empty paragraphs, which real documents are full of', () => {
    docx('spaced.docx', [[], [''], ['Delivery plan']]);
    expect(describeOfficeFile(path.join(dir, 'spaced.docx'))?.description).toBe('Delivery plan');
  });

  it('prefers what the author declared, and says it was declared', () => {
    docx(
      'declared.docx',
      [['Some heading nobody wrote carefully']],
      { 'dc:description': 'The standard proposal we send to new clients.' },
    );

    const result = describeOfficeFile(path.join(dir, 'declared.docx'));
    expect(result?.description).toBe('The standard proposal we send to new clients.');
    // The distinction that matters: declared metadata is authoritative, derived
    // text is a guess a reviewer should read. Same rule as markdown frontmatter.
    expect(result?.declared).toBe(true);
  });

  it('treats empty declared fields as absent, because real files have them', () => {
    // Not hypothetical: the real `.xlsx` in our own catalog has an empty title,
    // description AND subject, because nobody opens File > Properties. An empty
    // string here must not win over the document's actual text.
    docx('empty-props.docx', [['Onboarding checklist']], { 'dc:title': '', 'dc:description': '' });

    const result = describeOfficeFile(path.join(dir, 'empty-props.docx'));
    expect(result?.description).toBe('Onboarding checklist');
    expect(result?.declared).toBe(false);
  });

  it('unescapes XML entities rather than showing them to a person', () => {
    docx('escaped.docx', [['Scoping &amp; estimating &lt;draft&gt;']]);
    expect(describeOfficeFile(path.join(dir, 'escaped.docx'))?.description)
      .toBe('Scoping & estimating <draft>');
  });

  it('caps a very long first paragraph', () => {
    docx('wordy.docx', [['x'.repeat(500)]]);
    const result = describeOfficeFile(path.join(dir, 'wordy.docx'));
    expect(result!.description.length).toBeLessThanOrEqual(200);
    expect(result!.description.endsWith('...')).toBe(true);
  });
});

describe('describing a spreadsheet and a deck', () => {
  it('takes only the FIRST shared string from a spreadsheet', () => {
    // Excel keeps every distinct cell string in one table. Joining them runs
    // unrelated column headings and data together -- which is exactly what the
    // first version of this did against the real catalog spreadsheet.
    writeZip(path.join(dir, 'calc.xlsx'), {
      'docProps/core.xml': core({ 'dc:title': '' }),
      'xl/sharedStrings.xml': '<sst><si><t>Scoping calculator</t></si><si><t>Day rate</t></si><si><t>Complexity</t></si></sst>',
    });

    expect(describeOfficeFile(path.join(dir, 'calc.xlsx'))?.description).toBe('Scoping calculator');
  });

  it('takes the title from a deck\'s first slide', () => {
    writeZip(path.join(dir, 'deck.pptx'), {
      'docProps/core.xml': core({ 'dc:title': '' }),
      'ppt/slides/slide1.xml': '<p:sld><a:t>Quarterly business review</a:t><a:t>Prepared by</a:t></p:sld>',
    });

    expect(describeOfficeFile(path.join(dir, 'deck.pptx'))?.description)
      .toBe('Quarterly business review');
  });
});

describe('refusing rather than guessing', () => {
  it('returns nothing for a file that is not really an Office file', () => {
    // An old binary `.doc` renamed to `.docx`, or something corrupt. Both
    // deserve "I cannot describe this", not a description built from noise.
    fs.writeFileSync(path.join(dir, 'fake.docx'), 'this is just text', 'utf-8');
    expect(describeOfficeFile(path.join(dir, 'fake.docx'))).toBeUndefined();
  });

  it('returns nothing for a document with no text at all', () => {
    docx('blank.docx', []);
    expect(describeOfficeFile(path.join(dir, 'blank.docx'))).toBeUndefined();
  });

  it('returns nothing for a file that is not there', () => {
    expect(describeOfficeFile(path.join(dir, 'absent.docx'))).toBeUndefined();
  });

  it('recognises the three formats and nothing else', () => {
    for (const name of ['a.docx', 'B.XLSX', 'c.pptx']) {
      expect(isOfficeFile(name), name).toBe(true);
    }
    // `.doc`, `.xls` and `.ppt` are the old binary formats -- not ZIPs, and not
    // supported. Claiming them would mean returning undefined for every one.
    for (const name of ['a.doc', 'b.xls', 'c.ppt', 'd.md', 'e.pdf']) {
      expect(isOfficeFile(name), name).toBe(false);
    }
  });
});
