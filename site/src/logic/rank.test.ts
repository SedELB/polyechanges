import { describe, expect, it } from 'vitest';
import { fixtureData } from '../test/fixtures';
import { TERM_MAP, rankUniversities } from './rank';
import { departureYear } from './termDates';

const base = { data: fixtureData, countryCode: 'TW' as const, term: 'automne' as const };

describe('rankUniversities', () => {
  it('associe les trimestres de Poly à ceux des universités', () => {
    expect(TERM_MAP).toEqual({ automne: 'fall', hiver: 'spring' });
  });

  it('classe par cours couverts, catalogue non public en dernier', () => {
    const r = rankUniversities({ ...base, selectedSigles: ['INF3710', 'LOG3430'] });
    expect(r.map((u) => [u.university.id, u.covered])).toEqual([
      ['ntu-tw', 2],
      ['nycu-tw', 1],
      ['ncku-tw', 0],
    ]);
    expect(r.at(-1)!.status).toBe('catalogue_non_public');
    expect(r[0].total).toBe(2);
  });

  it('ne compte que les cours choisis et comparés', () => {
    const r = rankUniversities({ ...base, selectedSigles: ['INF3710', 'LOG3900', 'SSH3501'] });
    expect(r[0].total).toBe(1);
    expect(r[0].pairs.map((p) => p.polySigle)).toEqual(['INF3710']);
  });

  it('garde un cours sans trimestre et le signale', () => {
    const r = rankUniversities({ ...base, term: 'hiver', selectedSigles: ['LOG3430'] });
    const pair = r.find((u) => u.university.id === 'ntu-tw')!.pairs[0];
    expect(pair.best?.course.code).toBe('CSIE3030');
    expect(pair.best?.termUnknown).toBe(true);
  });

  it('range le cours sans trimestre en alternative en automne', () => {
    const r = rankUniversities({ ...base, selectedSigles: ['LOG3430'] });
    const pair = r[0].pairs[0];
    expect(pair.best?.course.code).toBe('CSIE3020');
    expect(pair.best?.termUnknown).toBe(false);
    expect(pair.alternatives.map((c) => [c.course.code, c.termUnknown])).toEqual([['CSIE3030', true]]);
  });

  it('écarte un cours offert seulement au printemps pour un départ en automne', () => {
    const fall = rankUniversities({ ...base, selectedSigles: ['INF3710'] });
    const ntuFall = fall.find((u) => u.university.id === 'ntu-tw')!.pairs[0];
    expect([ntuFall.best, ...ntuFall.alternatives].map((c) => c?.course.code)).toEqual(['CSIE3010']);

    const spring = rankUniversities({ ...base, term: 'hiver', selectedSigles: ['INF3710'] });
    const ntuSpring = spring.find((u) => u.university.id === 'ntu-tw')!.pairs[0];
    expect(ntuSpring.best?.course.code).toBe('CSIE3040');
  });

  it('un cours sans équivalent laisse la paire non couverte', () => {
    const r = rankUniversities({ ...base, countryCode: 'JP', selectedSigles: ['INF2610'] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ covered: 0, total: 1, status: 'ok' });
    expect(r[0].pairs[0].best).toBeNull();
  });

  it('départage par niveau puis par code et limite les alternatives à deux', () => {
    const extras = [90, 91, 92].map((id, i) => ({ ...fixtureData.hostCourses[0], id, code: `AAA${i + 1}` }));
    const m = fixtureData.matches[0];
    const data = {
      ...fixtureData,
      hostCourses: [...fixtureData.hostCourses, ...extras],
      matches: [...fixtureData.matches, ...extras.map((c) => ({ ...m, hostCourseId: c.id }))],
    };
    const pair = rankUniversities({ data, countryCode: 'TW', term: 'automne', selectedSigles: ['INF3710'] })[0].pairs[0];
    expect(pair.best?.course.code).toBe('AAA1');
    expect(pair.alternatives.map((c) => c.course.code)).toEqual(['AAA2', 'AAA3']);
  });
});

describe('departureYear', () => {
  it.each([
    ['2026-03-01', 2026, 2027],
    ['2026-11-10', 2027, 2028],
    ['2026-12-31', 2027, 2028],
    ['2027-01-15', 2027, 2028],
    ['2027-09-01', 2028, 2029],
  ])('le %s : automne %i, hiver %i', (day, fall, winter) => {
    expect(departureYear('automne', new Date(day + 'T12:00:00'))).toBe(fall);
    expect(departureYear('hiver', new Date(day + 'T12:00:00'))).toBe(winter);
  });
});

describe('un cours d’accueil pour un seul cours de Poly', () => {
  // CSIE3010 (id 1) est le meilleur candidat de INF3710 ; on en fait aussi le meilleur de LOG3430 (même niveau et même score : INF3710 passe avant par son sigle).
  const m = fixtureData.matches.find((x) => x.polySigle === 'INF3710' && x.hostCourseId === 1)!;
  const data = {
    ...fixtureData,
    matches: [...fixtureData.matches, { ...m, polySigle: 'LOG3430', hostCourseId: 1, contentScore: 1 }],
  };
  const ntu = (sigles: string[]) =>
    rankUniversities({ data, countryCode: 'TW', term: 'automne', selectedSigles: sigles }).find((u) => u.university.id === 'ntu-tw')!;

  it('ne donne le cours qu’à une paire, l’autre prend son candidat suivant', () => {
    const r = ntu(['INF3710', 'LOG3430']);
    const [inf, log] = r.pairs;
    expect(inf!.best?.course.code).toBe('CSIE3010');
    expect(log!.best?.course.code).toBe('CSIE3020');
    expect(r.covered).toBe(2);
  });

  it('sans autre candidat, la paire reste non couverte', () => {
    const only = { ...data, matches: data.matches.filter((x) => !(x.polySigle === 'LOG3430' && x.hostCourseId !== 1)) };
    const r = rankUniversities({ data: only, countryCode: 'TW', term: 'automne', selectedSigles: ['INF3710', 'LOG3430'] }).find((u) => u.university.id === 'ntu-tw')!;
    expect(r.pairs[0]!.best?.course.code).toBe('CSIE3010');
    expect(r.pairs[1]!.best).toBeNull();
    expect(r.covered).toBe(1);
  });

  it('un cours déjà attribué n’est plus proposé en alternative', () => {
    const r = ntu(['INF3710', 'LOG3430']);
    const ids = r.pairs.flatMap((p) => [p.best, ...p.alternatives]).filter(Boolean).map((c) => c!.course.id);
    expect(r.pairs[1]!.alternatives.map((c) => c.course.code)).toEqual(['CSIE3030']);
    expect(ids.filter((id) => id === 1)).toHaveLength(1);
  });
});
