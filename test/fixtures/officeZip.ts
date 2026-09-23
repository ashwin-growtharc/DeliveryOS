import * as fs from 'fs';

/**
 * Office files for tests, built by hand.
 *
 * WHY BUILT RATHER THAN CHECKED IN
 *
 * An Office file is a ZIP of XML, and a binary fixture in a repository is a
 * thing nobody can review: a reader cannot tell what a committed `.docx`
 * contains, or why a test expects a particular string out of it. Written by
 * hand, the input is visible in the test.
 *
 * Store-only (no compression) keeps the writer to about thirty lines. Every
 * reader in this repo handles both `store` and `deflate`, and the real `.xlsx`
 * in our own catalog -- which is deflated -- was used to check that path.
 *
 * WHY THE DOCX IS "REAL ENOUGH"
 *
 * `officeText.ts` reads with regexes and needs only `word/document.xml`. A
 * DOM-based renderer (the Document tab's `docx-preview`) needs what Word
 * itself needs: `[Content_Types].xml`, `_rels/.rels` pointing at the main
 * part, the document's own rels, and the `w:` namespace declared. All of that
 * is here so one fixture serves both readers, and so a test that passes here
 * is not passing on a file Word would refuse to open.
 */

/** Writes a store-only ZIP of UTF-8 text entries. CRCs are zero -- nothing in
 * this repo checks them, and JSZip does not by default. */
export function buildStoreOnlyZip(files: Record<string, string>): Buffer {
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
    local.writeUInt32LE(0, 14); // crc, unchecked by the readers
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

  return Buffer.concat([...locals, centralBuf, eocd]);
}

export function writeStoreOnlyZip(file: string, files: Record<string, string>): void {
  fs.writeFileSync(file, buildStoreOnlyZip(files));
}

/** `docProps/core.xml` with the given Dublin Core fields. Empty strings are
 * what real files have: nobody opens File > Properties. */
export function coreProperties(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([tag, value]) => `<${tag}>${value}</${tag}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + body
    + '</cp:coreProperties>'
  );
}

const CONTENT_TYPES_DOCX =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  + '</Types>';

const ROOT_RELS_DOCX =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
  + '</Relationships>';

const DOCUMENT_RELS_DOCX =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

/**
 * A Word document. Each inner array is one paragraph; each string in it is one
 * run -- Word splits a sentence into runs whenever formatting changes, which
 * is the case `officeText` has to join back together.
 */
export function buildDocxBuffer(paragraphs: string[][], props?: Record<string, string>): Buffer {
  const body = paragraphs
    .map((runs) => `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join('')}</w:p>`)
    .join('');
  return buildStoreOnlyZip({
    '[Content_Types].xml': CONTENT_TYPES_DOCX,
    '_rels/.rels': ROOT_RELS_DOCX,
    'word/_rels/document.xml.rels': DOCUMENT_RELS_DOCX,
    'docProps/core.xml': coreProperties(props ?? { 'dc:title': '', 'dc:description': '' }),
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:body>${body}</w:body></w:document>`,
  });
}

export function writeDocx(file: string, paragraphs: string[][], props?: Record<string, string>): void {
  fs.writeFileSync(file, buildDocxBuffer(paragraphs, props));
}

/** A workbook whose text lives in the shared-string table, in the order given,
 * with one sheet whose cells reference them in order. */
export function buildXlsxBuffer(sharedStrings: string[], props?: Record<string, string>): Buffer {
  const sst = sharedStrings.map((s) => `<si><t>${s}</t></si>`).join('');
  const cells = sharedStrings
    .map((_, i) => `<c r="A${i + 1}" t="s"><v>${i}</v></c>`)
    .map((c, i) => `<row r="${i + 1}">${c}</row>`)
    .join('');
  return buildStoreOnlyZip({
    'docProps/core.xml': coreProperties(props ?? { 'dc:title': '' }),
    'xl/sharedStrings.xml':
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sst}</sst>`,
    'xl/worksheets/sheet1.xml':
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`,
  });
}

/** A deck: one entry per slide, each a list of text runs. Slide files are
 * numbered from 1 as PowerPoint numbers them. */
export function buildPptxBuffer(slides: string[][], props?: Record<string, string>): Buffer {
  const files: Record<string, string> = { 'docProps/core.xml': coreProperties(props ?? { 'dc:title': '' }) };
  slides.forEach((runs, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] =
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
      + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
      + runs.map((r) => `<a:t>${r}</a:t>`).join('')
      + '</p:sld>';
  });
  return buildStoreOnlyZip(files);
}
