import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UNIVERSITY_FACTS, type Provenance, type University, type UniversityFact } from '../../shared/types.js';
import { findQuote, isSubstantialQuote, snapshotText } from './snapshotText.js';

export type FactStatus = 'inchangé' | 'déplacé' | 'introuvable' | 'copie_absente';

export interface RawCopy {
  path: string;
  contentType: string;
}

/** Cherche la copie brute `<sha256>.html|pdf` dans le magasin (un sous-dossier par source). */
export function findRawCopy(sha256: string, rawDir: string): RawCopy | null {
  if (!existsSync(rawDir)) return null;
  const dirs = [rawDir, ...readdirSync(rawDir).map((d) => join(rawDir, d)).filter((d) => statSync(d).isDirectory())];
  for (const dir of dirs) {
    for (const ext of ['html', 'pdf']) {
      const path = join(dir, `${sha256}.${ext}`);
      if (existsSync(path)) return { path, contentType: ext === 'pdf' ? 'application/pdf' : 'text/html' };
    }
  }
  return null;
}

type Located = { status: Exclude<FactStatus, 'copie_absente'>; found: { page: number; line: number } | null };

/** Compare la position annoncée d'un extrait à ce que le texte contient. */
function locateQuote(pages: string[][], p: { quote: string; locator: { page: number; line: number } }): Located {
  const hits = findQuote(pages, p.quote);
  if (hits.length === 0) return { status: 'introuvable', found: null };
  const same = hits.find((h) => h.page === p.locator.page && h.line === p.locator.line);
  return same ? { status: 'inchangé', found: same } : { status: 'déplacé', found: hits[0] };
}

const RANK: Record<Located['status'], number> = { inchangé: 0, déplacé: 1, introuvable: 2 };

/** Cherche l'extrait principal puis le contexte ; le statut est le pire des deux (introuvable > déplacé > inchangé). */
export function locateInPages(
  pages: string[][],
  p: Pick<Provenance, 'quote' | 'locator' | 'context'>,
): Located & { contextFound?: { page: number; line: number } | null } {
  const main = locateQuote(pages, p);
  if (!p.context) return main;
  const ctx = locateQuote(pages, p.context);
  return { status: RANK[ctx.status] > RANK[main.status] ? ctx.status : main.status, found: main.found, contextFound: ctx.found };
}

/** Un contexte n'est permis que sur une date, doit être un extrait valable et précéder l'extrait principal. */
export function contextProblem(fact: UniversityFact, p: Provenance): string | null {
  if (!p.context) return null;
  if (!/^terms\.(fall|spring)\./.test(fact)) return 'le contexte n’est permis que sur les dates des périodes';
  if (!isSubstantialQuote(p.context.quote)) return 'extrait de contexte trop court : au moins 8 caractères et 2 mots';
  const c = p.context.locator;
  const m = p.locator;
  if (!(c.page < m.page || (c.page === m.page && c.line < m.line))) return 'le contexte doit précéder l’extrait principal (page, ligne)';
  return null;
}

/** Hors ligne : relit la copie brute du fait et y cherche son extrait. */
export async function verifyProvenance(
  p: Provenance,
  rawDir: string,
): Promise<{ status: FactStatus; found: { page: number; line: number } | null; contextFound?: { page: number; line: number } | null }> {
  const copy = findRawCopy(p.sha256, rawDir);
  if (!copy) return { status: 'copie_absente', found: null };
  const pages = await snapshotText(readFileSync(copy.path), copy.contentType);
  return locateInPages(pages, p);
}

const filled = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

/** Faits non vides d'une université, dans l'ordre de `UNIVERSITY_FACTS`. */
export function filledFacts(u: University): UniversityFact[] {
  const value = (fact: UniversityFact): boolean => {
    switch (fact) {
      case 'name': return true;
      case 'city': return filled(u.city);
      case 'coordinates': return filled(u.lat) || filled(u.lng);
      case 'website': return filled(u.website);
      case 'catalogUrl': return filled(u.catalogUrl);
      case 'creditSystem': return filled(u.creditSystem);
      case 'contactHoursPerCredit': return filled(u.contactHoursPerCredit);
      case 'restrictions': return filled(u.restrictions);
      case 'exchangeContact': return filled(u.exchangeContact);
      case 'catalogPublic': return true;
      default: {
        const [, term, key] = fact.split('.') as ['terms', 'fall' | 'spring', 'start' | 'end' | 'examsEnd'];
        return filled(u.terms[term]?.[key]);
      }
    }
  };
  return UNIVERSITY_FACTS.filter(value);
}

/** Faits non vides sans source. */
export function missingProvenance(u: University): UniversityFact[] {
  return filledFacts(u).filter((f) => u.provenance[f] === undefined);
}

export interface FactProblem {
  universityId: string;
  fact: UniversityFact;
  status: 'introuvable' | 'copie_absente' | 'stale' | 'déplacé' | 'contexte_invalide';
  provenance: Provenance;
  /** Pour `contexte_invalide` : la règle non respectée. */
  detail?: string;
}

export interface MovedFact {
  universityId: string;
  fact: UniversityFact;
  from: Provenance['locator'];
  to: Provenance['locator'];
  /** Vrai quand c'est la position du contexte qui a bougé. */
  context?: true;
}

/** Hors ligne : faits introuvables, sans copie brute, marqués `stale` ou déplacés (position inexacte), et nombre de faits vérifiés. */
export async function verifyAll(
  universities: University[],
  rawDir: string,
): Promise<{ total: number; problems: FactProblem[] }> {
  const out = { total: 0, problems: [] as FactProblem[] };
  for (const u of universities) {
    for (const [fact, p] of Object.entries(u.provenance) as [UniversityFact, Provenance][]) {
      out.total++;
      if (p.stale) out.problems.push({ universityId: u.id, fact, status: 'stale', provenance: p });
      const invalid = contextProblem(fact, p);
      if (invalid) out.problems.push({ universityId: u.id, fact, status: 'contexte_invalide', provenance: p, detail: invalid });
      const { status } = await verifyProvenance(p, rawDir);
      if (status !== 'inchangé') out.problems.push({ universityId: u.id, fact, status, provenance: p });
    }
  }
  return out;
}
