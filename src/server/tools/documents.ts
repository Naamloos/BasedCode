import { unzipSync, strFromU8 } from 'fflate';

/** An image found inside a document. */
export interface DocumentImage {
  name: string;
  mediaType: string;
  data: Uint8Array;
}

export interface ExtractedDocument {
  format: string;
  text: string;
  /** Pages, slides or sheets, when the format has them. */
  parts?: number;
  images: DocumentImage[];
}

export interface ExtractOptions {
  includeImages: boolean;
  /** Most images to collect. */
  maxImages: number;
  /** 1-based inclusive page/slide/sheet range; undefined means all. */
  range?: { from: number; to: number };
}

const imageMediaTypes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
/** Images over this size are skipped; providers reject very large images and they cost many tokens. */
const imageByteLimit = 4 * 1024 * 1024;

export const documentExtensions = [
  'pdf',
  'docx',
  'docm',
  'dotx',
  'xlsx',
  'xlsm',
  'pptx',
  'pptm',
  'odt',
  'ods',
  'odp',
  'epub',
  'rtf',
  'html',
  'htm',
  'ipynb',
] as const;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function parseRange(value: string | undefined): ExtractOptions['range'] {
  if (!value) return undefined;
  const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(value);
  if (!match) throw new Error('range must look like "3" or "2-5".');
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  if (from < 1 || to < from) throw new Error('range must start at 1 and not run backwards.');
  return { from, to };
}

const inRange = (index: number, range: ExtractOptions['range']) =>
  !range || (index >= range.from && index <= range.to);

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return entities[code.toLowerCase()] ?? whole;
  });
}

