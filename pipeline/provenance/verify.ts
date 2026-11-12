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

/** Nature de la copie brute : la règle de placement du contexte en dépend. `null` : copie inconnue, ordre non jugé. */
export type RawKind = 'html' | 'pdf' | null;

export const rawKind = (contentType: string): 'html' | 'pdf' => (/pdf/i.test(contentType) ? 'pdf' : 'html');

type Pos = { page: number; line: number };

/**
 * Règle unique de placement du contexte. HTML (une page) : il précède l'extrait principal. PDF : le titre est
 * souvent extrait après les événements, donc il peut être n'importe où sur la page de l'extrait principal
 * (hors sa propre ligne) ou sur une page antérieure.
 */
function contextAllowed(kind: RawKind, c: Pos, m: Pos): boolean {
  if (kind === null) return true;
  if (c.page < m.page) return true;
  if (c.page > m.page) return false;
  return kind === 'pdf' ? c.line !== m.line : c.line < m.line;
}

/** Parmi les occurrences admissibles, celle que retient la relocalisation (HTML : la dernière avant ; PDF : la plus proche sur la page, sinon la dernière d'une page antérieure). */
function pickContext(hits: Pos[], kind: RawKind, m: Pos): Pos | null {
  const ok = hits.filter((h) => contextAllowed(kind, h, m));
  if (kind === 'pdf') {
    const same = ok.filter((h) => h.page === m.page);
    if (same.length > 0) {
      return same.reduce((best, h) => {
        const d = Math.abs(h.line - m.line);
        const bd = Math.abs(best.line - m.line);
        return d < bd || (d === bd && h.line < best.line) ? h : best;
      });
    }
  }
  return ok[ok.length - 1] ?? null;
}

/** Cherche l'extrait principal puis chaque contexte ; le statut est le pire de tous (introuvable > déplacé > inchangé). */
export function locateInPages(
  pages: string[][],
  p: Pick<Provenance, 'quote' | 'locator' | 'context'>,
  kind: RawKind = 'html',
): Located & { contextFound?: (Pos | null)[]; contextMisplaced?: true } {
  const main = locateQuote(pages, p);
  if (!p.context) return main;
  let status = main.status;
  let misplaced = false;
  const contextFound = p.context.map((c) => {
    const hits = findQuote(pages, c.quote);
    const hit = pickContext(hits, kind, main.found ?? p.locator);
    const s: Located['status'] = !hit
      ? 'introuvable'
      : hit.page === c.locator.page && hit.line === c.locator.line ? 'inchangé' : 'déplacé';
    if (RANK[s] > RANK[status]) status = s;
    if (!hit && hits.length > 0) misplaced = true;
    return hit;
  });
  return { status, found: main.found, contextFound, ...(misplaced ? { contextMisplaced: true as const } : {}) };
}

/** Un contexte (un ou deux extraits) n'est permis que sur une date ; chaque extrait est valable et bien placé par rapport à l'extrait principal. */
export function contextProblem(fact: UniversityFact, p: Provenance, kind: RawKind = 'html'): string | null {
  if (!p.context) return null;
  if (!/^terms.(fall|spring)./.test(fact)) return 'le contexte n’est permis que sur les dates des périodes';
  if (p.context.length < 1) return 'le contexte doit contenir au moins un extrait';
  if (p.context.length > 2) return 'le contexte contient au plus deux extraits';
  const m = p.locator;
  for (const { quote, locator: c } of p.context) {
    if (!isSubstantialQuote(quote)) return 'extrait de contexte trop court : au moins 8 caractères et 2 mots';
    if (!contextAllowed(kind, c, m)) {
      return kind === 'pdf'
        ? 'le contexte doit être sur la page de l’extrait principal ou sur une page antérieure'
        : 'le contexte doit précéder l’extrait principal (page, ligne)';
    }
  }
  return null;
}

/** Hors ligne : relit la copie brute du fait et y cherche son extrait. */
export async function verifyProvenance(
  p: Provenance,
  rawDir: string,
): Promise<{ status: FactStatus; found: { page: number; line: number } | null; contextFound?: (Pos | null)[]; contextMisplaced?: true }> {
  const copy = findRawCopy(p.sha256, rawDir);
  if (!copy) return { status: 'copie_absente', found: null };
  const pages = await snapshotText(readFileSync(copy.path), copy.contentType);
  return locateInPages(pages, p, rawKind(copy.contentType));
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
      const copy = findRawCopy(p.sha256, rawDir);
      const invalid = contextProblem(fact, p, copy ? rawKind(copy.contentType) : null);
      if (invalid) out.problems.push({ universityId: u.id, fact, status: 'contexte_invalide', provenance: p, detail: invalid });
      const { status, contextMisplaced } = await verifyProvenance(p, rawDir);
      if (contextMisplaced) {
        out.problems.push({ universityId: u.id, fact, status: 'contexte_invalide', provenance: p, detail: 'aucune occurrence du contexte à un endroit admis par rapport à l’extrait principal' });
      } else if (status !== 'inchangé') out.problems.push({ universityId: u.id, fact, status, provenance: p });
    }
  }
  return out;
}
