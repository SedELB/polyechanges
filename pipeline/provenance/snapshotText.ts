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

/** Texte à plat d'un nœud : le contenu bloc et les `br` y sont séparés par une espace. */
function flatText(node: DomNode): string {
  if (node.type === 'text') return node.data ?? '';
  if (node.type !== 'tag') return '';
  const name = node.name?.toLowerCase() ?? '';
  if (SKIP.has(name)) return '';
  const inner = (node.children ?? []).map(flatText).join('');
  return name === 'br' || BLOCK.has(name) ? ` ${inner} ` : inner;
}

/** Une rangée de tableau en une ligne : ses cellules non vides, jointes par « | ». */
function rowLine(row: DomNode): string {
  const cells = (row.children ?? []).filter((c) => c.type === 'tag' && (c.name === 'td' || c.name === 'th'));
  return cells.map((c) => normalizeText(flatText(c))).filter((t) => t !== '').join(' | ');
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
    if (name === 'tr') {
      flush();
      current = rowLine(node);
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

/** Extrait assez précis pour être cherché : au moins 8 caractères et 2 mots, après normalisation. */
export function isSubstantialQuote(quote: string): boolean {
  const q = normalizeText(quote);
  return q.length >= 8 && q.split(' ').length >= 2;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Positions des lignes où le code apparaît comme mot entier (ni lettre ni chiffre de part et d'autre),
 * sans tenir compte des espaces à l'intérieur du code (codes écrits avec ou sans espace).
 */
export function findCode(pages: string[][], code: string): { page: number; line: number }[] {
  const chars = [...code.replace(/\s+/g, '')];
  const found: { page: number; line: number }[] = [];
  if (chars.length === 0) return found;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${chars.map(escapeRegex).join('\\s*')}(?![\\p{L}\\p{N}])`, 'u');
  pages.forEach((lines, p) => {
    lines.forEach((line, l) => {
      if (re.test(line)) found.push({ page: p + 1, line: l + 1 });
    });
  });
  return found;
}

/** Texte extrait, une ligne par ligne, préfixée par `p<page>:l<ligne>`. */
export function linesListing(pages: string[][]): string {
  return pages.flatMap((lines, p) => lines.map((line, l) => `p${p + 1}:l${l + 1} ${line}\n`)).join('');
}
