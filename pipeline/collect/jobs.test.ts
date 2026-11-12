import { describe, expect, it } from 'vitest';
import { collectJobs, parseCollectArgs } from './jobs.js';
import { parseSourceFile, type LoadedSourceFile } from './sourceFile.js';

const load = (raw: Record<string, unknown>, fileName = `${String(raw.id)}.json`): LoadedSourceFile => ({ ...parseSourceFile(raw), fileName });

const poly = load({ id: 'poly-log', universityId: null, kind: 'saved', urls: ['https://p.example'], files: ['p.html'], reader: 'poly' });
const kaist = load({ id: 'kaist-kr', universityId: 'kaist-kr', kind: 'html', urls: ['https://k.example'], reader: 'kaist-kr' });
const kaistSaved = load({
  id: 'kaist-kr-saved',
  universityId: 'kaist-kr',
  kind: 'saved',
  urls: ['https://k.example/liste'],
  files: ['data/saved/kaist-kr/liste.html'],
  reader: 'kaist-kr-saved',
  role: 'enrich',
});
const ntu = load({ id: 'ntu-tw', universityId: 'ntu-tw', kind: 'html', urls: ['https://n.example'], reader: 'ntu-tw' });
const all = [kaistSaved, kaist, ntu, poly];

const ids = (target: string) =>
  collectJobs(target, all).map((j) => (j.kind === 'poly' ? `poly:${j.source.id}` : `${j.universityId}:${j.sources.map((s) => s.id).join('+')}`));

describe('collectJobs', () => {
  it('par université : toutes ses sources, la fiche <universityId>.json d’abord', () => {
    expect(ids('kaist-kr')).toEqual(['kaist-kr:kaist-kr+kaist-kr-saved']);
  });

  it('par source qui partage son université : toute l’université', () => {
    expect(ids('kaist-kr-saved')).toEqual(['kaist-kr:kaist-kr+kaist-kr-saved']);
  });

  it('une université à une seule source, nommée par l’id de sa source (égal à celui de l’université)', () => {
    expect(ids('ntu-tw')).toEqual(['ntu-tw:ntu-tw']);
  });

  it('la source de Poly à part', () => {
    expect(ids('poly-log')).toEqual(['poly:poly-log']);
  });

  it('all : chaque université une fois, et Poly, par ordre alphabétique', () => {
    expect(ids('all')).toEqual(['kaist-kr:kaist-kr+kaist-kr-saved', 'ntu-tw:ntu-tw', 'poly:poly-log']);
  });

  it('cible inconnue : aucune collecte', () => {
    expect(ids('inconnue')).toEqual([]);
  });
});

describe('parseCollectArgs', () => {
  it('une cible seule', () => {
    expect(parseCollectArgs(['ntu-tw'])).toEqual({ target: 'ntu-tw' });
  });
  it('--accept-loss et sa raison, avant ou après la cible', () => {
    expect(parseCollectArgs(['ntu-tw', '--accept-loss', 'Liste réduite par NTU'])).toEqual({ target: 'ntu-tw', acceptLoss: 'Liste réduite par NTU' });
    expect(parseCollectArgs(['--accept-loss', 'Liste réduite', 'ntu-tw'])).toEqual({ target: 'ntu-tw', acceptLoss: 'Liste réduite' });
  });
  it('refuse --accept-loss sans raison', () => {
    expect(parseCollectArgs(['ntu-tw', '--accept-loss'])).toMatchObject({ error: expect.stringMatching(/raison/) });
    expect(parseCollectArgs(['ntu-tw', '--accept-loss', '  '])).toMatchObject({ error: expect.stringMatching(/raison/) });
  });
  it('refuse --accept-loss avec all : une seule université à la fois', () => {
    expect(parseCollectArgs(['all', '--accept-loss', 'x'])).toMatchObject({ error: expect.stringMatching(/une seule/) });
  });
  it('refuse une option inconnue, une deuxième cible ou aucune cible', () => {
    expect(parseCollectArgs(['ntu-tw', '--force'])).toHaveProperty('error');
    expect(parseCollectArgs(['ntu-tw', 'kaist-kr'])).toHaveProperty('error');
    expect(parseCollectArgs([])).toHaveProperty('error');
  });
});
