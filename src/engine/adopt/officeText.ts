import * as fs from 'fs';
import * as zlib from 'zlib';

/**
 * Enough of Word, Excel and PowerPoint to describe one, and no more.
 *
 * WHY THIS EXISTS AT ALL
 *
 * A client's template library is Word documents, spreadsheets and decks. That
 * is the actual shape of the thing, and until now adoption skipped every one of
 * them with "no frontmatter description and no heading" -- an honest refusal
 * that happened to reject the entire real use case.
 *
 * WHY IT IS NOT A CONVERSION
 *
 * Nothing is converted and nothing is rewritten. The `.docx` is installed
 * byte-for-byte as the client wrote it. The ONLY thing needed is a sentence to
 * put in a manifest so a person can tell one template from another when
 * browsing, and that is a much smaller problem than "support Office documents"
 * sounds.
 *
 * WHY NO DEPENDENCY
 *
 * An Office file is a ZIP of XML, and Node ships the inflate half of ZIP in
 * `zlib`. Reading one specific entry out of an archive is about a hundred lines
 * of header parsing, against a new dependency in a repository that has already
 * paid for one ESM/CommonJS interop problem (see `createOctokit`'s dynamic
 * import and the Node 22.12 engines floor it forced).
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** Largest end-of-archive comment the spec allows, plus the record itself. The
 * end-of-central-directory record sits at the very end unless a comment follows
 * it, so it has to be scanned for backwards. */
const EOCD_MAX_SCAN = 0xffff + 22;

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(buf: Buffer): number | undefined {
  const start = Math.max(0, buf.length - EOCD_MAX_SCAN);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return undefined;
}

/** The archive's table of contents. Central directory only -- local headers are
 * read lazily, and only for an entry actually wanted. */
function readCentralDirectory(buf: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd === undefined) return [];

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;

    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);

    entries.push({
      name: buf.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8'),
      compressionMethod: buf.readUInt16LE(offset + 10),
      compressedSize: buf.readUInt32LE(offset + 20),
      localHeaderOffset: buf.readUInt32LE(offset + 42),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** One entry's bytes, or undefined when it is absent or stored in a way this
 * does not handle. Only `store` and `deflate` are supported, which is every
 * Office file anything has ever written. */
function readEntry(buf: Buffer, entry: ZipEntry): Buffer | undefined {
  const header = entry.localHeaderOffset;
  if (header + 30 > buf.length) return undefined;

  // The local header repeats the name and extra-field lengths, and they are NOT
  // always the same as the central directory's -- the data offset must come
  // from here.
  const nameLength = buf.readUInt16LE(header + 26);
  const extraLength = buf.readUInt16LE(header + 28);
  const start = header + 30 + nameLength + extraLength;
  const data = buf.subarray(start, start + entry.compressedSize);

  try {
    if (entry.compressionMethod === 0) return data;
    if (entry.compressionMethod === 8) return zlib.inflateRawSync(data);
  } catch {
    return undefined;
  }
  return undefined;
}

function textOf(buf: Buffer, entries: ZipEntry[], name: string): string | undefined {
  const entry = entries.find((e) => e.name === name);
  if (!entry) return undefined;
  return readEntry(buf, entry)?.toString('utf-8');
}

function unescapeXml(value: string): string {
  // `&amp;` last, or `&amp;lt;` would become `<` instead of the literal `&lt;`.
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** First non-empty value of an XML tag, unescaped. Deliberately a regex and not
 * a parser: one field out of a known, machine-generated document does not
 * justify an XML dependency, and a malformed file returning `undefined` is the
 * correct outcome anyway. */
function tagValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  if (!match) return undefined;
  const value = unescapeXml(match[1]).trim();
  return value.length > 0 ? value : undefined;
}

/** Runs of visible text, in document order. `<w:t>` for Word, `<a:t>` for
 * PowerPoint, `<t>` for the shared-string table Excel keeps its text in. */
function visibleText(xml: string, tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    for (const match of xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))) {
      // NOT trimmed. Word marks runs `xml:space="preserve"`, and the spaces
      // between words live at the EDGES of a run -- "Proposal " then
      // "template" -- so trimming each and joining produces
      // "Proposaltemplate". Callers wanting a single value trim it themselves;
      // the paragraph join must not.
      const text = unescapeXml(match[1].replace(/<[^>]+>/g, ''));
      if (text.trim().length > 0) out.push(text);
    }
  }
  return out;
}

