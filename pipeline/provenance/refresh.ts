import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from '../db/open.js';
import type { PoliteFetcher } from '../fetch/politeFetch.js';
import { readSnapshot, takeSnapshot } from '../fetch/snapshots.js';
import { loadUniversities, syncUniversities } from '../partners/registry.js';
import type { Provenance, UniversityFact } from '../../shared/types.js';
import { snapshotText } from './snapshotText.js';
import { contextProblem, locateInPages, type FactStatus } from './verify.js';

export const factsSourceId = (universityId: string): string => `facts-${universityId}`;

/** Crée au besoin la ligne `sources` qui range les copies brutes des faits d'une université (lecteur `none`). */
export function ensureFactsSource(db: Db, universityId: string, url: string): string {
  const id = factsSourceId(universityId);
  db.prepare(
    `INSERT INTO sources (id, university_id, kind, url, reader) VALUES (?, ?, ?, ?, 'none')
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, universityId, /\.pdf(\?|#|$)/i.test(url) ? 'pdf' : 'html', url);
  return id;
}

export interface MissingFact {
  universityId: string;
  fact: UniversityFact;
  url: string;
  quote: string;
  nearest: string[];
  /** Adresse injoignable : pourquoi le fait n'a pas pu être confirmé. */
  error?: string;
}

export interface RefreshResult {
  counts: Record<FactStatus, number>;
  missing: MissingFact[];
  /** Adresses qui n'ont pas pu être téléchargées (leurs faits sont comptés `copie_absente`). */
  errors: string[];
}

const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** Les 3 lignes qui partagent le plus de mots avec l'ancien extrait. */
export function nearestLines(pages: string[][], quote: string): string[] {
  const q = words(quote);
  return pages
    .flat()
    .map((line, i) => ({ line, i, score: [...words(line)].filter((w) => q.has(w)).length }))
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3)
    .map((l) => l.line);
}

type RawUniversity = { id: string; provenance?: Partial<Record<UniversityFact, Provenance>> } & Record<string, unknown>;

/** Ordre de clés stable dans le fichier. */
const ordered = (p: Provenance, stale: boolean): Provenance => ({
  url: p.url,
  retrievedAt: p.retrievedAt,
  sha256: p.sha256,
  locator: { page: p.locator.page, line: p.locator.line },
  quote: p.quote,
  ...(p.context ? { context: { locator: { page: p.context.locator.page, line: p.context.locator.line }, quote: p.context.quote } } : {}),
  ...(stale ? { stale: true as const } : {}),
});

/**
 * En ligne : retélécharge chaque adresse distincte une seule fois et relit l'extrait de chaque fait.
 * `inchangé` / `déplacé` : empreinte, date et position sont mises à jour (la marque `stale` est levée).
 * `introuvable` : le fait garde sa valeur et sa copie, et reçoit `stale: true`. Réécrit le fichier des universités.
 */
export async function refreshFactSources(
  db: Db,
  fetcher: PoliteFetcher,
  universitiesPath: string,
  rawDir: string,
  now: string,
  only?: string,
): Promise<RefreshResult> {
  const registry = loadUniversities(universitiesPath);
  if (only !== undefined && !registry.some((u) => u.id === only)) throw new Error(`Université introuvable : ${only}`);
  syncUniversities(db, universitiesPath);
  const raw = JSON.parse(readFileSync(universitiesPath, 'utf8')) as RawUniversity[];

  const result: RefreshResult = {
    counts: { inchangé: 0, déplacé: 0, introuvable: 0, copie_absente: 0 },
    missing: [],
    errors: [],
  };
  const pagesByUrl = new Map<string, { sha256: string; pages: string[][] } | { error: string }>();
  let changed = false;

  for (const u of raw) {
    if ((only !== undefined && u.id !== only) || !u.provenance) continue;
    const next: Partial<Record<UniversityFact, Provenance>> = {};
    for (const [fact, p] of Object.entries(u.provenance) as [UniversityFact, Provenance][]) {
      if (!pagesByUrl.has(p.url)) {
        try {
          const snap = await takeSnapshot(db, fetcher, ensureFactsSource(db, u.id, p.url), p.url, rawDir);
          const pages = await snapshotText(readSnapshot(snap, rawDir), snap.contentType);
          pagesByUrl.set(p.url, { sha256: snap.sha256, pages });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          pagesByUrl.set(p.url, { error });
          result.errors.push(`${p.url} : ${error}`);
        }
      }
      const page = pagesByUrl.get(p.url);
      if (!page || 'error' in page) {
        // Le fait ne peut plus être confirmé : valeur et copie intactes, marqué périmé.
        result.counts.copie_absente++;
        next[fact] = ordered(p, true);
        result.missing.push({ universityId: u.id, fact, url: p.url, quote: p.quote, nearest: [], error: page?.error });
        continue;
      }
      const { status, found, contextFound } = locateInPages(page.pages, p);
      result.counts[status]++;
      const context = p.context && contextFound ? { ...p.context, locator: contextFound } : p.context;
      const updated: Provenance | null =
        status !== 'introuvable' && found ? { ...p, sha256: page.sha256, retrievedAt: now, locator: found, context } : null;
      // L'ordre est revérifié sur les positions recalées avant d'écrire quoi que ce soit.
      if (updated && contextProblem(fact, updated) === null) {
        next[fact] = ordered(updated, false);
      } else {
        next[fact] = ordered(p, true);
        // Chaque extrait perdu est nommé : l'extrait principal, le contexte, ou les deux.
        const lost = [...(found ? [] : [p.quote]), ...(p.context && !contextFound ? [p.context.quote] : [])];
        if (lost.length === 0) lost.push(p.context && updated ? p.context.quote : p.quote);
        for (const quote of lost) {
          result.missing.push({ universityId: u.id, fact, url: p.url, quote, nearest: nearestLines(page.pages, quote) });
        }
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(u.provenance)) {
      u.provenance = next;
      changed = true;
    }
  }
  if (changed) {
    // Écriture atomique : fichier temporaire dans le même dossier, puis renommage.
    const tmp = join(dirname(universitiesPath), `.${process.pid}-universities.tmp`);
    writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`);
    renameSync(tmp, universitiesPath);
    syncUniversities(db, universitiesPath);
  }
  return result;
}

/** Texte du rapport : les comptes, puis chaque fait introuvable avec son ancien extrait et les lignes proches. */
export function formatSourcesReport(date: string, r: RefreshResult): string {
  const out = [
    `Rafraîchissement des sources du ${date}`,
    `Inchangés : ${r.counts.inchangé}`,
    `Déplacés : ${r.counts.déplacé}`,
    `Introuvables : ${r.counts.introuvable}`,
    `Copies absentes : ${r.counts.copie_absente}`,
  ];
  for (const e of r.errors) out.push(`Échec de téléchargement : ${e}`);
  for (const m of r.missing) {
    out.push('', `${m.error === undefined ? 'Introuvable' : 'Non confirmé'} : ${m.universityId}, ${m.fact}`, `Adresse : ${m.url}`, `Ancien extrait : ${m.quote}`);
    if (m.error !== undefined) {
      out.push(`Erreur : ${m.error}`);
      continue;
    }
    out.push('Lignes proches :');
    if (m.nearest.length === 0) out.push('  (aucune)');
    for (const l of m.nearest) out.push(`  - ${l}`);
  }
  return `${out.join('\n')}\n`;
}

export function writeSourcesReport(dir: string, date: string, r: RefreshResult): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${date}-sources.txt`);
  writeFileSync(path, formatSourcesReport(date, r));
  return path;
}