/** Turns markup into plain text: the given tags become line breaks/tabs, all other tags vanish. */
function markupText(xml: string, breaks: RegExp, tabs?: RegExp, cells?: RegExp): string {
  let text = xml.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  if (cells) text = text.replace(cells, ' | ');
  if (tabs) text = text.replace(tabs, '\t');
  text = text.replace(breaks, '\n');
  text = decodeEntities(text.replace(/<[^>]+>/g, ''));
  return tidy(text);
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const naturalOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function collectImages(
  files: Record<string, Uint8Array>,
  folder: RegExp,
  options: ExtractOptions,
): DocumentImage[] {
  if (!options.includeImages) return [];
  const images: DocumentImage[] = [];
  for (const name of Object.keys(files).sort(naturalOrder)) {
    if (images.length >= options.maxImages) break;
    const mediaType = imageMediaTypes[extensionOf(name)];
    if (!mediaType || !folder.test(name) || files[name].length > imageByteLimit) continue;
    images.push({ name, mediaType, data: files[name] });
  }
  return images;
}

function read(files: Record<string, Uint8Array>, name: string): string {
  const file = files[name];
  return file ? strFromU8(file) : '';
}

function docx(files: Record<string, Uint8Array>, options: ExtractOptions): ExtractedDocument {
  const body = read(files, 'word/document.xml');
  if (!body) throw new Error('Not a Word document: word/document.xml is missing.');
  const extras = Object.keys(files)
    .filter((name) => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(name))
    .sort(naturalOrder)
    .map((name) => read(files, name));
  const text = [body, ...extras]
    .map((xml) =>
      markupText(xml, /<\/w:p>|<w:br\s*\/>|<w:cr\s*\/>|<\/w:tr>/g, /<w:tab\s*\/>/g, /<\/w:tc>/g),
    )
    .filter(Boolean)
    .join('\n\n');
  return { format: 'docx', text, images: collectImages(files, /^word\/media\//, options) };
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference.replace(/\d+/g, '').toUpperCase())
    index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

/** Workbook relationship targets by id, for mapping sheet names to their XML files. */
function relationships(xml: string, base: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(match[0])?.[1];
    if (id && target) map.set(id, target.startsWith('/') ? target.slice(1) : base + target);
  }
  return map;
}

function xlsx(files: Record<string, Uint8Array>, options: ExtractOptions): ExtractedDocument {
  const workbook = read(files, 'xl/workbook.xml');
  if (!workbook) throw new Error('Not an Excel workbook: xl/workbook.xml is missing.');
  const shared = [...read(files, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (match) => decodeEntities([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const rels = relationships(read(files, 'xl/_rels/workbook.xml.rels'), 'xl/');
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((match, index) => ({
    name: decodeEntities(/\bname="([^"]*)"/.exec(match[0])?.[1] ?? `Sheet${index + 1}`),
    file: rels.get(/\br:id="([^"]+)"/.exec(match[0])?.[1] ?? '') ?? `xl/worksheets/sheet${index + 1}.xml`,
  }));
  const sections: string[] = [];
  sheets.forEach((sheet, index) => {
    if (!inRange(index + 1, options.range)) return;
    const rows: string[] = [];
    for (const row of read(files, sheet.file).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const number = /\br="(\d+)"/.exec(row[1])?.[1] ?? String(rows.length + 1);
      const cells: string[] = [];
      for (const cell of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributes = cell[1];
        const inner = cell[2] ?? '';
        const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
        const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value: string;
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr')
          value = decodeEntities([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else value = decodeEntities(raw ?? '');
        const column = reference ? columnIndex(reference) : cells.length;
        while (cells.length < column) cells.push('');
        cells[column] = value.replace(/[\t\n]+/g, ' ');
      }
      if (cells.some(Boolean)) rows.push(`${number}\t${cells.join('\t')}`);
    }
    sections.push(`## Sheet ${index + 1}: ${sheet.name}\n${rows.join('\n') || '(empty)'}`);
  });
  return {
    format: 'xlsx',
    text: sections.join('\n\n'),
    parts: sheets.length,
    images: collectImages(files, /^xl\/media\//, options),
  };
}

function pptx(files: Record<string, Uint8Array>, options: ExtractOptions): ExtractedDocument {
  const slides = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(naturalOrder);
  if (!slides.length) throw new Error('Not a PowerPoint deck: no slides found.');
  const sections: string[] = [];
  slides.forEach((name, index) => {
    if (!inRange(index + 1, options.range)) return;
    const number = /slide(\d+)\.xml$/.exec(name)![1];
    const text = markupText(read(files, name), /<\/a:p>|<a:br\s*\/>/g, undefined, /<\/a:tc>/g);
    const notes = markupText(read(files, `ppt/notesSlides/notesSlide${number}.xml`), /<\/a:p>/g);
    sections.push(`## Slide ${index + 1}\n${text}${notes ? `\n\nNotes:\n${notes}` : ''}`);
  });
  return {
    format: 'pptx',
    text: sections.join('\n\n'),
    parts: slides.length,
    images: collectImages(files, /^ppt\/media\//, options),
  };
}

function openDocument(files: Record<string, Uint8Array>, options: ExtractOptions, format: string): ExtractedDocument {
  const content = read(files, 'content.xml');
  if (!content) throw new Error('Not an OpenDocument file: content.xml is missing.');
  const text = markupText(
    content,
    /<\/text:p>|<\/text:h>|<text:line-break\s*\/>|<\/table:table-row>/g,
    /<text:tab\s*\/>/g,
    /<\/table:table-cell>/g,
  );
  return { format, text, images: collectImages(files, /^Pictures\//, options) };
}

function epub(files: Record<string, Uint8Array>, options: ExtractOptions): ExtractedDocument {
  const container = read(files, 'META-INF/container.xml');
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  const opf = opfPath ? read(files, opfPath) : '';
  const base = opfPath?.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map<string, string>();
  for (const item of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(item[0])?.[1];
    const href = /\bhref="([^"]+)"/.exec(item[0])?.[1];
    if (id && href) manifest.set(id, base + decodeURIComponent(href));
  }
  let chapters = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)]
    .map((match) => manifest.get(match[1]))
    .filter((name): name is string => !!name && !!files[name]);
  if (!chapters.length)
    chapters = Object.keys(files).filter((name) => /\.x?html?$/i.test(name)).sort(naturalOrder);
  const sections: string[] = [];
  chapters.forEach((name, index) => {
    if (!inRange(index + 1, options.range)) return;
    const text = htmlText(read(files, name));
    if (text) sections.push(`## Chapter ${index + 1}\n${text}`);
  });
  return {
    format: 'epub',
    text: sections.join('\n\n'),
    parts: chapters.length,
    images: collectImages(files, /./, options),
  };
}

export function htmlText(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return markupText(
    body,
    /<br\s*\/?>|<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre|table)>/gi,
    undefined,
    /<\/t[dh]>/gi,
  );
}

/** Plain text from RTF: drops control words and groups such as font tables and embedded pictures. */
export function rtfText(rtf: string): string {
  let text = rtf.replace(/\{\\\*[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
  text = text.replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}\s*(?=[{\\]|$)/g, '');
  text = text
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, code: string) => String.fromCharCode((Number(code) + 65536) % 65536))
    .replace(/\\(par|line)\b\s?/g, '\n')
    .replace(/\\tab\b\s?/g, '\t')
    .replace(/\\([{}\\])/g, '$1')
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '');
  return tidy(text);
}

function notebookText(source: string): string {
  const notebook = JSON.parse(source) as {
    cells?: { cell_type: string; source: string | string[]; outputs?: { text?: string | string[] }[] }[];
  };
  const join = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join('') : value ?? '');
  return (notebook.cells ?? [])
    .map((cell, index) => {
      const outputs = (cell.outputs ?? []).map((output) => join(output.text)).filter(Boolean).join('\n');
      return `## Cell ${index + 1} (${cell.cell_type})\n${join(cell.source)}${outputs ? `\n\nOutput:\n${outputs}` : ''}`;
    })
    .join('\n\n');
}

async function pdf(bytes: Uint8Array, options: ExtractOptions): Promise<ExtractedDocument> {
  const { extractImages, extractText, getDocumentProxy } = await import('unpdf');
  const document = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { totalPages, text } = await extractText(document, { mergePages: false });
    const sections = text
      .map((page, index) => (inRange(index + 1, options.range) ? `## Page ${index + 1}\n${tidy(page)}` : ''))
      .filter(Boolean);
    const images: DocumentImage[] = [];
    if (options.includeImages) {
      for (let page = 1; page <= totalPages && images.length < options.maxImages; page++) {
        if (!inRange(page, options.range)) continue;
        const found = await extractImages(document, page, { format: 'png' }).catch(() => []);
        for (const [index, image] of found.entries()) {
          if (images.length >= options.maxImages) break;
          // Skip icons, bullets and other decoration.
          if (image.width < 48 || image.height < 48 || image.data.length > imageByteLimit) continue;
          images.push({ name: `page${page}-image${index + 1}.png`, mediaType: 'image/png', data: image.data });
        }
      }
    }
    return { format: 'pdf', text: sections.join('\n\n'), parts: totalPages, images };
  } finally {
    // PDF.js frees worker memory here; unpdf's typings leave the method out.
    await (document as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
}

/** Extracts text (and optionally embedded images) from a document file's bytes. */
export async function extractDocument(
  bytes: Uint8Array,
  name: string,
  options: ExtractOptions,
): Promise<ExtractedDocument> {
  const extension = extensionOf(name);
  switch (extension) {
    case 'pdf':
      return pdf(bytes, options);
    case 'rtf':
      return { format: 'rtf', text: rtfText(Buffer.from(bytes).toString('latin1')), images: [] };
    case 'html':
    case 'htm':
      return { format: 'html', text: htmlText(Buffer.from(bytes).toString('utf8')), images: [] };
    case 'ipynb':
      return { format: 'ipynb', text: notebookText(Buffer.from(bytes).toString('utf8')), images: [] };
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error(`Could not open ${name} as a ${extension || 'zip-based'} document.`);
  }
  switch (extension) {
    case 'docx':
    case 'docm':
    case 'dotx':
      return docx(files, options);
    case 'xlsx':
    case 'xlsm':
      return xlsx(files, options);
    case 'pptx':
    case 'pptm':
      return pptx(files, options);
    case 'odt':
    case 'ods':
    case 'odp':
      return openDocument(files, options, extension);
    case 'epub':
      return epub(files, options);
  }
  throw new Error(
    `Unsupported document type ".${extension}". Supported: ${documentExtensions.join(', ')}.`,
  );
}
