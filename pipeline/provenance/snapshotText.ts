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

/**
 * Texte brut : une ligne du fichier = une ligne extraite (normalisée, lignes vides gardées pour que la position
 * soit celle du fichier), sur une seule page. Le saut de ligne final ne compte pas pour une ligne.
 */
function plainLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r?\n$/, '').split(/\r\n|\n|\r/).map(normalizeText);
}

/**
 * Texte d'un fichier texte brut : UTF-16 LE quand il commence par sa marque d'ordre (FF FE, « Texte Unicode »
 * d'Excel), UTF-8 sinon. À utiliser aussi par les lecteurs de `.txt`.
 */
export function decodeText(body: Buffer): string {
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) return body.subarray(2).toString('utf16le');
  return body.toString('utf8');
}

/** Texte d'une copie brute : pages, puis lignes (une seule page pour du HTML ou du texte brut). */
export async function snapshotText(body: Buffer, contentType: string): Promise<string[][]> {
  const type = contentType.toLowerCase();
  if (type.includes('pdf')) {
    const pdf = await getDocumentProxy(new Uint8Array(body));
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((page) => page.split(/\r?\n/).map(normalizeText).filter((l) => l !== ''));
  }
  if (type.includes('text/plain')) return [plainLines(decodeText(body))];
  return [htmlLines(body.toString('utf8'))];
}

/** Nombre maximal de lignes consécutives d'une même page qu'un extrait peut couvrir. */
export const MAX_QUOTE_LINES = 3;

export interface QuoteSpan {
  page: number;
  line: number;
  lines: number;
}

/**
 * Positions (1-based) où l'extrait apparaît, après la même normalisation : d'abord dans une seule ligne ; à
 * défaut dans 2 lignes consécutives d'une même page (jointes par une espace), puis dans 3. Seule la plus petite
 * fenêtre qui réussit est renvoyée ; `line` est la première ligne de la fenêtre, `lines` sa taille.
 */
export function findQuoteSpans(pages: string[][], quote: string): QuoteSpan[] {
  const q = normalizeText(quote);
  if (q === '') return [];
  for (let size = 1; size <= MAX_QUOTE_LINES; size++) {
    const found: QuoteSpan[] = [];
    pages.forEach((lines, p) => {
      for (let l = 0; l + size <= lines.length; l++) {
        const text = size === 1 ? lines[l] : lines.slice(l, l + size).join(' ');
        if (text.includes(q)) found.push({ page: p + 1, line: l + 1, lines: size });
      }
    });
    if (found.length > 0) return found;
  }
  return [];
}

/** Positions de départ (page, ligne) de l'extrait, selon la règle de `findQuoteSpans`. */
export function findQuote(pages: string[][], quote: string): { page: number; line: number }[] {
  return findQuoteSpans(pages, quote).map(({ page, line }) => ({ page, line }));
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
