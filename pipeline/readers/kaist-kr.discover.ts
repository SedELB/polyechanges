// Régénère la liste `urls` de data/sources/kaist-kr.json : les deux pages d'informatique et toutes les pages des
// listes de génie électrique (le nombre de pages est lu sur la page 1). À lancer à la main :
// npx tsx pipeline/readers/kaist-kr.discover.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';
import { electricalPageCount } from './kaist-kr.js';

export const COMPUTING_URLS = ['https://cs.kaist.ac.kr/education/undergraduate', 'https://cs.kaist.ac.kr/education/graduate'];
export const ELECTRICAL_LISTS = ['https://ee.kaist.ac.kr/en/under-curr-list', 'https://ee.kaist.ac.kr/en/graduate-curr-list'];

export function listPageUrl(list: string, page: number): string {
  return `${list}?page=${page}`;
}

/** Adresses des pages d'une liste de génie électrique, de 1 à `pages`. */
export function electricalUrls(list: string, pages: number): string[] {
  return Array.from({ length: pages }, (_, i) => listPageUrl(list, i + 1));
}

export async function discoverUrls(fetcher: PoliteFetcher): Promise<string[]> {
  const urls = [...COMPUTING_URLS];
  for (const list of ELECTRICAL_LISTS) {
    const first = await fetcher.get(listPageUrl(list, 1));
    urls.push(...electricalUrls(list, electricalPageCount(new TextDecoder('utf-8').decode(first.body))));
  }
  return urls;
}

async function main(): Promise<void> {
  const path = 'data/sources/kaist-kr.json';
  const urls = await discoverUrls(createPoliteFetcher());
  const source = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { id: 'kaist-kr', universityId: 'kaist-kr', kind: 'html', urls: [], reader: 'kaist-kr' };
  source.urls = urls;
  writeFileSync(path, JSON.stringify(source, null, 2) + '\n');
  console.log(`${urls.length} adresses écrites dans ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
