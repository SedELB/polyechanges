import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getReader } from '../collect/readers.js';
import './index.js';
import { creditsOf, electricalPageCount, isResearchTitle, readKaistCourses, readKaistPage, termsOf } from './kaist-kr.js';
import { electricalUrls, listPageUrl } from './kaist-kr.discover.js';

const URLS = {
  csUg: 'https://cs.kaist.ac.kr/education/undergraduate',
  csGr: 'https://cs.kaist.ac.kr/education/graduate',
  eeUg1: 'https://ee.kaist.ac.kr/en/under-curr-list?page=1',
  eeUg3: 'https://ee.kaist.ac.kr/en/under-curr-list?page=3',
  eeGr1: 'https://ee.kaist.ac.kr/en/graduate-curr-list?page=1',
  eeGr9: 'https://ee.kaist.ac.kr/en/graduate-curr-list?page=9',
};
function page(name: string, url: string) {
  return { url, body: readFileSync(new URL(`./fixtures/kaist-kr-${name}.html`, import.meta.url)), contentType: 'text/html; charset=UTF-8' };
}
const csUg = page('cs-undergraduate', URLS.csUg);
const csGr = page('cs-graduate', URLS.csGr);
const eeUg1 = page('ee-undergraduate-1', URLS.eeUg1);
const eeUg3 = page('ee-undergraduate-special', URLS.eeUg3);
const eeGr1 = page('ee-graduate-1', URLS.eeGr1);
const eeGr9 = page('ee-graduate-thesis', URLS.eeGr9);

describe('lecteur kaist-kr', () => {
  it('est enregistré sous le nom kaist-kr', () => {
    expect(getReader('kaist-kr')).toBe(readKaistCourses);
  });

  it('informatique 1er cycle : exactement 5 cours, aucun écarté ni lu comme anglais (drapeau non lu)', () => {
    const courses = readKaistPage(csUg);
    expect(courses.map((c) => c.code)).toEqual(['CS.10001', 'CS.20101', 'CS.30100', 'CS.30702', 'CS.49901']);
    expect(courses.every((c) => c.language === 'unknown')).toBe(true);
  });

  it('lit tous les champs d un cours d informatique', () => {
    const [c] = readKaistPage(csUg);
    expect(c).toMatchObject({
      code: 'CS.10001',
      title: '프로그래밍기초',
      credits: 3,
      contactHours: null,
      language: 'unknown',
      terms: ['fall', 'spring'],
      level: 'undergrad',
      sourceUrl: URLS.csUg,
      outline: null,
    });
    expect(c!.description.startsWith('The course teaches the basic technique of computer programming')).toBe(true);
  });

  it('lit un seul semestre d ouverture et des crédits différents du nombre d heures', () => {
    const [, spring, fall] = readKaistPage(csUg);
    expect(spring).toMatchObject({ code: 'CS.20101', credits: 4, terms: ['spring'] });
    expect(fall).toMatchObject({ code: 'CS.30100', credits: 4, terms: ['fall'] });
  });

  it('informatique cycles supérieurs : exactement 3 cours, cycle grad, description vide gardée vide', () => {
    const courses = readKaistPage(csGr);
    expect(courses.map((c) => c.code)).toEqual(['CC.50010', 'CS.50000', 'CS.50004']);
    expect(courses.every((c) => c.language === 'unknown')).toBe(true);
    expect(courses.every((c) => c.level === 'grad')).toBe(true);
    expect(courses[0]!.description).toBe('');
  });

  it('génie électrique : lit les 3 cours de la page 1, langue inconnue et aucun semestre', () => {
    const courses = readKaistPage(eeUg1);
    expect(courses.map((c) => c.code)).toEqual(['EE.20001', 'EE.20002', 'EE.20004']);
    expect(courses[0]).toMatchObject({
      code: 'EE.20001',
      title: 'Circuit Theory',
      credits: 3,
      contactHours: null,
      language: 'unknown',
      terms: [],
      level: 'undergrad',
      sourceUrl: URLS.eeUg1,
      outline: null,
    });
    expect(courses[0]!.description.startsWith('The aims of this course are to make the student understand')).toBe(true);
  });

  it('génie électrique : garde le numéro de section d un cours à thème et lit les cycles supérieurs', () => {
    const special = readKaistPage(eeUg3);
    expect(special.map((c) => c.code)).toEqual(['EE.49902', 'EE.49904(001)']);
    expect(special[0]!.credits).toBe(2);
    const grad = readKaistPage(eeGr1);
    expect(grad.map((c) => [c.code, c.credits, c.level])).toEqual([
      ['EE.50009', 1, 'grad'],
      ['EE.50011', 3, 'grad'],
    ]);
  });

  it('écarte la recherche, le séminaire et le stage : la page de fixture ne donne plus aucun cours', () => {
    expect(readKaistPage(eeGr9)).toEqual([]);
  });

  it('reconnaît par le titre la recherche, le séminaire, l étude individuelle et le stage', () => {
    for (const title of [
      'M.S. Thesis Research',
      'Research',
      'Individual Study',
      'M.S. Individual Study',
      'Seminar',
      'Ph.D Seminar',
      'M.S. Thesis Seminar',
      'Internship Program and Research (M.S.)',
    ]) {
      expect(isResearchTitle(title), title).toBe(true);
    }
    for (const title of ['Circuit Theory', 'Special Topics in Electronic Engineering 〈Deep Learning for Computer Vision〉', '프로그래밍기초']) {
      expect(isResearchTitle(title), title).toBe(false);
    }
  });

  it('garde la description la plus longue quand un code est répété', () => {
    const [short] = readKaistPage(eeUg1);
    const html = eeUg1.body.toString('utf8').replace(short!.description, 'Short.');
    const [kept] = readKaistCourses([{ ...eeUg1, url: URLS.eeUg3, body: Buffer.from(html) }, eeUg1]);
    expect(kept!.description.length).toBeGreaterThan(50);
  });

  it('refuse une page d un autre hôte', () => {
    expect(() => readKaistPage({ url: 'https://example.org/x', body: Buffer.from('') })).toThrow(/inconnu/);
  });
});

describe('semestre et crédits', () => {
  it('lit les semestres coréens', () => {
    expect(termsOf('봄학기')).toEqual(['spring']);
    expect(termsOf('가을학기')).toEqual(['fall']);
    expect(termsOf('봄 & 가을학기')).toEqual(['fall', 'spring']);
    expect(termsOf('봄 or 가을학기')).toEqual(['fall', 'spring']);
    expect(termsOf('')).toEqual([]);
  });

  it('lit les crédits du format cours:labo:crédits', () => {
    expect(creditsOf('3:0:3')).toBe(3);
    expect(creditsOf('3:3:4')).toBe(4);
    expect(creditsOf('::')).toBeNull();
  });
});

describe('découverte kaist-kr', () => {
  it('lit le nombre de pages dans la liste', () => {
    expect(electricalPageCount(eeUg1.body.toString('utf8'))).toBe(9);
    expect(electricalPageCount(eeGr1.body.toString('utf8'))).toBe(15);
  });

  it('écrit les adresses de la page 1 à la dernière', () => {
    const urls = electricalUrls('https://ee.kaist.ac.kr/en/under-curr-list', 9);
    expect(urls).toHaveLength(9);
    expect(urls[0]).toBe(listPageUrl('https://ee.kaist.ac.kr/en/under-curr-list', 1));
    expect(urls[8]).toBe('https://ee.kaist.ac.kr/en/under-curr-list?page=9');
  });
});
