import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getReader } from '../collect/readers.js';
import './index.js';
import { parseCatalogueSheet, readCityuCatalogue } from './cityu-hk-catalogue.js';
import { isInScope, parseListRows, readCityuList } from './cityu-hk.js';

/** Texte extrait d'une page réelle, réduite (lignes préfixées `p<page>:l<ligne>`), rangé par page. */
function pagesOf(name: string): string[][] {
  const pages: string[][] = [];
  const text = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  for (const raw of text.split('\n')) {
    const m = raw.match(/^p(\d+):l(\d+) (.*)$/);
    if (!m) continue;
    const page = Number(m[1]);
    while (pages.length < page) pages.push([]);
    pages[page - 1]!.push(m[3]!);
  }
  return pages;
}

describe('liste des cours d\'échange de CityU', () => {
  it('est enregistrée sous le nom cityu-hk', () => {
    expect(getReader('cityu-hk')).toBe(readCityuList);
  });

  it('lit les 17 rangées de la fixture, avec code, titre et crédits', () => {
    const rows = parseListRows(pagesOf('cityu-hk-list-lines.txt'));
    expect(rows).toHaveLength(17);
    expect(rows[0]).toEqual({ code: 'CS1102', title: 'Introduction to Computer Studies', credits: 3 });
    expect(rows.find((r) => r.code === 'CS4286')).toEqual({ code: 'CS4286', title: 'Internet Security and e-Commerce Protocols', credits: 3 });
    expect(rows.find((r) => r.code === 'GE2338')?.title).toBe('Everyday Security - Protecting Yourself in the Digital Age');
  });

  it('ne garde que les 14 cours CS', () => {
    const codes = parseListRows(pagesOf('cityu-hk-list-lines.txt')).map((r) => r.code);
    expect(codes.filter(isInScope)).toHaveLength(14);
    expect(codes.filter((c) => !isInScope(c))).toEqual(['GE1361', 'GE2324', 'GE2338']);
  });

  it('ignore les lignes qui ne sont pas des rangées de cours', () => {
    expect(parseListRows([['Application Term: 202602', 'Course Code Course Title Unit', 'We use cookies']])).toEqual([]);
  });

  it('refuse une liste sans aucune rangée', async () => {
    await expect(
      readCityuList([{ url: 'https://www.cs.cityu.edu.hk/en/academic-programmes/student-exchange/exchange-course-list', body: Buffer.from('x'), contentType: 'text/plain' }]),
    ).rejects.toThrow(/Aucune rangée/);
  });
});

describe('fiches du catalogue de CityU', () => {
  it('est enregistré sous le nom cityu-hk-catalogue', () => {
    expect(getReader('cityu-hk-catalogue')).toBe(readCityuCatalogue);
  });

  it('lit code, titre, crédits et objectifs, sans les préalables ni l\'évaluation', () => {
    const s = parseCatalogueSheet(pagesOf('cityu-hk-catalogue-CS4286-lines.txt'))!;
    expect(s).toMatchObject({ code: 'CS4286', title: 'Internet Security and e-Commerce Protocols', credits: 3 });
    expect(s.description.startsWith('This course aims to provide an understanding of information security.')).toBe(true);
    expect(s.description.endsWith('developing secure e-commerce protocols.')).toBe(true);
    expect(s.description).not.toContain('Pre-requisite');
    expect(s.description).not.toContain('Continuous Assessment');
  });

  it('donne la position de la première ligne des objectifs (règle : le début de Course Aims, pas le titre)', () => {
    const pages = pagesOf('cityu-hk-catalogue-CS4286-lines.txt');
    expect(parseCatalogueSheet(pages)!.descriptionAt).toEqual({ page: 1, line: 10 });
    expect(pages[0][9]).toMatch(/^This course aims to provide an understanding of information security[.]/);
  });

  it('lit une seconde fiche', () => {
    const s = parseCatalogueSheet(pagesOf('cityu-hk-catalogue-CS3334-lines.txt'))!;
    expect(s).toMatchObject({ code: 'CS3334', title: 'Data Structures', credits: 3 });
    expect(s.description).toContain('heaps, search trees, hash tables and disjoint sets');
  });

  it('renvoie null sans ligne de titre', () => {
    expect(parseCatalogueSheet([['rien']])).toBeNull();
  });
});
