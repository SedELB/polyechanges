import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isInScope, istcExclusion, istcToCourse, mergeRows, parseGemRows, parseIstcRows, toCourse } from './doshisha-jp.build.js';

/** Texte extrait de la liste (lignes préfixées `p<page>:l<ligne>`), rangé par page. */
function fixturePages(): string[][] {
  const pages: string[][] = [];
  const text = readFileSync(new URL('./fixtures/doshisha-jp-gem-lines.txt', import.meta.url), 'utf8');
  for (const raw of text.split('\n')) {
    const m = raw.match(/^p(\d+):l(\d+) (.*)$/);
    if (!m) continue;
    const page = Number(m[1]);
    (pages[page - 1] ??= [])[Number(m[2]) - 1] = m[3]!;
  }
  return pages.map((p) => Array.from(p, (l) => l ?? ''));
}

describe('construction de la saisie doshisha-jp', () => {
  const rows = parseGemRows(fixturePages());

  it('lit les rangées de cours de la fixture et ignore les en-têtes', () => {
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({ code: '99200001', classCode: '001', term: 'spring', campus: 'K', credits: 2, page: 1, line: 5 });
  });

  it('sépare le titre du nom de l enseignant et du numéro de classe', () => {
    const titles = rows.map((r) => r.title);
    expect(titles).toContain('Introduction to Japanese Culture in the Global Context');
    expect(titles).toContain('Introduction to Computer Science and Information Technology');
    expect(titles).toContain('Mathematics and its History');
    expect(titles).toContain('Statistics for the Social Sciences and Humanities');
  });

  it('retient seulement l informatique et les mathématiques', () => {
    const kept = mergeRows(rows.filter((r) => isInScope(r.title)));
    expect(kept.map((c) => c.code)).toEqual(['99200024', '99200025', '99200027', '99200029']);
  });

  it('fusionne les trimestres d un même code et garde la première rangée', () => {
    const stats = mergeRows(rows.filter((r) => isInScope(r.title))).find((c) => c.code === '99200024')!;
    expect(stats.terms).toEqual(['fall', 'spring']);
    expect(stats.first.line).toBe(15);
  });

  it('construit un cours avec ses champs complets', () => {
    const merged = mergeRows(rows.filter((r) => isInScope(r.title)));
    const cs = merged.find((c) => c.code === '99200025')!;
    const course = toCourse(cs, 'https://example.test/list.pdf', 'a'.repeat(64), '2026-11-10T00:00:00.000Z');
    expect(course).toEqual({
      code: '99200025',
      title: 'Introduction to Computer Science and Information Technology',
      description: '',
      outline: null,
      credits: 2,
      contactHours: null,
      language: 'en',
      terms: ['spring'],
      level: 'undergrad',
      sourceUrl: 'https://example.test/list.pdf',
      provenance: {
        url: 'https://example.test/list.pdf',
        retrievedAt: '2026-11-10T00:00:00.000Z',
        sha256: 'a'.repeat(64),
        locator: { page: 2, line: cs.first.line },
        quote: '99200025 000 Introduction to Computer Science and Information Technology MYGDALSKYY VOLODYMYR I S 2 Advanced Registration △',
      },
    });
  });
});

/** Pages 14 et 15 du texte extrait du guide ISTC (lignes préfixées `p<page>:l<ligne>`). */
function istcPages(): string[][] {
  const pages: string[][] = [];
  const text = readFileSync(new URL('./fixtures/doshisha-jp-istc-lines.txt', import.meta.url), 'utf8');
  for (const raw of text.split('\n')) {
    const m = raw.match(/^p(\d+):l(\d+) (.*)$/);
    if (!m) continue;
    const page = Number(m[1]);
    (pages[page - 1] ??= [])[Number(m[2]) - 1] = m[3]!;
  }
  return Array.from(pages, (p) => Array.from(p ?? [], (l) => l ?? ''));
}

describe('liste des matières de l ISTC', () => {
  const rows = parseIstcRows(istcPages());
  const byCode = (code: string) => rows.find((r) => r.code === code)!;

  it('lit toutes les rangées à code des pages 14 et 15 de la fixture', () => {
    expect(rows).toHaveLength(110);
  });

  it('lit une rangée sur une seule ligne', () => {
    expect(byCode('31691010')).toEqual({
      code: '31691010',
      title: 'Advanced Natural Language Processing',
      credits: 2,
      term: 'fall',
      notAvailable: false,
      cohort: null,
      page: 14,
      line: 11,
      quote: '31691010 Advanced Natural Language Processing (E) 2 TAMURA Akihiro Fall Mon／４',
    });
  });

  it('lit une rangée répartie sur plusieurs lignes (note et enseignants sur des lignes séparées)', () => {
    expect(byCode('31692008')).toMatchObject({ title: 'Electrical Power Systems Engineering', credits: 2, term: 'spring', line: 28 });
    expect(byCode('31696502')).toMatchObject({ title: 'Electric Circuit Theory', credits: 2, term: 'fall', line: 49 });
    expect(byCode('31696512')).toMatchObject({ title: 'Advanced Distributed Systems', term: 'spring', cohort: '2025 and after' });
    expect(byCode('31696506').title).toBe('Biology');
  });

  it('reconnaît les cours non offerts et les cohortes anciennes', () => {
    expect(byCode('31691011')).toMatchObject({ notAvailable: true, term: null });
    expect(byCode('31691006')).toMatchObject({ cohort: '2023 and before', term: 'fall' });
  });

  it('exclut thèses, stages, expériences, cours non offerts, anciennes cohortes et autres familles', () => {
    const why = (code: string) => istcExclusion(byCode(code));
    expect(why('31691090')).toBe('research');
    expect(why('31691007')).toBe('research');
    expect(why('31691081')).toBe('research');
    expect(why('31691011')).toBe('not-available');
    expect(why('31691006')).toBe('old-cohort');
    expect(why('31691009')).toBe('old-cohort');
    expect(why('31693001')).toBe('out-of-family');
    expect(why('31696601')).toBe('out-of-family');
    expect(why('31691010')).toBeNull();
  });

  it('retient 31 cours et en exclut 79 dont 30 de recherche et 10 non offerts', () => {
    const counts: Record<string, number> = {};
    let kept = 0;
    for (const r of rows) {
      const w = istcExclusion(r);
      if (w) counts[w] = (counts[w] ?? 0) + 1;
      else kept++;
    }
    expect(kept).toBe(31);
    expect(counts).toEqual({ 'out-of-family': 37, research: 30, 'not-available': 10, 'old-cohort': 2 });
  });

  it('construit un cours de cycles supérieurs avec ses champs complets', () => {
    const course = istcToCourse(byCode('31691010'), 'https://example.test/guide.pdf', 'b'.repeat(64), '2026-11-10T00:00:00.000Z');
    expect(course).toEqual({
      code: '31691010',
      title: 'Advanced Natural Language Processing',
      description: '',
      outline: null,
      credits: 2,
      contactHours: null,
      language: 'en',
      terms: ['fall'],
      level: 'grad',
      sourceUrl: 'https://example.test/guide.pdf',
      provenance: {
        url: 'https://example.test/guide.pdf',
        retrievedAt: '2026-11-10T00:00:00.000Z',
        sha256: 'b'.repeat(64),
        locator: { page: 14, line: 11 },
        quote: '31691010 Advanced Natural Language Processing (E) 2 TAMURA Akihiro Fall Mon／４',
      },
    });
  });
});
