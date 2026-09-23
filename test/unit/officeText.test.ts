import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describeOfficeFile, isOfficeFile } from '../../src/engine/adopt/officeText';
import { writeStoreOnlyZip, writeDocx, coreProperties } from '../fixtures/officeZip';

/**
 * Describing a Word document, spreadsheet or deck well enough to put it in a
 * catalog.
 *
 * Fixtures are built by hand in `test/fixtures/officeZip.ts` rather than
 * checked in as binaries; that file says why.
 */

let dir: string;

function docx(file: string, paragraphs: string[][], props?: Record<string, string>): void {
  writeDocx(path.join(dir, file), paragraphs, props);
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
    expect(result?.guessed).toBe(false);
  });

  it('treats empty declared fields as absent, because real files have them', () => {
    // Not hypothetical: the real `.xlsx` in our own catalog has an empty title,
    // description AND subject, because nobody opens File > Properties. An empty
    // string here must not win over the document's actual text.
    docx('empty-props.docx', [['Onboarding checklist']], { 'dc:title': '', 'dc:description': '' });

    const result = describeOfficeFile(path.join(dir, 'empty-props.docx'));
    expect(result?.description).toBe('Onboarding checklist');
    expect(result?.guessed).toBe(true);
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
    writeStoreOnlyZip(path.join(dir, 'calc.xlsx'), {
      'docProps/core.xml': coreProperties({ 'dc:title': '' }),
      'xl/sharedStrings.xml': '<sst><si><t>Scoping calculator</t></si><si><t>Day rate</t></si><si><t>Complexity</t></si></sst>',
    });

    expect(describeOfficeFile(path.join(dir, 'calc.xlsx'))?.description).toBe('Scoping calculator');
  });

  it('takes the title from a deck\'s first slide', () => {
    writeStoreOnlyZip(path.join(dir, 'deck.pptx'), {
      'docProps/core.xml': coreProperties({ 'dc:title': '' }),
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
    // The template and macro-enabled variants are what a client's library
    // actually holds -- a Word TEMPLATE is a .dotx -- and every one is the
    // same OOXML zip inside.
    for (const name of ['a.docx', 'B.XLSX', 'c.pptx', 'd.dotx', 'E.XLTX', 'f.potx', 'g.docm', 'h.xlsm', 'i.pptm']) {
      expect(isOfficeFile(name), name).toBe(true);
    }
    // `.doc`, `.xls` and `.ppt` are the old binary formats -- not ZIPs, and not
    // supported. Claiming them would mean returning undefined for every one.
    for (const name of ['a.doc', 'b.xls', 'c.ppt', 'd.md', 'e.pdf']) {
      expect(isOfficeFile(name), name).toBe(false);
    }
  });
});
