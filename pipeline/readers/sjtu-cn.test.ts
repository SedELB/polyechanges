import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getReader } from '../collect/readers.js';
import './index.js';
import { readSjtuCourses } from './sjtu-cn.js';
import { excludedByPrefix, isWanted, parseIndex, selectCourses } from './sjtu-cn.discover.js';

const BASE = 'https://gc.sjtu.edu.cn/academics/courses/courses-by-number/course-info/?id=';
function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}
function course(id: number) {
  return { url: `${BASE}${id}`, body: fixture(`sjtu-cn-course-${id}.html`), contentType: 'text/html; charset=UTF-8' };
}

const ece2800 = course(246);
const cs4800 = course(77555);
const ds4760 = course(446);
const math6001 = course(489);

describe('lecteur sjtu-cn', () => {
  it('est enregistré sous le nom sjtu-cn', () => {
    expect(getReader('sjtu-cn')).toBe(readSjtuCourses);
  });

  it('lit exactement les 4 cours de la fixture', () => {
    const courses = readSjtuCourses([ece2800, cs4800, ds4760, math6001]);
    expect(courses.map((c) => c.code)).toEqual(['ECE2800J', 'CS4800J', 'DS4760J', 'MATH6001J']);
  });

  it('lit tous les champs d un cours de 1er cycle', () => {
    const [c] = readSjtuCourses([ece2800]);
    expect(c).toMatchObject({
      code: 'ECE2800J',
      title: 'Programming and Introductory Data Structures',
      credits: 4,
      contactHours: null,
      language: 'en',
      terms: [],
      level: 'undergrad',
      sourceUrl: ece2800.url,
    });
    expect(c!.description.startsWith('Techniques for algorithm development and effective programming')).toBe(true);
    expect(c!.description).not.toContain('Pre-requisites');
    expect(c!.outline!.split('\n')).toHaveLength(20);
    expect(c!.outline!.split('\n')[0]).toBe('Linux basics and compiling program on Linux');
  });

  it('lit les crédits écrits « 3 Credits » ou « 4 » et le cycle supérieur', () => {
    const [cs, , grad] = readSjtuCourses([cs4800, ds4760, math6001]);
    expect(cs!.credits).toBe(4);
    expect(grad).toMatchObject({ code: 'MATH6001J', credits: 3, level: 'grad' });
  });

  it('garde la description la plus longue quand un code est répété', () => {
    const copy = { ...ece2800, url: `${BASE}999` };
    const short = { ...copy, body: Buffer.from(ece2800.body.toString('utf8').replace(/<p>Techniques[^<]*<\/p>/, '<p>Short.</p>')) };
    const [kept] = readSjtuCourses([short, ece2800]);
    expect(kept!.sourceUrl).toBe(ece2800.url);
    expect(kept!.description.length).toBeGreaterThan(50);
  });

  it('refuse une page sans intitulé', () => {
    expect(() => readSjtuCourses([{ url: BASE + '1', body: Buffer.from('<html></html>'), contentType: 'text/html' }])).toThrow(/illisible/);
  });
});

describe('découverte sjtu-cn', () => {
  const all = parseIndex(fixture('sjtu-cn-index.html').toString('utf8'));

  it('lit les 25 liens de l index réduit', () => {
    expect(all).toHaveLength(25);
    expect(all[0]).toMatchObject({ code: 'CS2810J', title: 'Data Structures and Algorithms' });
    expect(all[0]!.url).toMatch(/^https:\/\/gc\.sjtu\.edu\.cn\/academics\/courses\/courses-by-number\/course-info\/\?id=\d+$/);
  });

  it('garde ECE, CS, MATH et DS (19 cours) et écarte ME (6 cours)', () => {
    expect(selectCourses(all)).toHaveLength(19);
    expect(excludedByPrefix(all)).toEqual({ ME: 6 });
  });
});

describe('découverte sjtu-cn : exception ENGR1010J', () => {
  const link = (id: number, text: string) => `<a href="course-info/?id=${id}">${text}</a>`;
  const html = `<html><body>${link(1, 'ENGR1010J – Introduction to Computers and Programming')}${link(2, 'ENGR2000J – Engineering Ethics')}${link(3, 'ENGR1000J – Intro to Engineering')}${link(4, 'ECE2800J – Programming')}</body></html>`;
  const all = parseIndex(html);

  it('garde ENGR1010J par son code exact et écarte les autres ENGR', () => {
    expect(isWanted('ENGR1010J')).toBe(true);
    expect(isWanted('ENGR1010')).toBe(false);
    expect(isWanted('ENGR2000J')).toBe(false);
    expect(selectCourses(all)).toHaveLength(2);
    expect(excludedByPrefix(all)).toEqual({ ENGR: 2 });
  });
});
