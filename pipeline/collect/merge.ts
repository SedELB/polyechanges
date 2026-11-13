import type { HostCourseInput, HostTerm } from '../../shared/types.js';

/** Un cours lu par une source, avec sa copie brute et la position de son code dans le texte de cette copie. */
export interface LocatedCourse {
  course: HostCourseInput;
  snapshotId: number | null;
  locator: { page: number; line: number } | null;
}

/** Les cours lus par une source d'une université, dans l'ordre du lecteur. */
export interface SourceCourses {
  sourceId: string;
  /** Plus grand = plus fiable pour les champs courts (défaut 0 dans la fiche). */
  priority: number;
  /** Source `enrich` : ne crée aucun code, complète seulement les codes des autres sources. */
  enrich: boolean;
  courses: LocatedCourse[];
}

export interface MergeResult {
  courses: LocatedCourse[];
  /** Pour chaque source `enrich` : ses codes absents des autres sources, donc ignorés. */
  ignored: { sourceId: string; codes: string[] }[];
}

const filled = (s: string | null): s is string => s !== null && s.trim() !== '';
/** Un titre écrit en coréen : il cède la place à un titre sans hangul d'une autre source. */
export const HANGUL = /[㄰-㆏가-힯]/;
const latin = (s: string | null): s is string => filled(s) && !HANGUL.test(s);

/** Le candidat au texte non vide le plus long ; à longueur égale, le premier (priorité la plus haute). */
function longest(candidates: LocatedCourse[], text: (c: HostCourseInput) => string | null): LocatedCourse | null {
  let best: LocatedCourse | null = null;
  let bestLength = 0;
  for (const c of candidates) {
    const value = text(c.course);
    if (filled(value) && value.trim().length > bestLength) {
      best = c;
      bestLength = value.trim().length;
    }
  }
  return best;
}

/** Fusionne les candidats d'un même code, rangés par priorité décroissante. */
function mergeOne(candidates: LocatedCourse[]): LocatedCourse {
  // Une seule source : le cours ressort tel quel (les universités à une seule fiche gardent leurs résultats).
  if (candidates.length === 1) return candidates[0];
  const first = candidates[0];
  const pick = <T>(get: (c: HostCourseInput) => T, has: (v: T) => boolean): T =>
    candidates.map((c) => get(c.course)).find(has) ?? get(first.course);
  // La description décide de l'adresse, de la copie brute et de la position ; sans description, la source prioritaire.
  const described = longest(candidates, (c) => c.description) ?? first;
  const outlined = longest(candidates, (c) => c.outline) ?? first;
  const terms: HostTerm[] = [];
  for (const c of candidates) for (const t of c.course.terms) if (!terms.includes(t)) terms.push(t);
  const course: HostCourseInput = {
    code: first.course.code,
    title: candidates.map((c) => c.course.title).find(latin) ?? pick((c) => c.title, filled),
    description: described.course.description,
    outline: outlined.course.outline,
    credits: pick((c) => c.credits, (v) => v !== null),
    contactHours: pick((c) => c.contactHours, (v) => v !== null),
    language: pick((c) => c.language, (v) => v !== 'unknown'),
    terms,
    level: first.course.level,
    sourceUrl: described.course.sourceUrl,
    ...(described.course.provenance ? { provenance: described.course.provenance } : {}),
  };
  return { course, snapshotId: described.snapshotId, locator: described.locator };
}

/**
 * Fusionne par code les cours des sources d'une université, données dans l'ordre de leurs fiches. Pour un même code :
 * titre (le premier sans hangul, à défaut le premier non vide), crédits, heures de contact et niveau de la source de plus haute priorité qui en a un (non vide) ; langue :
 * la première différente de `unknown` par priorité décroissante ; trimestres : l'union ; description et plan : le plus
 * long non vide, et la description apporte son adresse, sa copie brute et sa position. À priorité égale, la fiche
 * la plus tôt dans l'ordre l'emporte. Le choix d'un titre sans hangul vaut pour toutes les universités. Les codes suivent leur première apparition dans les sources non `enrich`.
 */
export function mergeCourses(sources: SourceCourses[]): MergeResult {
  const codes: string[] = [];
  const known = new Set<string>();
  for (const s of sources) {
    if (s.enrich) continue;
    for (const c of s.courses) {
      if (!known.has(c.course.code)) {
        known.add(c.course.code);
        codes.push(c.course.code);
      }
    }
  }
  const ignored = sources
    .filter((s) => s.enrich)
    .map((s) => ({ sourceId: s.sourceId, codes: s.courses.map((c) => c.course.code).filter((code) => !known.has(code)) }));

  const byPriority = sources.map((s, i) => ({ s, i })).sort((a, b) => b.s.priority - a.s.priority || a.i - b.i);
  const candidates = new Map<string, LocatedCourse[]>();
  for (const { s } of byPriority) {
    for (const c of s.courses) {
      if (!known.has(c.course.code)) continue;
      const list = candidates.get(c.course.code);
      if (list) list.push(c);
      else candidates.set(c.course.code, [c]);
    }
  }
  return { courses: codes.map((code) => mergeOne(candidates.get(code) ?? [])), ignored };
}
