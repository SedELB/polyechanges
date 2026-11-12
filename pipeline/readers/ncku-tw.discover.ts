// Écrit la liste `urls` de data/sources/ncku-tw-syllabus.json à partir des liens « Syllabus » des rangées retenues
// dans les pages enregistrées (data/sources/ncku-tw.json). Aucune requête réseau.
// À relancer après un nouvel enregistrement des pages : npx tsx pipeline/readers/ncku-tw.discover.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isKept, parseRows } from './ncku-tw.js';

/** Adresses des plans de cours des rangées retenues, sans doublon, dans l'ordre des pages. */
export function syllabusUrls(htmls: string[]): string[] {
  const urls: string[] = [];
  for (const html of htmls) {
    for (const row of parseRows(html)) {
      if (!isKept(row) || !row.syllabusUrl) continue;
      if (!urls.includes(row.syllabusUrl)) urls.push(row.syllabusUrl);
    }
  }
  return urls;
}

function main(): void {
  const main = JSON.parse(readFileSync('data/sources/ncku-tw.json', 'utf8')) as { files: string[] };
  const urls = syllabusUrls(main.files.map((f) => readFileSync(f, 'utf8')));
  const source = { id: 'ncku-tw-syllabus', universityId: 'ncku-tw', kind: 'html', urls, reader: 'ncku-tw-syllabus', role: 'enrich' };
  writeFileSync('data/sources/ncku-tw-syllabus.json', `${JSON.stringify(source, null, 2)}\n`);
  console.log(`${urls.length} plans de cours écrits dans data/sources/ncku-tw-syllabus.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
