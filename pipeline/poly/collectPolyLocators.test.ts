import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db/open.js';
import { listPolyCourses } from '../db/polyCourses.js';
import { parseSourceFile } from '../collect/sourceFile.js';
import { collectPoly } from './collectPoly.js';

vi.mock('../provenance/snapshotText.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../provenance/snapshotText.js')>()),
  snapshotText: async () => {
    throw new Error('extraction impossible');
  },
}));

let tmp: string;
let db: Db;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'polyechanges-'));
  db = openDb(':memory:');
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('collectPoly sans extraction de texte', () => {
  it('réussit et laisse les positions nulles', async () => {
    const page = join(tmp, 'programme.html');
    copyFileSync(new URL('./fixtures/programme-extrait.html', import.meta.url), page);
    const source = parseSourceFile({
      id: 'poly-log',
      universityId: null,
      kind: 'saved',
      urls: ['https://www.polymtl.ca/programmes/programmes/baccalaureat-en-genie-logiciel'],
      files: [page],
      reader: 'poly',
    });
    const res = await collectPoly(db, source, join(tmp, 'raw'), '2026-11-10T10:00:00.000Z');
    expect(res.status).toBe('ok');
    const courses = listPolyCourses(db);
    expect(courses).toHaveLength(16);
    expect(courses.every((c) => c.sourceLocator === null)).toBe(true);
  });
});
