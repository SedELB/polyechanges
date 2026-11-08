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
  status: 'ok' | 'catalogue_non_public';
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

  const ranked = data.universities
    .filter((u) => u.countryCode === countryCode)
    .map((university): RankedUniversity => {
      const pairs = sigles.map((polySigle): PairResult => {
        const candidates: Candidate[] = [];
        for (const match of data.matches) {
          if (match.polySigle !== polySigle) continue;
          const course = hostById.get(match.hostCourseId);
          if (!course || course.universityId !== university.id) continue;
          if (course.terms.length === 0) candidates.push({ match, course, termUnknown: true });
          else if (course.terms.includes(hostTerm)) candidates.push({ match, course, termUnknown: false });
        }
        candidates.sort(compareCandidates);
        return { polySigle, best: candidates[0] ?? null, alternatives: candidates.slice(1, 1 + MAX_ALTERNATIVES) };
      });
      return {
        university,
        covered: pairs.filter((p) => p.best !== null).length,
        total: sigles.length,
        pairs,
        status: university.catalogPublic ? 'ok' : 'catalogue_non_public',
      };
    });

  const countLevel = (r: RankedUniversity, level: Level) => r.pairs.filter((p) => p.best?.match.level === level).length;
  return ranked.sort(
    (a, b) =>
      Number(a.status === 'catalogue_non_public') - Number(b.status === 'catalogue_non_public') ||
      b.covered - a.covered ||
      countLevel(b, 'elevee') - countLevel(a, 'elevee') ||
      countLevel(b, 'moyenne') - countLevel(a, 'moyenne') ||
      a.university.name.localeCompare(b.university.name, 'fr'),
  );
}
