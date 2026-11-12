import { describe, expect, it } from 'vitest';
import type { HostCourseInput } from '../../shared/types.js';
import { mergeCourses, type LocatedCourse, type SourceCourses } from './merge.js';

function course(code: string, over: Partial<HostCourseInput> = {}): HostCourseInput {
  return {
    code,
    title: `Titre ${code}`,
    description: `Description de ${code}`,
    outline: null,
    credits: 3,
    contactHours: 48,
    language: 'en',
    terms: ['fall'],
    level: 'undergrad',
    sourceUrl: `https://a.example/${code}`,
    ...over,
  };
}

const located = (c: HostCourseInput, snapshotId: number | null = 1, line = 1): LocatedCourse => ({
  course: c,
  snapshotId,
  locator: { page: 1, line },
});

const source = (sourceId: string, courses: LocatedCourse[], priority = 0, enrich = false): SourceCourses => ({
  sourceId,
  priority,
  enrich,
  courses,
});

describe('mergeCourses', () => {
  it('une seule source : les cours ressortent tels quels, dans le même ordre', () => {
    const a = [located(course('B2')), located(course('A1', { terms: ['spring', 'fall'] }), 7, 4)];
    const res = mergeCourses([source('s', a)]);
    expect(res.courses).toEqual(a);
    expect(res.ignored).toEqual([]);
  });

  it('les codes propres à chaque source sont tous gardés, dans l’ordre des sources', () => {
    const res = mergeCourses([source('a', [located(course('X1'))]), source('b', [located(course('Y1')), located(course('X1'))])]);
    expect(res.courses.map((c) => c.course.code)).toEqual(['X1', 'Y1']);
  });

  it('titre, crédits, niveau : la source de plus haute priorité qui a une valeur non vide', () => {
    const low = located(course('C1', { title: 'Ancien titre', credits: 3, level: 'undergrad' }));
    const high = located(course('C1', { title: '  ', credits: null, level: 'grad' }));
    const mid = located(course('C1', { title: 'Titre officiel', credits: 2, level: 'undergrad' }));
    const res = mergeCourses([source('bas', [low], 0), source('haut', [high], 2), source('milieu', [mid], 1)]);
    expect(res.courses[0].course).toMatchObject({ title: 'Titre officiel', credits: 2, level: 'grad' });
  });

  it('à priorité égale, la première source dans l’ordre des fiches l’emporte', () => {
    const res = mergeCourses([
      source('a', [located(course('C1', { title: 'Titre A' }))]),
      source('b', [located(course('C1', { title: 'Titre B' }))]),
    ]);
    expect(res.courses[0].course.title).toBe('Titre A');
  });

  it('langue : la première valeur différente de unknown par priorité décroissante', () => {
    const res = mergeCourses([
      source('a', [located(course('C1', { language: 'other' }))], 0),
      source('b', [located(course('C1', { language: 'unknown' }))], 5),
    ]);
    expect(res.courses[0].course.language).toBe('other');
    const none = mergeCourses([
      source('a', [located(course('C1', { language: 'unknown' }))]),
      source('b', [located(course('C1', { language: 'unknown' }))]),
    ]);
    expect(none.courses[0].course.language).toBe('unknown');
  });

  it('trimestres : l’union', () => {
    const res = mergeCourses([
      source('a', [located(course('C1', { terms: ['fall'] }))]),
      source('b', [located(course('C1', { terms: ['spring', 'fall'] }))]),
    ]);
    expect([...res.courses[0].course.terms].sort()).toEqual(['fall', 'spring']);
  });

  it('description : la plus longue non vide, avec son adresse, son instantané et sa ligne', () => {
    const short = located(course('C1', { description: 'Court.', sourceUrl: 'https://a.example/court' }), 10, 3);
    const long = located(course('C1', { description: 'Une description bien plus longue.', sourceUrl: 'https://b.example/long' }), 20, 8);
    const res = mergeCourses([source('a', [short], 5), source('b', [long], 0)]);
    expect(res.courses[0]).toEqual({
      course: expect.objectContaining({ description: 'Une description bien plus longue.', sourceUrl: 'https://b.example/long' }),
      snapshotId: 20,
      locator: { page: 1, line: 8 },
    });
  });

  it('plan de cours : le plus long non vide', () => {
    const res = mergeCourses([
      source('a', [located(course('C1', { outline: 'Semaine 1' }))], 3),
      source('b', [located(course('C1', { outline: 'Semaine 1 : introduction ; semaine 2 : graphes' }))]),
      source('c', [located(course('C1', { outline: null }))]),
    ]);
    expect(res.courses[0].course.outline).toBe('Semaine 1 : introduction ; semaine 2 : graphes');
  });

  it('aucune description : l’adresse, l’instantané et la ligne de la source de plus haute priorité', () => {
    const low = located(course('C1', { description: '', sourceUrl: 'https://a.example/bas' }), 10, 3);
    const high = located(course('C1', { description: ' ', sourceUrl: 'https://b.example/haut' }), 20, 8);
    const res = mergeCourses([source('a', [low], 0), source('b', [high], 1)]);
    expect(res.courses[0].course.sourceUrl).toBe('https://b.example/haut');
    expect(res.courses[0].snapshotId).toBe(20);
    expect(res.courses[0].locator).toEqual({ page: 1, line: 8 });
  });

  it('une source enrich ne crée aucun code : elle complète seulement les codes des autres sources', () => {
    const main = source('dept', [located(course('CS101', { language: 'unknown', terms: [] })), located(course('CS102'))]);
    const official = source(
      'liste',
      [
        located(course('CS101', { title: 'Introduction to Programming', language: 'en', terms: ['spring'], description: '' })),
        located(course('MATH9', { description: '' })),
        located(course('BIO1', { description: '' })),
      ],
      1,
      true,
    );
    const res = mergeCourses([main, official]);
    expect(res.courses.map((c) => c.course.code)).toEqual(['CS101', 'CS102']);
    expect(res.courses[0].course).toMatchObject({
      title: 'Introduction to Programming',
      language: 'en',
      terms: ['spring'],
      description: 'Description de CS101',
    });
    expect(res.ignored).toEqual([{ sourceId: 'liste', codes: ['MATH9', 'BIO1'] }]);
  });

  it('une source enrich sans code ignoré apparaît avec zéro code', () => {
    const res = mergeCourses([
      source('dept', [located(course('A'))]),
      source('liste', [located(course('A'))], 0, true),
    ]);
    expect(res.ignored).toEqual([{ sourceId: 'liste', codes: [] }]);
  });
});
