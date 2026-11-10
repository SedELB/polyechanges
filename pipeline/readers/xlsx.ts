import { inflateRawSync } from 'node:zlib';

export interface Sheet {
  name: string;
  /** Cellules par rangée, indexées par colonne (A = 0) ; `undefined` pour une cellule vide. */
  rows: (string | undefined)[][];
}

interface ZipEntry {
  name: string;
  method: number;
  compressed: Buffer;
}

/** Entrées d'un fichier zip, lues dans son répertoire central. */
function zipEntries(buf: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Fichier zip invalide');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Répertoire central invalide');
    const method = buf.readUInt16LE(pos + 10);
    const size = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    entries.set(name, { name, method, compressed: buf.subarray(dataAt, dataAt + size) });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Taille maximale d'une partie décompressée : un classeur corrompu ou hostile ne doit pas saturer la mémoire. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

function textOf(entries: Map<string, ZipEntry>, name: string, maxBytes: number): string {
  const e = entries.get(name);
  if (!e) throw new Error(`Partie absente du classeur : ${name}`);
  const tooBig = () => new Error(`Partie du classeur trop volumineuse une fois décompressée (plus de ${maxBytes} octets) : ${name}`);
  if (e.method === 0) {
    if (e.compressed.length > maxBytes) throw tooBig();
    return e.compressed.toString('utf8');
  }
  if (e.method === 8) {
    try {
      return inflateRawSync(e.compressed, { maxOutputLength: maxBytes }).toString('utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw tooBig();
      throw err;
    }
  }
  throw new Error(`Méthode de compression non prise en charge : ${e.method}`);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Feuilles d'un classeur .xlsx (texte et nombres tels qu'écrits ; les formules ne sont pas évaluées). */
export function readXlsx(buf: Buffer, maxEntryBytes = MAX_ENTRY_BYTES): Sheet[] {
  const entries = zipEntries(buf);
  const shared = entries.has('xl/sharedStrings.xml')
    ? [...textOf(entries, 'xl/sharedStrings.xml', maxEntryBytes).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        unescapeXml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
      )
    : [];
  const rels = new Map<string, string>();
  for (const m of textOf(entries, 'xl/_rels/workbook.xml.rels', maxEntryBytes).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0]!)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(m[0]!)?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const sheets: Sheet[] = [];
  for (const m of textOf(entries, 'xl/workbook.xml', maxEntryBytes).matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(m[0]!)?.[1] ?? '');
    const rid = /\br:id="([^"]*)"/.exec(m[0]!)?.[1] ?? '';
    const path = rels.get(rid);
    if (!path) continue;
    const rows: (string | undefined)[][] = [];
    for (const r of textOf(entries, path, maxEntryBytes).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: (string | undefined)[] = [];
      for (const c of r[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const body = c[3] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const inline = /<is>[\s\S]*?<\/is>/.exec(body);
        let value: string | undefined;
        if (/\bt="s"/.test(c[2]!)) value = v === undefined ? undefined : shared[Number(v)];
        else if (inline) value = unescapeXml([...inline[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else value = v === undefined ? undefined : unescapeXml(v);
        row[columnIndex(c[1]!)] = value;
      }
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
