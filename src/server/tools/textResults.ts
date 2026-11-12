/**
 * Compact text forms of tool results. The model pays for every character of a result on each later step, so file
 * reads, searches and listings are plain text here instead of JSON objects that repeat keys and escape code.
 */

/** Characters of file content one read returns before it stops and points at the next line. */
export const readBudget = 16_000;
/** Longer lines (minified code, data blobs) are cut; nothing useful is read from them a line at a time. */
const lineLimit = 1_000;

const clipLine = (line: string, limit = lineLimit) =>
  line.length > limit ? `${line.slice(0, limit)}… [+${line.length - limit} chars]` : line;

/**
 * Lines `startLine..` as "N: text", stopping at `maxLines` or the character budget, whichever comes first.
 * Always returns at least one line so paging makes progress.
 */
export function numberedLines(
  all: string[],
  startLine: number,
  maxLines: number,
  budget = readBudget,
): { text: string; endLine: number } {
  const rows: string[] = [];
  let used = 0;
  let line = startLine;
  for (; line <= all.length && rows.length < maxLines; line++) {
    const row = `${line}: ${clipLine(all[line - 1])}`;
    if (rows.length && used + row.length > budget) break;
    rows.push(row);
    used += row.length + 1;
  }
  return { text: rows.join('\n'), endLine: line - 1 };
}

/** "path lines 1-200 of 950 · more: startLine 201" */
export function readHeader(
  path: string,
  startLine: number,
  endLine: number,
  totalLines: number,
  matchLine?: number,
): string {
  const range = endLine < startLine ? 'no lines' : `lines ${startLine}-${endLine}`;
  return [
    `${path} ${range} of ${totalLines}`,
    ...(matchLine ? [`match on ${matchLine}`] : []),
    ...(endLine < totalLines ? [`more: startLine ${endLine + 1}`] : []),
  ].join(' · ');
}

export interface FileMatches {
  path: string;
  lines: string[];
  /** Zero-based indexes of matching lines. */
  matches: number[];
}

/**
 * Search matches grouped per file, so a path is written once:
 *
 *     src/a.ts
 *       12: const value = 1;
 *
 * With context, surrounding lines use "N- text" and separate hunks are divided by "--".
 */
export function formatMatches(files: FileMatches[], context: number): string {
  const sections: string[] = [];
  for (const file of files) {
    const hits = new Set(file.matches);
    const shown = new Set<number>();
    for (const index of file.matches)
      for (
        let line = Math.max(0, index - context);
        line <= Math.min(file.lines.length - 1, index + context);
        line++
      )
        shown.add(line);
    const rows: string[] = [file.path];
    let previous = -1;
    for (const index of [...shown].sort((a, b) => a - b)) {
      if (context && previous !== -1 && index > previous + 1) rows.push('  --');
      const text = clipLine(context ? file.lines[index].trimEnd() : file.lines[index].trim(), 300);
      rows.push(`  ${index + 1}${hits.has(index) ? ':' : '-'} ${text}`);
      previous = index;
    }
    sections.push(rows.join('\n'));
  }
  return sections.join('\n');
}

/** A sorted path listing as an indented tree: each directory name is written once, directories end in "/". */
export function pathTree(entries: { path: string; directory: boolean }[], root = ''): string {
  const prefix = root && root !== '.' ? `${root.replace(/\/$/, '')}/` : '';
  return entries
    .map((entry) => {
      const parts = (
        entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path
      ).split('/');
      return `${' '.repeat(parts.length - 1)}${parts.at(-1)}${entry.directory ? '/' : ''}`;
    })
    .join('\n');
}

