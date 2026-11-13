import type { HostCourseOut, MatchOut, SiteData } from '../../../shared/siteData';
import type { CountryCode, HostTerm, Level, PolyTerm, University } from '../../../shared/types';

export const TERM_MAP: Record<PolyTerm, HostTerm> = { automne: 'fall', hiver: 'spring' };

export interface Candidate {
  match: MatchOut;
  course: HostCourseOut;
  termUnknown: boolean;
}

export interface PairResult {
  polySigle: string;
  best: Candidate | null;
  /** Au plus deux. */
  alternatives: Candidate[];
}

export interface RankedUniversity {
  university: University;
  covered: number;
  total: number;
  pairs: PairResult[];
  /** `catalogue_non_lu` : catalogue public dont aucun cours n'a été lu cette année (pages non enregistrées). */
  status: 'ok' | 'catalogue_non_public' | 'catalogue_non_lu';
}

const LEVEL_RANK: Record<Level, number> = { elevee: 2, moyenne: 1, faible: 0 };
const MAX_ALTERNATIVES = 2;

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    LEVEL_RANK[b.match.level] - LEVEL_RANK[a.match.level] ||
    b.match.contentScore - a.match.contentScore ||
    (a.course.code < b.course.code ? -1 : a.course.code > b.course.code ? 1 : 0)
  );
}

export function rankUniversities(input: {
  data: SiteData;
  countryCode: CountryCode;
  term: PolyTerm;
  selectedSigles: string[];
}): RankedUniversity[] {
  const { data, countryCode, term, selectedSigles } = input;
  const hostTerm = TERM_MAP[term];
  const comparable = new Set(data.polyCourses.filter((c) => c.compared).map((c) => c.sigle));
  const sigles = selectedSigles.filter((s) => comparable.has(s));
  const hostById = new Map(data.hostCourses.map((c) => [c.id, c]));
  const unread = new Set(data.meta.unreadCatalogs);

  const ranked = data.universities
    .filter((u) => u.countryCode === countryCode)
    .map((university): RankedUniversity => {
      const candidatesBySigle = new Map<string, Candidate[]>();
      for (const polySigle of sigles) {
        const candidates: Candidate[] = [];
        for (const match of data.matches) {
          if (match.polySigle !== polySigle) continue;
          const course = hostById.get(match.hostCourseId);
          if (!course || course.universityId !== university.id) continue;
          if (course.terms.length === 0) candidates.push({ match, course, termUnknown: true });
          else if (course.terms.includes(hostTerm)) candidates.push({ match, course, termUnknown: false });
        }
        candidates.sort(compareCandidates);
        candidatesBySigle.set(polySigle, candidates);
      }

      // Un cours d'accueil n'est attribué qu'à un seul cours de Poly : on attribue d'abord les meilleures paires.
      const all = sigles.flatMap((polySigle) => (candidatesBySigle.get(polySigle) ?? []).map((c) => ({ polySigle, c })));
      all.sort(
        (x, y) =>
          LEVEL_RANK[y.c.match.level] - LEVEL_RANK[x.c.match.level] ||
          y.c.match.contentScore - x.c.match.contentScore ||
          (x.polySigle < y.polySigle ? -1 : x.polySigle > y.polySigle ? 1 : 0) ||
          (x.c.course.code < y.c.course.code ? -1 : x.c.course.code > y.c.course.code ? 1 : 0),
      );
      const bestBySigle = new Map<string, Candidate>();
      const hostOwner = new Map<number, string>();
      for (const { polySigle, c } of all) {
        if (bestBySigle.has(polySigle) || hostOwner.has(c.course.id)) continue;
        bestBySigle.set(polySigle, c);
        hostOwner.set(c.course.id, polySigle);
      }

      const pairs = sigles.map((polySigle): PairResult => {
        const best = bestBySigle.get(polySigle) ?? null;
        const alternatives = (candidatesBySigle.get(polySigle) ?? [])
          .filter((c) => c !== best && !hostOwner.has(c.course.id))
          .slice(0, MAX_ALTERNATIVES);
        return { polySigle, best, alternatives };
      });
      return {
        university,
        covered: pairs.filter((p) => p.best !== null).length,
        total: sigles.length,
        pairs,
        status: !university.catalogPublic ? 'catalogue_non_public' : unread.has(university.id) ? 'catalogue_non_lu' : 'ok',
      };
    });

  const countLevel = (r: RankedUniversity, level: Level) => r.pairs.filter((p) => p.best?.match.level === level).length;
  return ranked.sort(
    (a, b) =>
      Number(a.status !== 'ok') - Number(b.status !== 'ok') ||
      b.covered - a.covered ||
      countLevel(b, 'elevee') - countLevel(a, 'elevee') ||
      countLevel(b, 'moyenne') - countLevel(a, 'moyenne') ||
      a.university.name.localeCompare(b.university.name, 'fr'),
  );
}
