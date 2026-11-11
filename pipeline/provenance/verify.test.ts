import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Provenance, University } from '../../shared/types.js';
import { parseUniversities } from '../partners/registry.js';
import { makePdf } from './testPdf.js';
import { contextProblem, missingProvenance, verifyAll, verifyProvenance } from './verify.js';

const html = '<html><body><h1>Academic Calendar</h1><ul><li>Fall semester begins: September 7, 2026</li><li>Final exams end: January 8, 2027</li></ul></body></html>';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let rawDir: string;
beforeEach(() => {
  rawDir = mkdtempSync(join(tmpdir(), 'polyechanges-'));
});
afterEach(() => rmSync(rawDir, { recursive: true, force: true }));

function store(body: Buffer, ext: string): string {
  const hash = sha(body);
  mkdirSync(join(rawDir, 'facts-x'), { recursive: true });
  writeFileSync(join(rawDir, 'facts-x', `${hash}.${ext}`), body);
  return hash;
}
const prov = (sha256: string, line: number, quote: string): Provenance => ({
  url: 'https://example.org/c',
  retrievedAt: '2026-11-10T00:00:00.000Z',
  sha256,
  locator: { page: 1, line },
  quote,
});

describe('verifyProvenance', () => {
  it('distingue inchangé, déplacé, introuvable et copie absente', async () => {
    const hash = store(Buffer.from(html), 'html');
    const q = 'Fall semester begins: September 7, 2026';
    expect(await verifyProvenance(prov(hash, 2, q), rawDir)).toEqual({ status: 'inchangé', found: { page: 1, line: 2 } });
    expect(await verifyProvenance(prov(hash, 3, q), rawDir)).toEqual({ status: 'déplacé', found: { page: 1, line: 2 } });
    expect(await verifyProvenance(prov(hash, 2, 'Fall semester begins: October 1'), rawDir)).toEqual({ status: 'introuvable', found: null });
    expect(await verifyProvenance(prov('f'.repeat(64), 2, q), rawDir)).toEqual({ status: 'copie_absente', found: null });
  });
  it('vérifie aussi une copie PDF', async () => {
    const hash = store(makePdf([['One'], ['Fall begins: September 7']]), 'pdf');
    const p: Provenance = { ...prov(hash, 1, 'Fall begins: September 7'), locator: { page: 2, line: 1 } };
    expect((await verifyProvenance(p, rawDir)).status).toBe('inchangé');
  });
});

describe('missingProvenance', () => {
  const base: University = {
    id: 'x', name: 'X University', moveOnName: 'X', countryCode: 'TW', city: 'Taipei', lat: 1, lng: 2,
    website: 'https://x.example', catalogUrl: null, creditSystem: 'local', contactHoursPerCredit: null,
    terms: { fall: { start: '2026-09-07', end: '2027-01-08', examsEnd: '2027-01-08' }, spring: null },
    restrictions: null, exchangeContact: null, catalogPublic: true, provenance: {},
  };
  it('signale chaque fait non vide sans source', () => {
    const u: University = { ...base, provenance: { 'terms.fall.start': prov('a'.repeat(64), 1, 'x') } };
    expect(missingProvenance(u)).toEqual([
      'name', 'city', 'coordinates', 'website', 'creditSystem', 'terms.fall.end', 'terms.fall.examsEnd', 'catalogPublic',
    ]);
  });
  it('une date de fin nulle est valide et sans source exigée', () => {
    const u: University = {
      ...base,
      terms: { fall: { start: '2026-09-07', end: null, examsEnd: '2027-01-08' }, spring: null },
      provenance: {},
    };
    expect(parseUniversities([u])).toHaveLength(1);
    expect(missingProvenance(u)).toEqual(['name', 'city', 'coordinates', 'website', 'creditSystem', 'terms.fall.start', 'terms.fall.examsEnd', 'catalogPublic']);
  });
  it('ignore les faits vides et exige une source pour ceux qui sont remplis', () => {
    const u: University = { ...base, city: '', website: '', terms: { fall: null, spring: null }, restrictions: 'Aucune', contactHoursPerCredit: 1 };
    expect(missingProvenance(u)).toEqual(['name', 'coordinates', 'creditSystem', 'contactHoursPerCredit', 'restrictions', 'catalogPublic']);
  });
});

