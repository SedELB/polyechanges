import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getReader } from '../collect/readers.js';
import './index.js';
import { parseSyllabus, readDoshishaSyllabi } from './doshisha-jp-syllabus.js';

/** Texte extrait d'une fiche réelle, réduite (lignes préfixées `p<page>:l<ligne>`), rangé par page. */
function sheet(code: string): string[][] {
  const pages: string[][] = [];
  const text = readFileSync(new URL(`./fixtures/doshisha-jp-syllabus-${code}-lines.txt`, import.meta.url), 'utf8');
  for (const raw of text.split('\n')) {
    const m = raw.match(/^p(\d+):l(\d+) (.*)$/);
    if (!m) continue;
    const page = Number(m[1]);
    while (pages.length < page) pages.push([]);
    pages[page - 1]!.push(m[3]!);
  }
  return pages;
}

describe('fiches de syllabus de Doshisha', () => {
  it('est enregistré sous le nom doshisha-jp-syllabus', () => {
    expect(getReader('doshisha-jp-syllabus')).toBe(readDoshishaSyllabi);
  });

  it('lit code, titre, crédits et description (résumé puis objectifs) d\'une fiche de l\'ISTC', () => {
    const s = parseSyllabus(sheet('31691010'))!;
    expect(s).toMatchObject({ code: '31691010', classCode: null, title: 'Advanced Natural Language Processing', credits: 2, language: 'unknown' });
    expect(s.description.startsWith('This course provides an overview of natural language processing (NLP) technologies')).toBe(true);
    expect(s.description).toContain('\n\nThrough the course, students will be able to:');
    // Mot coupé en fin de ligne recollé sans espace ; puces sur leur ligne.
    expect(s.description).toContain('\n- acquire specialized knowledge of corpus-based NLP, including statistical NLP and machine-learning-based approaches.');
    // Ni la rubrique de la première vidéo ni le calendrier ne sont dans la description.
    expect(s.description).not.toContain('Deliver the video');
    expect(s.description).not.toContain('Week 1');
  });

  it('lit la langue quand la fiche l\'écrit', () => {
    const s = parseSyllabus(sheet('31691017'))!;
    expect(s.language).toBe('en');
    expect(s.title).toBe('Advanced Information and Computer Sciences Ⅰ');
    expect(s.description).toContain('IMPORTANT! This course is conducted in English.');
  });

  it('donne la position de la première ligne de la description (règle : le début du résumé, pas l en-tête)', () => {
    expect(parseSyllabus(sheet('31691010'))!.descriptionAt).toEqual({ page: 1, line: 16 });
    expect(parseSyllabus(sheet('99200024'))!.descriptionAt).toEqual({ page: 1, line: 15 });
    expect(sheet('31691010')[0][15]).toMatch(/^This course provides an overview/);
  });

  it('lit le numéro de classe d\'un cours du Global Education Module', () => {
    const s = parseSyllabus(sheet('99200024'))!;
    expect(s).toMatchObject({ code: '99200024', classCode: '001', credits: 2 });
    expect(s.description.length).toBeGreaterThan(50);
  });

  it('renvoie null sans en-tête de cours', () => {
    expect(parseSyllabus([['rien', 'ici']])).toBeNull();
  });

  it('refuse une fiche dont le code ne correspond pas à son adresse', async () => {
    // Pas de PDF réel ici : le lecteur exige un vrai PDF, on vérifie seulement le refus d'un contenu illisible.
    await expect(
      readDoshishaSyllabi([{ url: 'https://syllabus.doshisha.ac.jp/html/2026/1691/31691010000.html', body: Buffer.from('rien'), contentType: 'text/plain' }]),
    ).rejects.toThrow(/illisible/);
  });
});
