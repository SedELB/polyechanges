import * as cheerio from 'cheerio';
import { extractText, getDocumentProxy } from 'unpdf';

const BLOCK = new Set([
  'p', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'dt', 'dd', 'dl', 'ul', 'ol', 'table',
  'thead', 'tbody', 'tfoot', 'tr', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
  'blockquote', 'pre', 'form', 'fieldset', 'figure', 'figcaption', 'caption', 'address', 'hr', 'body', 'html',
]);
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'title']);

/** Espace insécable → espace, espaces multiples → un seul, `trim`. */
export function normalizeText(s: string): string {
  return s.replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface DomNode {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}

function htmlLines(html: string): string[] {
  const $ = cheerio.load(html);
  const lines: string[] = [];
  let current = '';
  const flush = () => {
    const line = normalizeText(current);
    if (line) lines.push(line);
    current = '';
  };
  const walk = (node: DomNode) => {
    if (node.type === 'text') {
      current += node.data ?? '';
      return;
    }
    if (node.type !== 'tag' && node.type !== 'root') return;
    const name = node.name?.toLowerCase() ?? '';
    if (SKIP.has(name)) return;
    if (name === 'br') {
      flush();
      return;
    }
    const block = BLOCK.has(name);
    if (block) flush();
    for (const child of node.children ?? []) walk(child);
    if (block) flush();
  };
  walk($.root().get(0) as unknown as DomNode);
  flush();
  return lines;
}

/** Texte d'une copie brute : pages, puis lignes (une seule page pour du HTML). */
export async function snapshotText(body: Buffer, contentType: string): Promise<string[][]> {
  if (contentType.toLowerCase().includes('pdf')) {
    const pdf = await getDocumentProxy(new Uint8Array(body));
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((page) => page.split(/\r?\n/).map(normalizeText).filter((l) => l !== ''));
  }
  return [htmlLines(body.toString('utf8'))];
}

/** Positions (1-based) des lignes qui contiennent l'extrait, après la même normalisation. */
export function findQuote(pages: string[][], quote: string): { page: number; line: number }[] {
  const q = normalizeText(quote);
  const found: { page: number; line: number }[] = [];
  if (q === '') return found;
  pages.forEach((lines, p) => {
    lines.forEach((line, l) => {
      if (line.includes(q)) found.push({ page: p + 1, line: l + 1 });
    });
  });
  return found;
}

/** Comme `findQuote`, sans tenir compte des espaces (codes de cours écrits avec ou sans espace). */
export function findCode(pages: string[][], code: string): { page: number; line: number }[] {
  const c = code.replace(/\s+/g, '');
  const found: { page: number; line: number }[] = [];
  if (c === '') return found;
  pages.forEach((lines, p) => {
    lines.forEach((line, l) => {
      if (line.replace(/\s+/g, '').includes(c)) found.push({ page: p + 1, line: l + 1 });
    });
  });
  return found;
}

/** Texte extrait, une ligne par ligne, préfixée par `p<page>:l<ligne>`. */
export function linesListing(pages: string[][]): string {
  return pages.flatMap((lines, p) => lines.map((line, l) => `p${p + 1}:l${l + 1} ${line}\n`)).join('');
}
