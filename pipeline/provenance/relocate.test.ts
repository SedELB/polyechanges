import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/open.js';
import { relocateCourses, relocateFactSources } from './relocate.js';

const html = '<html><body><h1>Calendar</h1><table><tr><td>08-30(Mon)</td><td>Fall semester classes begin</td></tr><tr><td>CS101</td><td>Intro</td></tr></table></body></html>';
const QUOTE = '08-30(Mon) | Fall semester classes begin';

let tmp: string;
let rawDir: string;
let path: string;
let sha: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'polyechanges-'));
  rawDir = join(tmp, 'raw');
  path = join(tmp, 'universities.json');
  const body = Buffer.from(html);
  sha = createHash('sha256').update(body).digest('hex');
  mkdirSync(join(rawDir, 'facts-x'), { recursive: true });
  writeFileSync(join(rawDir, 'facts-x', `${sha}.html`), body);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const prov = (line: number, quote: string, hash = sha) => ({
  url: 'https://example.org/c',
  retrievedAt: '2026-11-10T00:00:00.000Z',
  sha256: hash,
  locator: { page: 1, line },
  quote,
});
function write(provenance: Record<string, unknown>): void {
  writeFileSync(path, `${JSON.stringify([{ id: 'x', name: 'X', provenance }], null, 2)}\n`);
}

