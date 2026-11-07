import type { PoliteFetcher } from '../fetch/politeFetch.js';
import type { CountryCode, University } from '../../shared/types.js';

export const MOVEON_COUNTRY_IDS: Record<CountryCode, number> = { CN: 44, JP: 108, KR: 115, TW: 215 };

export const MOVEON_REPORT_URL = 'https://polymtl.adv-pub.moveonca.com/report-page-3030/';

export interface MoveOnPartner {
  countryCode: CountryCode;
  moveOnName: string;
  lat: number;
  lng: number;
}

/** Espaces insécables en espaces, espaces multiples en un seul, bords retirés. */
export function normalizeName(name: string): string {
  return name.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Extrait l'objet JSON de la première occurrence de `var jsonData = {...};`. */
function extractJsonData(html: string): string {
  const marker = /var\s+jsonData\s*=\s*/.exec(html);
  if (!marker) throw new Error('Rapport MoveOn illisible : « var jsonData » est introuvable');
  const start = marker.index + marker[0].length;
  if (html[start] !== '{') throw new Error("Rapport MoveOn illisible : jsonData n'est pas un objet");
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('Rapport MoveOn illisible : jsonData est tronqué');
}

interface RawEntry {
  flagname?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

export function parseMoveOnReport(html: string, countryCode: CountryCode): MoveOnPartner[] {
  const data = JSON.parse(extractJsonData(html)) as { labelvalue?: RawEntry[] };
  if (!Array.isArray(data.labelvalue)) throw new Error('Rapport MoveOn illisible : labelvalue est absent');
  return data.labelvalue.map((e) => {
    if (typeof e.flagname !== 'string') throw new Error('Rapport MoveOn illisible : flagname manquant');
    const lat = Number(e.latitude);
    const lng = Number(e.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`Rapport MoveOn illisible : coordonnées invalides pour ${e.flagname}`);
    }
    const full = normalizeName(e.flagname);
    const sep = full.indexOf(' - ');
    const moveOnName = sep >= 0 ? full.slice(sep + 3).trim() : full;
    return { countryCode, moveOnName, lat, lng };
  });
}

export async function fetchMoveOnPartners(fetcher: PoliteFetcher): Promise<MoveOnPartner[]> {
  const partners: MoveOnPartner[] = [];
  for (const [code, id] of Object.entries(MOVEON_COUNTRY_IDS) as [CountryCode, number][]) {
    const res = await fetcher.post(MOVEON_REPORT_URL, {
      publisher_id: '10',
      country_id: String(id),
      keyword: '',
    });
    partners.push(...parseMoveOnReport(res.body.toString('utf8'), code));
  }
  return partners;
}

/** `missing` : dans le registre mais absents de MoveOn. `unknown` : dans MoveOn mais absents du registre. */
export function diffPartners(
  registry: University[],
  live: MoveOnPartner[],
): { missing: string[]; unknown: string[] } {
  const registryNames = new Set(registry.map((u) => normalizeName(u.moveOnName)));
  const liveNames = new Set(live.map((p) => normalizeName(p.moveOnName)));
  return {
    missing: [...registryNames].filter((n) => !liveNames.has(n)).sort(),
    unknown: [...liveNames].filter((n) => !registryNames.has(n)).sort(),
  };
}