describe('verifyAll', () => {
  const uni = (provenance: Record<string, Provenance>): University => ({
    id: 'x', name: 'X University', moveOnName: 'X', countryCode: 'TW', city: '', lat: 1, lng: 2,
    website: '', catalogUrl: null, creditSystem: 'local', contactHoursPerCredit: null,
    terms: { fall: null, spring: null }, restrictions: null, exchangeContact: null, catalogPublic: true, provenance,
  });
  it('liste les faits stale, déplacés, introuvables et sans copie', async () => {
    const hash = store(Buffer.from(html), 'html');
    const q = 'Fall semester begins: September 7, 2026';
    const res = await verifyAll(
      [uni({
        name: prov(hash, 2, q),
        city: prov(hash, 3, q),
        website: { ...prov(hash, 2, q), stale: true },
        catalogUrl: prov(hash, 2, 'Fall semester begins: October 1'),
        restrictions: prov('f'.repeat(64), 2, q),
      })],
      rawDir,
    );
    expect(res.total).toBe(5);
    expect(res.problems.map((p) => [p.fact, p.status])).toEqual([
      ['city', 'déplacé'],
      ['website', 'stale'],
      ['catalogUrl', 'introuvable'],
      ['restrictions', 'copie_absente'],
    ]);
  });
});

describe('extrait sur plusieurs lignes', () => {
  const multi = '<html><body><div>03-03</div><div>Classes begin</div><div>March</div></body></html>';
  it('verifyProvenance juge sur la première ligne', async () => {
    const hash = store(Buffer.from(multi), 'html');
    const q = '03-03 Classes begin';
    expect(await verifyProvenance(prov(hash, 1, q), rawDir)).toEqual({ status: 'inchangé', found: { page: 1, line: 1 } });
    expect(await verifyProvenance(prov(hash, 3, q), rawDir)).toEqual({ status: 'déplacé', found: { page: 1, line: 1 } });
  });
});

describe('contextProblem', () => {
  const main = prov('a'.repeat(64), 5, 'Classes begin March 3');
  const withCtx = (line: number, quote = '2026 Academic Calendar', page = 1): Provenance => ({ ...main, context: { locator: { page, line }, quote } });
  it('permet un contexte sur une date, avant l’extrait principal', () => {
    expect(contextProblem('terms.fall.start', withCtx(2))).toBeNull();
    expect(contextProblem('terms.spring.examsEnd', withCtx(2))).toBeNull();
    expect(contextProblem('terms.fall.start', main)).toBeNull();
  });
  it('refuse un contexte sur un fait qui n’est pas une date', () => {
    expect(contextProblem('contactHoursPerCredit', withCtx(2))).toMatch(/dates/);
  });
  it('refuse un contexte qui ne précède pas l’extrait principal', () => {
    expect(contextProblem('terms.fall.start', withCtx(5))).toMatch(/précéder/);
    expect(contextProblem('terms.fall.start', withCtx(9))).toMatch(/précéder/);
    expect(contextProblem('terms.fall.start', { ...main, locator: { page: 2, line: 1 }, context: { locator: { page: 1, line: 9 }, quote: '2026 Academic Calendar' } })).toBeNull();
  });
  it('refuse un contexte trop court', () => {
    expect(contextProblem('terms.fall.start', withCtx(2, 'March'))).toMatch(/court/);
  });
});

