import { describe, expect, it } from 'vitest';
import type { HostCourseOut } from '../../../shared/siteData';
import type { PolyCourse } from '../../../shared/types';
import { fixtureData } from '../test/fixtures';
import { buildContractDraft, manualPolyCode, type ManualEntry } from './contract';
import type { PairResult } from './rank';

const meta = fixtureData.meta;
const ntu = fixtureData.universities.find((u) => u.id === 'ntu-tw')!; // local, 18 h par crédit
const nycu = fixtureData.universities.find((u) => u.id === 'nycu-tw')!; // ECTS

function poly(sigle: string, credits = 3): PolyCourse {
  return { ...fixtureData.polyCourses[0]!, sigle, title: `Titre ${sigle}`, credits, triplet: [3, 2, 4] };
}
function host(id: number, code: string, universityId: string, credits: number | null, contactHours: number | null = null): HostCourseOut {
  return { ...fixtureData.hostCourses[0]!, id, code, title: `Cours ${code}`, universityId, credits, contactHours };
}
function pair(polySigle: string, course: HostCourseOut | null): PairResult {
  return {
    polySigle,
    best: course && {
      course,
      termUnknown: false,
      match: { polySigle, hostCourseId: course.id, notionsFound: [], notionsMissing: [], contentScore: 1, workload: 'conforme', level: 'elevee', textUsed: 'description' },
    },
    alternatives: [],
  };
}
const manual = (kind: ManualEntry['kind'], polyCredits: number, hostCode = 'X1'): ManualEntry => ({
  kind,
  hostCode,
  hostTitle: 'Titre',
  hostCredits: polyCredits,
  polyCredits,
});

describe('manualPolyCode', () => {
  it('code les cours ajoutés à la main', () => {
    expect(manualPolyCode({ kind: 'orientation', hostCode: 'CSIE5001', hostTitle: 'X', hostCredits: 3, polyCredits: 3 })).toBe('ING5003');
    expect(manualPolyCode({ kind: 'hors_genie', hostCode: 'CHN101', hostTitle: 'Mandarin', hostCredits: 2, polyCredits: 2 })).toBe('SSH5002');
  });
});

describe('buildContractDraft', () => {
  const polyCourses = [poly('INF3710'), poly('LOG3430')];
  const pairs = [pair('INF3710', host(1, 'A1', 'ntu-tw', 3)), pair('LOG3430', host(2, 'A2', 'ntu-tw', 3))];

  it('construit les lignes appariées, sans les paires sans candidat', () => {
    const d = buildContractDraft({ university: ntu, pairs: [...pairs, pair('INF3405', null)], polyCourses, manual: [], meta });
    expect(d.rows.map((r) => [r.hostCode, r.polyCode, r.polyCredits, r.manual])).toEqual([
      ['A1', 'INF3710', 3, false],
      ['A2', 'LOG3430', 3, false],
    ]);
    expect(d.totalPolyCredits).toBe(6);
  });

  it('avertit sous 12 crédits et au-delà de 6 crédits hors génie', () => {
    const few = buildContractDraft({ university: ntu, pairs, polyCourses, manual: [], meta });
    expect(few.warnings).toContain('Moins de 12 crédits Poly : temps plein non atteint');
    expect(few.warnings).not.toContain('Les cours ajoutés à la main ne sont pas inclus dans la vérification de charge');
    const d = buildContractDraft({ university: ntu, pairs, polyCourses, manual: [manual('hors_genie', 4), manual('hors_genie', 3)], meta });
    expect(d.totalPolyCredits).toBe(13);
    expect(d.warnings).toContain('Plus de 6 crédits hors génie (SSH500x)');
    expect(d.warnings).toContain('Les cours ajoutés à la main ne sont pas inclus dans la vérification de charge');
    expect(d.warnings).not.toContain('Moins de 12 crédits Poly : temps plein non atteint');
  });

  it('vérifie la charge totale des lignes appariées', () => {
    const d = buildContractDraft({ university: ntu, pairs, polyCourses, manual: [], meta });
    expect(d.workloadTotal).toBe('trop_legere');
    expect(d.explanation).toMatchObject({ kind: 'heures', expected: 130, actual: 108, gap: -0.169 });
  });

  it('ne compte jamais deux fois le même cours d’accueil', () => {
    const shared = host(1, 'A1', 'ntu-tw', 3);
    const d = buildContractDraft({ university: ntu, pairs: [pair('INF3710', shared), pair('LOG3430', shared)], polyCourses, manual: [], meta });
    expect(d.rows.filter((r) => !r.manual).map((r) => r.hostCode)).toEqual(['A1']);
    expect(d.totalPolyCredits).toBe(3);
  });

  it('ECTS : somme des crédits d’accueil contre 2 × crédits Poly', () => {
    const e = [pair('INF3710', host(7, 'D1', 'nycu-tw', 6)), pair('LOG3430', host(8, 'D2', 'nycu-tw', 6))];
    const d = buildContractDraft({ university: nycu, pairs: e, polyCourses, manual: [], meta });
    expect(d.workloadTotal).toBe('conforme');
    expect(d.explanation).toMatchObject({ kind: 'ECTS', expected: 12, actual: 12 });
  });

  it('charge inconnue si une donnée manque ou sans paire', () => {
    const p = [pair('INF3710', host(1, 'A1', 'ntu-tw', null))];
    expect(buildContractDraft({ university: ntu, pairs: p, polyCourses, manual: [], meta }).workloadTotal).toBe('inconnue');
    expect(buildContractDraft({ university: ntu, pairs: [], polyCourses, manual: [], meta }).workloadTotal).toBe('inconnue');
  });
});