/**
 * Word's first paragraph.
 *
 * Runs INSIDE one paragraph are joined, because Word splits a single sentence
 * across runs whenever formatting changes mid-line -- a bolded word becomes its
 * own run, so "Proposal template" arrives as two. Paragraphs are NOT joined,
 * because the second one is body text and the description wants the title.
 */
function firstLineOfWord(buf: Buffer, entries: ZipEntry[]): string | undefined {
  const xml = textOf(buf, entries, 'word/document.xml');
  if (!xml) return undefined;

  for (const paragraph of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const runs = visibleText(paragraph[0], ['w:t']);
    const line = runs.join('').replace(/\s+/g, ' ').trim();
    if (line.length > 0) return line;
  }
  return undefined;
}

/** A deck's title slide. The first text on slide one is the title placeholder
 * in every template anybody actually uses. */
function firstLineOfSlides(buf: Buffer, entries: ZipEntry[]): string | undefined {
  const xml = textOf(buf, entries, 'ppt/slides/slide1.xml');
  if (!xml) return undefined;
  return visibleText(xml, ['a:t'])[0]?.trim();
}

/**
 * A spreadsheet's first shared string.
 *
 * Only the first, deliberately. Excel keeps every distinct cell string in one
 * table, so joining them produces a run-on of unrelated column headings and
 * data -- readable, and useless in a list where the point is telling one
 * template from another at a glance.
 */
function firstLineOfSheet(buf: Buffer, entries: ZipEntry[]): string | undefined {
  const xml = textOf(buf, entries, 'xl/sharedStrings.xml');
  if (!xml) return undefined;
  return visibleText(xml, ['t'])[0]?.trim();
}

export interface OfficeDescription {
  description: string;
  /** True unless the author actually filled in the document's properties,
   * which almost nobody does -- the real `.xlsx` in our own catalog has an
   * empty title, description AND subject. Treated exactly like markdown
   * frontmatter: authoritative when present, absent most of the time. Named
   * for what every consumer asks (`descriptionGuessed`), not its inverse. */
  guessed: boolean;
}

/**
 * Extensions this can describe. Anything else is not an Office file and should
 * not be guessed at.
 *
 * The template (`.dotx`, `.xltx`, `.potx`) and macro-enabled (`.docm`, `.xlsm`,
 * `.pptm`...) variants are the same OOXML zip inside, and a client's
 * template library is exactly where they turn up -- a Word TEMPLATE is a
 * `.dotx`. An extension table rather than magic-number sniffing alone,
 * because every `.zip` and `.jar` starts with the same two bytes; the sniff
 * in `describeOfficeFile` stays as the authority on what is really inside.
 */
export const OFFICE_EXTENSIONS = [
  '.docx', '.docm', '.dotx', '.dotm',
  '.xlsx', '.xlsm', '.xltx', '.xltm',
  '.pptx', '.pptm', '.potx', '.potm', '.ppsx',
] as const;

export function isOfficeFile(filename: string): boolean {
  return OFFICE_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext));
}

/**
 * A description for an Office file, or `undefined` when it has nothing to say
 * about itself.
 *
 * Two tiers, mirroring the markdown path exactly -- declared metadata first,
 * then the document's own first line of text, and never an invention.
 */
export function describeOfficeFile(absolutePath: string): OfficeDescription | undefined {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(absolutePath);
  } catch {
    return undefined;
  }

  // Every Office file is a ZIP. A `.docx` that is not one is either corrupt or
  // an old binary `.doc` renamed, and both deserve the same answer.
  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x4b50) return undefined;

  const entries = readCentralDirectory(buf);
  if (entries.length === 0) return undefined;

  // Tier one: what the author declared. Rare, and authoritative when present.
  const core = textOf(buf, entries, 'docProps/core.xml');
  if (core) {
    const declared = tagValue(core, 'dc:description')
      ?? tagValue(core, 'dc:subject')
      ?? tagValue(core, 'dc:title');
    if (declared) return { description: declared, guessed: false };
  }

  // Tier two: the document's own first line -- and "first line" means something
  // different in each format, which is why this is not one shared path.
  const firstLine = firstLineOfWord(buf, entries)
    ?? firstLineOfSlides(buf, entries)
    ?? firstLineOfSheet(buf, entries);
  if (!firstLine || firstLine.length === 0) return undefined;

  // Capped: a description is a sentence for choosing between artifacts, not the
  // document. The whole of a proposal template would be useless in a list.
  const capped = firstLine.length > 200 ? `${firstLine.slice(0, 197).trimEnd()}...` : firstLine;
  return { description: capped, guessed: true };
}