describe('contexte et vérification hors ligne', () => {
  const doc = '<html><body><h1>2026 Academic Calendar</h1><p>December</p><p>12-14 (Mon) Final exams end</p></body></html>';
  const uni = (provenance: Record<string, Provenance>): University => ({
    id: 'x', name: 'X University', moveOnName: 'X', countryCode: 'TW', city: '', lat: 1, lng: 2,
    website: '', catalogUrl: null, creditSystem: 'local', contactHoursPerCredit: null,
    terms: { fall: null, spring: null }, restrictions: null, exchangeContact: null, catalogPublic: true, provenance,
  });
  const ctx = (line: number, quote: string) => ({ locator: { page: 1, line }, quote });
  it('un contexte exact laisse le fait inchangé', async () => {
    const hash = store(Buffer.from(doc), 'html');
    const p = { ...prov(hash, 3, '12-14 (Mon) Final exams end'), context: ctx(1, '2026 Academic Calendar') };
    expect(await verifyProvenance(p, rawDir)).toEqual({ status: 'inchangé', found: { page: 1, line: 3 }, contextFound: { page: 1, line: 1 } });
    expect((await verifyAll([uni({ 'terms.fall.end': p })], rawDir)).problems).toEqual([]);
  });
  it('un contexte introuvable met le fait en problème', async () => {
    const hash = store(Buffer.from(doc), 'html');
    const p = { ...prov(hash, 3, '12-14 (Mon) Final exams end'), context: ctx(1, '2025 Academic Calendar') };
    expect((await verifyProvenance(p, rawDir)).status).toBe('introuvable');
    expect((await verifyAll([uni({ 'terms.fall.end': p })], rawDir)).problems.map((q) => q.status)).toEqual(['introuvable']);
  });
  it('un contexte déplacé rend le fait déplacé', async () => {
    const hash = store(Buffer.from(doc), 'html');
    const p = { ...prov(hash, 3, '12-14 (Mon) Final exams end'), context: ctx(2, '2026 Academic Calendar') };
    expect((await verifyProvenance(p, rawDir)).status).toBe('déplacé');
  });
  it('une règle de contexte non respectée est un problème', async () => {
    const hash = store(Buffer.from(doc), 'html');
    const p = { ...prov(hash, 3, '12-14 (Mon) Final exams end'), context: ctx(1, '2026 Academic Calendar') };
    const res = await verifyAll([uni({ contactHoursPerCredit: p })], rawDir);
    expect(res.problems.map((q) => [q.fact, q.status])).toEqual([['contactHoursPerCredit', 'contexte_invalide']]);
  });
});

describe('contexte répété dans la copie', () => {
  const doc = '<html><body><p>2026 Academic Calendar</p><p>Fall classes begin Sep 7</p><p>2026 Academic Calendar</p><p>12-14 (Mon) Final exams end</p><p>2026 Academic Calendar</p></body></html>';
  const ctx = (line: number) => ({ locator: { page: 1, line }, quote: '2026 Academic Calendar' });
  const uni = (provenance: Record<string, Provenance>): University => ({
    id: 'x', name: 'X University', moveOnName: 'X', countryCode: 'TW', city: '', lat: 1, lng: 2,
    website: '', catalogUrl: null, creditSystem: 'local', contactHoursPerCredit: null,
    terms: { fall: null, spring: null }, restrictions: null, exchangeContact: null, catalogPublic: true, provenance,
  });
  it('retient la dernière occurrence avant l’extrait principal', async () => {
    const hash = store(Buffer.from(doc), 'html');
    const p = { ...prov(hash, 4, '12-14 (Mon) Final exams end'), context: ctx(1) };
    expect(await verifyProvenance(p, rawDir)).toEqual({ status: 'déplacé', found: { page: 1, line: 4 }, contextFound: { page: 1, line: 3 } });
    expect((await verifyProvenance({ ...p, context: ctx(3) }, rawDir)).status).toBe('inchangé');
    expect((await verifyProvenance({ ...p, context: ctx(1) }, rawDir)).status).toBe('déplacé');
  });
  it('principal déplacé et contexte inchangé : déplacé; inverse aussi', async () => {
    const hash = store(Buffer.from(doc), 'html');
    expect((await verifyProvenance({ ...prov(hash, 9, '12-14 (Mon) Final exams end'), context: ctx(3) }, rawDir)).status).toBe('déplacé');
    expect((await verifyProvenance({ ...prov(hash, 4, '12-14 (Mon) Final exams end'), context: ctx(2) }, rawDir)).status).toBe('déplacé');
  });
  it('aucune occurrence avant l’extrait principal : contexte_invalide', async () => {
    const hash = store(Buffer.from(doc), 'html');
    const p = { ...prov(hash, 2, 'Fall classes begin Sep 7'), context: { locator: { page: 1, line: 1 }, quote: 'December' } };
    const html2 = '<html><body><p>Fall classes begin Sep 7</p><p>Month of December</p></body></html>';
    const h2 = store(Buffer.from(html2), 'html');
    const res = await verifyAll([uni({ 'terms.fall.start': { ...p, sha256: h2, locator: { page: 1, line: 2 }, context: { locator: { page: 1, line: 1 }, quote: 'Month of December' } } })], rawDir);
    expect(res.problems.map((q) => q.status)).toEqual(['contexte_invalide']);
  });
});