describe('relocateFactSources', () => {
  it('met à jour un fait déplacé sans toucher au reste', async () => {
    write({ 'terms.fall.start': prov(9, QUOTE) });
    const r = await relocateFactSources(path, rawDir);
    expect(r).toMatchObject({ total: 1, unchanged: 0, moved: [{ universityId: 'x', fact: 'terms.fall.start', to: { page: 1, line: 2 } }], problems: [] });
    const p = JSON.parse(readFileSync(path, 'utf8'))[0].provenance['terms.fall.start'];
    expect(p).toEqual(prov(2, QUOTE));
  });
  it('laisse un fait inchangé et n’écrit pas le fichier', async () => {
    write({ a: prov(2, QUOTE) });
    const before = readFileSync(path, 'utf8');
    const mtime = statSync(path).mtimeMs;
    const r = await relocateFactSources(path, rawDir);
    expect(r).toMatchObject({ total: 1, unchanged: 1, moved: [], problems: [] });
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(statSync(path).mtimeMs).toBe(mtime);
  });
  it('signale un extrait introuvable ou une copie absente sans rien changer', async () => {
    write({ a: prov(3, 'Fall semester classes end'), b: prov(3, QUOTE, 'f'.repeat(64)) });
    const before = readFileSync(path, 'utf8');
    const r = await relocateFactSources(path, rawDir);
    expect(r.problems.map((p) => [p.fact, p.status])).toEqual([['a', 'introuvable'], ['b', 'copie_absente']]);
    expect(r.moved).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

describe('relocateCourses', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
  });
  afterEach(() => db.close());

  it('recalcule les positions des cours d’hôte et de Poly depuis les copies brutes', async () => {
    db.prepare("INSERT INTO universities (id, name, move_on_name, country_code, city, lat, lng, website, credit_system, terms_json, catalog_public) VALUES ('x', 'U', 'U', 'TW', '', 0, 0, '', 'local', '{}', 1)").run();
    db.prepare("INSERT INTO sources (id, university_id, kind, url, reader) VALUES ('facts-x', 'x', 'html', 'https://example.org/c', 'none')").run();
    const snap = db.prepare("INSERT INTO snapshots (source_id, url, fetched_at, sha256, path, content_type) VALUES ('facts-x', 'https://example.org/c', '2026-11-10', ?, ?, 'text/html')").run(sha, `facts-x/${sha}.html`);
    const ins = db.prepare("INSERT INTO host_courses (university_id, code, title, description, language, terms_json, level, source_url, snapshot_id, collected_at, source_page, source_line) VALUES ('x', ?, 't', 'd', 'en', '[]', 'undergrad', 'https://example.org/c', ?, '2026-11-10', 7, 7)");
    ins.run('CS101', Number(snap.lastInsertRowid));
    ins.run('ZZ999', Number(snap.lastInsertRowid));
    const poly = db.prepare("INSERT INTO poly_courses (sigle, title, description, credits, triplet_json, prerequisites, status, eligible, compared, source_url, collected_at, source_locator_json) VALUES (?, 't', 'd', 3, '[]', '', 'optionnel', 1, 0, 'u', '2026-11-10', ?)");
    poly.run('CS101', JSON.stringify({ sha256: sha, page: 1, line: 9 }));
    poly.run('ABC1', JSON.stringify({ sha256: 'e'.repeat(64), page: 1, line: 4 }));

    const r = await relocateCourses(db, rawDir);
    expect(r).toEqual({ host: { changed: 2, total: 2 }, poly: { changed: 1, total: 2 } });
    const rows = db.prepare('SELECT code, source_page, source_line FROM host_courses ORDER BY code').all();
    expect(rows).toEqual([{ code: 'CS101', source_page: 1, source_line: 3 }, { code: 'ZZ999', source_page: null, source_line: null }]);
    const locs = db.prepare('SELECT sigle, source_locator_json FROM poly_courses ORDER BY sigle').all() as { sigle: string; source_locator_json: string }[];
    expect(JSON.parse(locs[0].source_locator_json)).toEqual({ sha256: 'e'.repeat(64), page: 1, line: 4 });
    expect(JSON.parse(locs[1].source_locator_json)).toEqual({ sha256: sha, page: 1, line: 3 });
  });
});

describe('relocateFactSources, extrait sur plusieurs lignes', () => {
  it('recale un extrait réparti sur deux lignes sur sa première ligne', async () => {
    const body = Buffer.from('<body><div>03-03</div><div>Classes begin</div></body>');
    const hash = createHash('sha256').update(body).digest('hex');
    writeFileSync(join(rawDir, 'facts-x', `${hash}.html`), body);
    write({ a: prov(7, '03-03 Classes begin', hash) });
    const r = await relocateFactSources(path, rawDir);
    expect(r).toMatchObject({ unchanged: 0, moved: [{ to: { page: 1, line: 1 } }], problems: [] });
    expect(JSON.parse(readFileSync(path, 'utf8'))[0].provenance.a.locator).toEqual({ page: 1, line: 1 });
  });
});

describe('relocateFactSources avec contexte', () => {
  it('recale aussi la position du contexte', async () => {
    const doc = '<html><body><p>2026 Academic Calendar</p><p>08-30(Mon) Fall classes begin</p></body></html>';
    const body = Buffer.from(doc);
    const h = createHash('sha256').update(body).digest('hex');
    writeFileSync(join(rawDir, 'facts-x', `${h}.html`), body);
    write({ 'terms.fall.start': { ...prov(2, '08-30(Mon) Fall classes begin', h), context: { locator: { page: 1, line: 7 }, quote: '2026 Academic Calendar' } } });
    const r = await relocateFactSources(path, rawDir);
    expect(r.moved).toHaveLength(1);
    const p = JSON.parse(readFileSync(path, 'utf8'))[0].provenance['terms.fall.start'];
    expect(p.locator).toEqual({ page: 1, line: 2 });
    expect(p.context).toEqual({ locator: { page: 1, line: 1 }, quote: '2026 Academic Calendar' });
  });
});

describe('relocateFactSources : ordre du contexte', () => {
  it('choisit l’occurrence du contexte avant l’extrait principal', async () => {
    const doc = '<html><body><p>2026 Academic Calendar</p><p>08-30(Mon) Fall classes begin</p><p>2026 Academic Calendar</p></body></html>';
    const body = Buffer.from(doc);
    const h = createHash('sha256').update(body).digest('hex');
    writeFileSync(join(rawDir, 'facts-x', `${h}.html`), body);
    write({ 'terms.fall.start': { ...prov(9, '08-30(Mon) Fall classes begin', h), context: { locator: { page: 1, line: 3 }, quote: '2026 Academic Calendar' } } });
    const r = await relocateFactSources(path, rawDir);
    expect(r.problems).toEqual([]);
    const p = JSON.parse(readFileSync(path, 'utf8'))[0].provenance['terms.fall.start'];
    expect(p.locator).toEqual({ page: 1, line: 2 });
    expect(p.context.locator).toEqual({ page: 1, line: 1 });
  });
  it('signale un contexte sans occurrence avant le principal, sans l’écrire', async () => {
    const doc = '<html><body><p>08-30(Mon) Fall classes begin</p><p>Calendar 2026 here</p></body></html>';
    const body = Buffer.from(doc);
    const h = createHash('sha256').update(body).digest('hex');
    writeFileSync(join(rawDir, 'facts-x', `${h}.html`), body);
    write({ 'terms.fall.start': { ...prov(5, '08-30(Mon) Fall classes begin', h), context: { locator: { page: 1, line: 1 }, quote: 'Calendar 2026 here' } } });
    const before = readFileSync(path, 'utf8');
    const r = await relocateFactSources(path, rawDir);
    expect(r.problems.map((q) => q.status)).toContain('contexte_invalide');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
