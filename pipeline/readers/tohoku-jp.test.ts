import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isInScope, parseList, parseSyllabus, toCourse } from './tohoku-jp.build.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** Texte extrait d'un PDF (lignes préfixées `p<page>:l<ligne>`), rangé par page. */
function pagesOf(name: string): string[][] {
  const pages: string[][] = [];
  for (const raw of fixture(name).split('\n')) {
    const m = raw.match(/^p(\d+):l(\d+) (.*)$/);
    if (!m) continue;
    (pages[Number(m[1]) - 1] ??= [])[Number(m[2]) - 1] = m[3]!;
  }
  return pages.map((p) => Array.from(p, (l) => l ?? ''));
}

const BASE = 'https://www.insc.tohoku.ac.jp';

describe('construction de la saisie tohoku-jp', () => {
  const rows = parseList(fixture('tohoku-jp-list-2026-spring.html'), BASE);

  it('lit chaque rangée de cours de la liste : code, titre, adresse du syllabus', () => {
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.code === 'SB1117')).toEqual({
      code: 'SB1117',
      title: 'Mathematics B',
      url: `${BASE}/english/wp-content/uploads/2026/03/Mathematics-B.pdf`,
    });
    expect(rows.map((r) => r.code)).toContain('TB37091');
  });

  it('retient l informatique, le génie électrique et les mathématiques seulement', () => {
    const kept = rows.filter((r) => isInScope(r.code)).map((r) => r.code);
    expect(kept).toEqual(['SB1117', 'VJ251S8', 'TB15204', 'TB15212']);
    expect(isInScope('VJ251S4')).toBe(false);
    expect(isInScope('TB37091')).toBe(false);
    expect(isInScope('VJ254F83')).toBe(true);
  });

  it('lit les champs d un syllabus : titre, crédits, langue, trimestre, description', () => {
    const s = parseSyllabus(pagesOf('tohoku-jp-syllabus-SB1117-lines.txt'));
    expect(s.title).toBe('Mathematics B');
    expect(s.credits).toBe(2);
    expect(s.language).toBe('English');
    expect(s.term).toBe('spring');
    expect(s.description.startsWith('Themes are chosen from algebra, geometry, and analysis')).toBe(true);
    expect(s.description).toContain('the usefulness of mathematics.');
    expect(s.description).not.toContain('Linear representations');
    expect(s.titleLine).toEqual({ page: 1, line: 28 });
  });

  it('lit un syllabus au semestre d automne', () => {
    const s = parseSyllabus(pagesOf('tohoku-jp-syllabus-VJ254F83-lines.txt'));
    expect(s).toMatchObject({ title: 'Basic Computer Science', credits: 2, language: 'English', term: 'fall' });
    expect(s.description).toContain('algorithm theory,');
    expect(s.description).not.toContain('Introduction of this course');
  });

  it('ignore le japonais et laisse la langue vide quand le syllabus ne la donne pas', () => {
    const s = parseSyllabus(pagesOf('tohoku-jp-syllabus-TB15212-lines.txt'));
    expect(s).toMatchObject({ title: 'Fundamentals of Information Science II', credits: 2, language: '', term: 'spring' });
    expect(s.description.startsWith('Aims: Students will acquire basic knowledge about algorithms')).toBe(true);
    expect(/[\u3040-\u9fff]/.test(s.description)).toBe(false);
  });

  it('construit la saisie avec la position du titre dans le syllabus', () => {
    const s = parseSyllabus(pagesOf('tohoku-jp-syllabus-SB1117-lines.txt'));
    const c = toCourse('SB1117', s, `${BASE}/x.pdf`, 'abc', '2026-11-10T00:00:00.000Z');
    expect(c).toMatchObject({
      code: 'SB1117',
      title: 'Mathematics B',
      credits: 2,
      language: 'en',
      terms: ['spring'],
      level: 'undergrad',
      contactHours: null,
    });
    expect(c.provenance).toMatchObject({ sha256: 'abc', locator: { page: 1, line: 28 }, quote: 'Mathematics B' });
  });
});
