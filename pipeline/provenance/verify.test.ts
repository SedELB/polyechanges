import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Provenance, University } from '../../shared/types.js';
import { parseUniversities } from '../partners/registry.js';
import { makePdf } from './testPdf.js';
import { missingProvenance, verifyAll, verifyProvenance } from './verify.js';

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
