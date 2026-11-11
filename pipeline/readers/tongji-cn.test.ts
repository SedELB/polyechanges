import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isInScope, mergeListed, parseHtmlTable, parsePdfList, toCourse } from './tongji-cn.build.js';

/** Texte extrait d'une fixture (lignes préfixées `p<page>:l<ligne>`), rangé par page. */
function pages(name: string): string[][] {
  const out: string[][] = [];
  const text = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  for (const raw of text.split('\n')) {
    const m = raw.match(/^p(\d+):l(\d+) (.*)$/);
    if (!m) continue;
    (out[Number(m[1]) - 1] ??= [])[Number(m[2]) - 1] = m[3]!;
  }
  return out.map((p) => Array.from(p, (l) => l ?? ''));
}

describe('lecture des listes de cours en anglais de Tongji', () => {
  const fall = parsePdfList(pages('tongji-cn-ceie-fall-bachelor-lines.txt'), 'fall', 'undergrad');

  it('lit les rangées du PDF, sur une, deux ou trois lignes, et ignore le code déformé', () => {
    expect(fall.map((c) => c.code)).toEqual(['10018401', '10032001', '10032201', '10071303']);
    expect(fall[1]).toMatchObject({
      code: '10032001',
      title: 'Automatic Control 1',
      credits: 6,
      language: 'English',
      terms: ['fall'],
      level: 'undergrad',
      page: 1,
      line: 3,
      quote:
        '2026-2027 1 10032001 自动控制1（英） Automatic Control 1(English) Elective 96 6 English 1-16 Yu Youling Zhang Changzhu Jiading',
    });
    expect(fall[0]).toMatchObject({ title: 'Circuit Theory', credits: 4, line: 2 });
  });

  it('garde le titre tel que la liste l écrit, même fautif', () => {
    expect(fall[3]!.title).toBe('Principles andTechnology of Computer');
  });

  it('joint un titre coupé sur deux lignes et lit les listes sans colonne de type', () => {
    const spring = parsePdfList(pages('tongji-cn-ceie-spring-master-lines.txt'), 'spring', 'grad');
    expect(spring.map((c) => [c.code, c.title, c.credits, c.language])).toEqual([
      ['1080067', 'Non-linear System', 2, 'English'],
      ['20002440002', 'Physical-Layer Security Theory for Wireless Communications', 2, 'English'],
      ['2080424', 'Electronics Engineering Subjects', 2, 'English'],
      ['10002440010', 'AI in autonomous driving', 2, 'Bilingual'],
      ['1080108', 'Wireless Network Information Theory', 2, 'Bilingual'],
    ]);
    expect(spring[1]).toMatchObject({ line: 3 });
    expect(spring[1]!.quote).toContain('Physical-Layer Security Theory for Wireless Communications 32 2 English');
  });

  it('lit les tableaux des pages HTML avec niveau, trimestre et langue', () => {
    const cs = parseHtmlTable(pages('tongji-cn-cs-lines.txt'));
    expect(cs).toHaveLength(9);
    expect(cs[0]).toMatchObject({
      code: 'CST239702',
      title: 'Principles of Database and Applications',
      credits: 4,
      language: 'English',
      terms: ['spring'],
      level: 'undergrad',
      line: 3,
      quote: 'CST239702 | Principles of Database and Applications | 4 | Spring | English',
    });
    expect(cs[7]).toMatchObject({ code: 'CST6030', level: 'grad', terms: ['spring'] });
    expect(cs[6]).toMatchObject({ language: 'Bilingual', terms: ['fall'] });
  });

  it('lit une page sans crédits ni trimestre, le niveau venant d une colonne, et ignore le code déformé', () => {
    const math = parseHtmlTable(pages('tongji-cn-math-lines.txt'));
    expect(math.map((c) => c.code)).toEqual(['2102002', '210206001', '210222301']);
    expect(math[0]).toMatchObject({ title: 'Numerical Analysis', credits: null, terms: [], level: 'grad', language: 'English' });
  });

  it('ne garde que l anglais, hors mécanique, et fusionne les trimestres (automne avant printemps)', () => {
    expect(isInScope('Basic Theory of Machinery1(English)')).toBe(false);
    expect(isInScope('Computer Network')).toBe(true);
    const cs = parseHtmlTable(pages('tongji-cn-cs-lines.txt'));
    const merged = mergeListed([...cs.filter((c) => c.terms[0] === 'spring'), ...cs.filter((c) => c.terms[0] === 'fall')]);
    expect(merged.map((m) => m.code)).toEqual([
      'CST239702', 'CST239801', 'CST349001', 'CST348701', 'CST6030', 'CST600301',
    ]);
    expect(merged.find((m) => m.code === 'CST239801')!.terms).toEqual(['fall', 'spring']);
    expect(merged.find((m) => m.code === 'CST239801')!.line).toBe(4);
  });

  it('construit la saisie avec la position et l extrait de la rangée', () => {
    const c = toCourse(fall[1]!, 'https://example.test/list.pdf', 'abc', '2026-11-10T00:00:00.000Z');
    expect(c).toMatchObject({
      code: '10032001',
      title: 'Automatic Control 1',
      description: '',
      outline: null,
      credits: 6,
      contactHours: null,
      language: 'en',
      terms: ['fall'],
      level: 'undergrad',
      sourceUrl: 'https://example.test/list.pdf',
    });
    expect(c.provenance).toMatchObject({ sha256: 'abc', locator: { page: 1, line: 3 } });
    expect(c.provenance.quote).toContain('Automatic Control 1(English) Elective 96 6 English');
  });
});