const controlKeywords =
  /^\s*(?:if|else|for|while|switch|catch|return|do|try|throw|await|new|case|typeof|delete|yield|super|function\s*\()\b/;

/** Declaration shapes across common languages. Heuristic on purpose: an outline is a map, not a parse. */
const declarations: RegExp[] = [
  // JS/TS, PHP, Kotlin, Swift, Java, C#, Dart: keyword-led declarations with optional modifiers.
  /^\s*(?:@\w+\s+)*(?:(?:export|default|declare|public|private|protected|internal|static|final|abstract|override|open|sealed|partial|virtual|async|suspend|data|inline|readonly|unsafe|extern)\s+)*(?:function\*?|class|interface|type|enum|namespace|module|struct|record|object|trait|protocol|extension|fun|func|def|fn|impl|mod|macro_rules!)\s+[\w$<(]/,
  // Exported or top-level bindings, and arrow functions assigned to a name.
  /^(?:export\s+)?(?:const|let|var)\s+[\w$]+/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>/,
  // Rust and Go items with visibility.
  /^\s*pub(?:\([^)]*\))?\s+(?:async\s+|unsafe\s+|const\s+)*(?:fn|struct|enum|trait|mod|type|static|const)\s+\w+/,
  /^(?:func|type|var|const)\s+[\w(]/,
  // Methods: "name(args) {" inside a class body, or a visibility-led member signature.
  /^\s+(?:(?:public|private|protected|static|async|override|readonly|get|set|abstract)\s+)*[\w$#]+\s*(?:<[^>]*>)?\([^;]*\)\s*(?::\s*[^;={]+)?\{\s*$/,
  /^\s*(?:public|private|protected|internal)\s+[^;=]*\([^;]*$/,
  // C/C++ function definitions at column 0.
  /^[A-Za-z_][\w:*&<>,~ ]*\s[\w:~*&]+\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?\{?\s*$/,
  // Vue/Svelte single-file component blocks.
  /^<(?:script|template|style)\b/,
];

/** Lines that look like declarations (classes, functions, types, top-level bindings), as "N: text". */
export function outline(content: string, path: string, limit = 300): string {
  const lines = content.split(/\r\n|\n|\r/);
  const markdown = /\.(md|mdx|markdown)$/i.test(path);
  const rows: string[] = [];
  let fenced = false;
  let more = 0;
  lines.forEach((line, index) => {
    if (markdown) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced || !/^#{1,6}\s/.test(line)) return;
    } else if (
      line.length > 400 ||
      controlKeywords.test(line) ||
      !declarations.some((pattern) => pattern.test(line))
    )
      return;
    if (rows.length >= limit) more++;
    else rows.push(`${index + 1}: ${clipLine(line.trimEnd(), 160)}`);
  });
  const header = `${path} (${lines.length} lines)`;
  if (!rows.length) return `${header}\n(no declarations recognized; use read_file or search)`;
  return [header, ...rows, ...(more ? [`… ${more} more declarations`] : [])].join('\n');
}

/** Keeps the start and end of long text, where command output carries its errors and summary. */
export function headTail(text: string, limit: number, headShare = 0.25): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * headShare);
  const tail = limit - head;
  return `${text.slice(0, head)}\n… [${(text.length - limit).toLocaleString()} characters omitted] …\n${text.slice(-tail)}`;
}

/** Collapses runs of identical lines and stacked blank lines: progress spam and padding carry no information. */
export function squeezeLines(text: string): string {
  const out: string[] = [];
  let repeats = 0;
  const flush = () => {
    if (repeats > 1) out.push(`[previous line repeated ${repeats} more times]`);
    else if (repeats === 1) out.push(out.at(-1)!);
    repeats = 0;
  };
  for (const line of text.split('\n').map((item) => item.trimEnd())) {
    if (out.length && line === out.at(-1)) {
      if (line) repeats++;
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join('\n');
}

const codePoint = (code: number) =>
  code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
};

/**
 * Readable text from an HTML page: scripts, styles and chrome dropped, headings and list items marked, links kept
 * as "text (url)". A page's markup is most of its size and none of what a model reads it for.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(nav|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_, code: string) =>
      `\n\`\`\`\n${code.replace(/<[^>]+>/g, '').replace(/\n/g, '\u0000')}\n\`\`\`\n`,
    )
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(?:td|th)\b[^>]*>/gi, ' | ')
    .replace(
      /<a\b[^>]*?href\s*=\s*["']?(https?:[^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a\s*>/gi,
      (_, url: string, text: string) => {
        const label = text.replace(/<[^>]+>/g, '').trim();
        return label && label !== url ? `${label} (${url})` : url;
      },
    )
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|header|main|tr|table|ul|ol|blockquote|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => codePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => codePoint(parseInt(code, 16)))
    .replace(/&(\w+);/g, (whole: string, name: string) => entities[name] ?? whole)
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replaceAll('\u0000', '\n')
    .trim();
}
