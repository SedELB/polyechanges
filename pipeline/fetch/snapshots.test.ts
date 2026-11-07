import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/open.js';
import { createPoliteFetcher } from './politeFetch.js';
import { readSnapshot, takeSnapshot } from './snapshots.js';
import { startTestServer, type TestServer } from './testServer.js';

let server: TestServer;
let tmp: string;
let db: Db;
const fetcher = createPoliteFetcher({ minDelayMs: 0 });

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'polyechanges-'));
  db = openDb(':memory:');
  db.prepare(
    "INSERT INTO universities (id,name,move_on_name,country_code,city,lat,lng,website,credit_system,terms_json,catalog_public) VALUES ('ntu','NTU','NTU','TW','Taipei',0,0,'x','ECTS','[]',1)",
  ).run();
  for (const id of ['ntu-catalogue', 'ntu-pdf']) {
    db.prepare("INSERT INTO sources (id,university_id,kind,url,reader) VALUES (?, 'ntu','html','x','r')").run(id);
  }
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('takeSnapshot', () => {
  it('ne duplique pas un fichier brut identique', async () => {
    const a = await takeSnapshot(db, fetcher, 'ntu-catalogue', `${server.base}/catalogue`, tmp);
    const b = await takeSnapshot(db, fetcher, 'ntu-catalogue', `${server.base}/catalogue`, tmp);
    expect(b.sha256).toBe(a.sha256);
    expect(readdirSync(join(tmp, 'ntu-catalogue'))).toHaveLength(1);
    expect(b.id).not.toBe(a.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toEqual({ n: 2 });
  });

  it('range le fichier sous <source>/<sha256>.html avec un chemin relatif en base', async () => {
    const s = await takeSnapshot(db, fetcher, 'ntu-catalogue', `${server.base}/catalogue`, tmp);
    expect(s.path).toBe(`ntu-catalogue/${s.sha256}.html`);
    expect(s.sourceId).toBe('ntu-catalogue');
    expect(s.url).toBe(`${server.base}/catalogue`);
    expect(s.contentType).toContain('text/html');
    expect(new Date(s.fetchedAt).toString()).not.toBe('Invalid Date');
    const row = db.prepare('SELECT path FROM snapshots WHERE id = ?').get(s.id) as { path: string };
    expect(row.path).toBe(s.path);
    expect(readSnapshot(s, tmp).toString()).toContain('catalogue');
  });

  it("utilise l'extension pdf pour un contenu PDF", async () => {
    const s = await takeSnapshot(db, fetcher, 'ntu-pdf', `${server.base}/pdf`, tmp);
    expect(s.path).toBe(`ntu-pdf/${s.sha256}.pdf`);
    expect(readSnapshot(s, tmp).toString()).toContain('%PDF');
  });
});