describe('contexte dans une copie PDF', () => {
  const uni = (provenance: Record<string, Provenance>): University => ({
    id: 'x', name: 'X University', moveOnName: 'X', countryCode: 'TW', city: '', lat: 1, lng: 2,
    website: '', catalogUrl: null, creditSystem: 'local', contactHoursPerCredit: null,
    terms: { fall: null, spring: null }, restrictions: null, exchangeContact: null, catalogPublic: true, provenance,
  });
  const TITLE = '2026 Fall Academic Calendar';
  const MAIN = 'Sept 14 Classes Begin';
  const withCtx = (hash: string, mainLine: number, ctxLine: number, ctxPage = 1): Provenance => ({
    ...prov(hash, mainLine, MAIN),
    context: { locator: { page: ctxPage, line: ctxLine }, quote: TITLE },
  });
  it('contextProblem : même page permise après l’extrait principal en PDF seulement', () => {
    const p = withCtx('a'.repeat(64), 1, 3);
    expect(contextProblem('terms.fall.start', p, 'pdf')).toBeNull();
    expect(contextProblem('terms.fall.start', p, 'html')).toMatch(/précéder/);
    expect(contextProblem('terms.fall.start', p)).toMatch(/précéder/);
    expect(contextProblem('terms.fall.start', p, null)).toBeNull();
    const later: Provenance = { ...p, context: { locator: { page: 2, line: 1 }, quote: TITLE } };
    expect(contextProblem('terms.fall.start', later, 'pdf')).toMatch(/page/);
  });
  it('titre après les événements, sur la même page : inchangé', async () => {
    const hash = store(makePdf([[MAIN, 'Oct 1 Holiday', TITLE]]), 'pdf');
    const p = withCtx(hash, 1, 3);
    expect(await verifyProvenance(p, rawDir)).toEqual({ status: 'inchangé', found: { page: 1, line: 1 }, contextFound: { page: 1, line: 3 } });
    expect((await verifyAll([uni({ 'terms.fall.start': p })], rawDir)).problems).toEqual([]);
  });
  it('choisit l’occurrence de la page la plus proche, à égalité la plus tôt', async () => {
    const hash = store(makePdf([[TITLE, 'x one', 'x two', MAIN, 'y one', TITLE]]), 'pdf');
    expect((await verifyProvenance(withCtx(hash, 4, 1), rawDir)).contextFound).toEqual({ page: 1, line: 6 });
    const hash2 = store(makePdf([[TITLE, MAIN, 'y one', 'y two', TITLE]]), 'pdf');
    expect((await verifyProvenance(withCtx(hash2, 2, 5), rawDir)).contextFound).toEqual({ page: 1, line: 1 });
    const hash3 = store(makePdf([[TITLE, 'a', MAIN, 'b', TITLE]]), 'pdf');
    expect((await verifyProvenance(withCtx(hash3, 3, 5), rawDir)).contextFound).toEqual({ page: 1, line: 1 });
  });
  it('à défaut de la page, la dernière occurrence d’une page antérieure', async () => {
    const hash = store(makePdf([[TITLE, 'p1'], [TITLE, 'p2'], [MAIN]]), 'pdf');
    const p: Provenance = { ...prov(hash, 1, MAIN), locator: { page: 3, line: 1 }, context: { locator: { page: 1, line: 1 }, quote: TITLE } };
    expect(await verifyProvenance(p, rawDir)).toEqual({ status: 'déplacé', found: { page: 3, line: 1 }, contextFound: { page: 2, line: 1 } });
  });
  it('titre seulement sur une page postérieure : contexte_invalide', async () => {
    const hash = store(makePdf([[MAIN], [TITLE, 'p2']]), 'pdf');
    const p: Provenance = { ...prov(hash, 1, MAIN), context: { locator: { page: 1, line: 1 }, quote: TITLE } };
    const res = await verifyAll([uni({ 'terms.fall.start': { ...p, locator: { page: 1, line: 1 }, context: { locator: { page: 1, line: 2 }, quote: TITLE } } })], rawDir);
    expect(res.problems.map((q) => q.status)).toContain('contexte_invalide');
  });
});
