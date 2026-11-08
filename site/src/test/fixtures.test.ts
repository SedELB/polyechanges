import { describe, expect, it } from 'vitest';
import type { ContentBand, Level, Workload } from '../../../shared/types';
import { checkWorkload, hostContactHours, round3 } from '../../../shared/workload';
import { fixtureData } from './fixtures';

const BAND_HIGH = 0.7;
const BAND_LOW = 0.4;

function band(score: number): ContentBand {
  return score >= BAND_HIGH ? 'tres' : score >= BAND_LOW ? 'partiel' : 'aucun';
}

function level(b: ContentBand, workload: Workload): Level | null {
  if (b === 'aucun') return null;
  if (workload === 'conforme') return b === 'tres' ? 'elevee' : 'moyenne';
  return b === 'tres' ? 'moyenne' : 'faible';
}

const { meta, universities, polyCourses, hostCourses, matches } = fixtureData;

describe('fixtureData', () => {
  it.each(matches.map((m) => [`${m.polySigle} / cours ${m.hostCourseId}`, m] as const))(
    'correspondance %s cohérente avec les règles du pipeline',
    (_name, m) => {
      const host = hostCourses.find((h) => h.id === m.hostCourseId)!;
      const uni = universities.find((u) => u.id === host.universityId)!;
      const poly = polyCourses.find((p) => p.sigle === m.polySigle)!;

      const score = round3(m.notionsFound.length / (m.notionsFound.length + m.notionsMissing.length));
      expect(m.contentScore).toBe(score);

      const workload =
        uni.creditSystem === 'ECTS'
          ? checkWorkload({ system: 'ECTS', hostEcts: host.credits, polyCredits: poly.credits }, meta.workloadTolerance)
          : checkWorkload(
              {
                system: 'local',
                hostContactHours: hostContactHours(host, uni.contactHoursPerCredit),
                polyTriplet: poly.triplet,
                polyWeeks: meta.polyWeeks,
              },
              meta.workloadTolerance,
            );
      expect(m.workload).toBe(workload);
      expect(m.level).toBe(level(band(score), workload));
    },
  );

  it('contient chaque cas particulier une seule fois', () => {
    expect(matches.filter((m) => m.workload === 'trop_legere')).toHaveLength(1);
    expect(hostCourses.filter((h) => h.terms.length === 0)).toHaveLength(1);
    expect(hostCourses.filter((h) => h.language === 'unknown')).toHaveLength(1);
    expect(hostCourses.filter((h) => h.terms.length === 1 && h.terms[0] === 'spring')).toHaveLength(1);
    expect(matches.some((m) => m.polySigle === 'INF2610')).toBe(false);
    expect(hostCourses.filter((h) => h.universityId === 'ntu-tw').every((h) => h.collectedAt === '2026-11-20')).toBe(true);
  });

  it('couverture de INF3710 + LOG3430 en automne : ntu 2, nycu 1, ncku 0', () => {
    const covered = (universityId: string) =>
      ['INF3710', 'LOG3430'].filter((sigle) =>
        matches.some((m) => {
          const h = hostCourses.find((c) => c.id === m.hostCourseId)!;
          return m.polySigle === sigle && h.universityId === universityId && h.terms.includes('fall') && h.language === 'en';
        }),
      ).length;
    expect(covered('ntu-tw')).toBe(2);
    expect(covered('nycu-tw')).toBe(1);
    expect(covered('ncku-tw')).toBe(0);
  });
});
