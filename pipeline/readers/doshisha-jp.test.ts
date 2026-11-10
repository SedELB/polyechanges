import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isInScope, mergeRows, parseGemRows, toCourse } from './doshisha-jp.build.js';

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
