import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findQuote, snapshotText } from '../provenance/snapshotText.js';
import { readXlsx } from './xlsx.js';
import { listRows, mergeRows, readSheets, sheetHtml, toCourse } from './korea-kr.build.js';

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}

const fallUg = readSheets(fixture('korea-kr-fall-undergraduate.xlsx'));
const fallGrad = readSheets(fixture('korea-kr-fall-graduate.xlsx'));
const spring = readSheets(fixture('korea-kr-spring.xlsx'));

describe('lecture des classeurs de Korea University', () => {
  it('lit les feuilles par nom, cellules par colonne', () => {
    expect(fallUg.map((s) => s.name)).toEqual(['Sheet1']);
    expect(spring.map((s) => s.name)).toEqual(['GOAL_2026 Spring', 'Undergrad_2026 Spring', 'Grad_2026 Spring', 'Undergrad_2025 Fall']);
    expect(fallUg[0]!.rows[0]).toContain('학수번호');
    expect(fallUg[0]!.rows[1]![5]).toBe('COSE211');
  });

  it('ne garde au 1er cycle d automne que les cours en anglais d informatique, de génie électrique et de mathématiques', () => {
    const rows = listRows(fallUg[0]!, 'undergrad', 'fall');
    expect(rows.map((r) => [r.code, r.section])).toEqual([
      ['COSE211', '01'],
      ['COSE211', '02'],
      ['KECE208', '04'],
      ['MATH161', '04'],
    ]);
    expect(rows[0]).toMatchObject({ title: 'DISCRETE MATHEMATICS', credits: 3, level: 'undergrad', term: 'fall' });
  });

  it('lit les cycles supérieurs d automne (colonnes différentes) et écarte les cours sans indicateur anglais', () => {
    const rows = listRows(fallGrad[0]!, 'grad', 'fall');
    expect(rows.map((r) => r.code)).toEqual(['ECE502', 'XAI501', 'AAA519']);
    expect(rows[1]).toMatchObject({ title: 'MACHINE LEARNING', credits: 3, level: 'grad' });
  });

  it('lit le printemps : feuilles du 1er cycle et des cycles supérieurs de 2026 seulement', () => {
    const ug = listRows(spring.find((s) => s.name === 'Undergrad_2026 Spring')!, 'undergrad', 'spring');
    const grad = listRows(spring.find((s) => s.name === 'Grad_2026 Spring')!, 'grad', 'spring');
    expect(ug.map((r) => r.code)).toEqual(['COSE211', 'KECE205']);
    expect(ug[1]).toMatchObject({ title: 'CIRCUIT THEORY AND LABORATORY', credits: 1 });
    expect(grad.map((r) => r.code)).toEqual(['AAA536', 'MTH501']);
  });

  it('fusionne sections et trimestres d un même code, automne d abord', () => {
    const rows = [
      ...listRows(spring.find((s) => s.name === 'Undergrad_2026 Spring')!, 'undergrad', 'spring'),
      ...listRows(fallUg[0]!, 'undergrad', 'fall'),
    ];
    const merged = mergeRows(rows);
    expect(merged.map((m) => [m.code, m.terms])).toEqual([
      ['COSE211', ['fall', 'spring']],
      ['KECE205', ['spring']],
      ['KECE208', ['fall']],
      ['MATH161', ['fall']],
    ]);
    expect(merged[0]!.best.section).toBe('01');
  });

  it('construit le cours complet', () => {
    const [m] = mergeRows(listRows(fallUg[0]!, 'undergrad', 'fall'));
    const course = toCourse(m!, { fall: { url: 'https://example.org/fall.xlsx', sha256: 'a'.repeat(64), page: 'https://example.org/fall' } }, '2026-11-10T20:00:00.000Z');
    expect(course).toMatchObject({
      code: 'COSE211',
      title: 'DISCRETE MATHEMATICS',
      credits: 3,
      contactHours: null,
      language: 'en',
      terms: ['fall'],
      level: 'undergrad',
      sourceUrl: 'https://example.org/fall',
    });
    expect(course.description).toBe('');
    expect(course.provenance).toMatchObject({ url: 'https://example.org/fall.xlsx', sha256: 'a'.repeat(64), locator: { page: 1, line: 2 } });
    expect(course.provenance!.quote).toContain('COSE211');
  });

  it('la rangée citée se retrouve dans le tableau reconstitué', async () => {
    const html = sheetHtml(fallUg[0]!);
    const pages = await snapshotText(Buffer.from(html), 'text/html');
    for (const r of listRows(fallUg[0]!, 'undergrad', 'fall')) {
      const hits = findQuote(pages, r.quote);
      expect(hits).toEqual([{ page: 1, line: r.line }]);
      expect(r.quote).toContain(r.code);
    }
  });
});

describe('limite de taille des classeurs', () => {
  it('refuse une partie dont la taille décompressée dépasse le maximum', () => {
    expect(() => readXlsx(fixture('korea-kr-fall-undergraduate.xlsx'), 100)).toThrow(/trop volumineuse/);
  });
  it('lit le classeur sous le maximum', () => {
    expect(readXlsx(fixture('korea-kr-fall-undergraduate.xlsx')).length).toBeGreaterThan(0);
  });
});
