import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/open.js';
import { makePdf } from '../provenance/testPdf.js';
import { findRawCopy } from '../provenance/verify.js';
import { emptySkippedLines, emptySkippedWarning, SAVED_MAX_AGE_DAYS, staleSavedWarning, takeSavedSnapshots } from './saved.js';
import type { SourceFile } from './sourceFile.js';

const SAVED_AT = new Date('2026-10-01T08:30:00.000Z');

let tmp: string;
let rawDir: string;
let db: Db;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'polyechanges-'));
  rawDir = join(tmp, 'raw');
  mkdirSync(join(tmp, 'data', 'saved', 'ntu'), { recursive: true });
  db = openDb(':memory:');
  db.prepare(
    "INSERT INTO universities (id,name,move_on_name,country_code,city,lat,lng,website,credit_system,terms_json,catalog_public) VALUES ('ntu','NTU','NTU','TW','Taipei',0,0,'x','ECTS','[]',1)",
  ).run();
  db.prepare("INSERT INTO sources (id,university_id,kind,url,reader) VALUES ('ntu-liste','ntu','saved','x','r')").run();
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Écrit un fichier enregistré sous `<tmp>/data/saved/ntu/` et renvoie son chemin depuis la racine. */
function save(name: string, body: string | Buffer): string {
  const rel = `data/saved/ntu/${name}`;
  writeFileSync(join(tmp, rel), body);
  utimesSync(join(tmp, rel), SAVED_AT, SAVED_AT);
  return rel;
}

const savedSource = (files: string[], urls = files.map((f) => `https://ntu.example/${f.split('/').pop()}`)): SourceFile => ({
  id: 'ntu-liste',
  universityId: 'ntu',
  kind: 'saved',
  urls,
  files,
  reader: 'r',
});

describe('takeSavedSnapshots', () => {
  it('copie chaque fichier enregistré comme un instantané : sha256, adresse d’origine, date du fichier', () => {
    const html = save('liste.html', '<html><body><p>CSIE1212 Data Structures</p></body></html>');
    const pdf = save('liste.pdf', makePdf([['CSIE1212 Data Structures']]));
    const txt = save('liste.txt', 'CSIE1212\tData Structures\n');
    const htm = save('autre.htm', '<p>x</p>');
    const pages = takeSavedSnapshots(db, savedSource([html, pdf, txt, htm]), rawDir, tmp);

    expect(pages.map((p) => p.snapshot.contentType)).toEqual(['text/html', 'application/pdf', 'text/plain', 'text/html']);
    for (const [i, file] of [html, pdf, txt, htm].entries()) {
      const body = readFileSync(join(tmp, file));
      const sha = createHash('sha256').update(body).digest('hex');
      const ext = ['html', 'pdf', 'txt', 'html'][i];
      expect(pages[i].snapshot).toMatchObject({
        sourceId: 'ntu-liste',
        url: `https://ntu.example/${file.split('/').pop()}`,
        fetchedAt: SAVED_AT.toISOString(),
        sha256: sha,
        path: `ntu-liste/${sha}.${ext}`,
      });
      expect(pages[i].body.equals(body)).toBe(true);
      expect(existsSync(join(rawDir, 'ntu-liste', `${sha}.${ext}`))).toBe(true);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toEqual({ n: 4 });
  });

  it('la copie brute d’un .txt est retrouvée par son empreinte, comme du texte brut', () => {
    const txt = save('liste.txt', 'CSIE1212 Data Structures\n');
    const [page] = takeSavedSnapshots(db, savedSource([txt]), rawDir, tmp);
    expect(findRawCopy(page.snapshot.sha256, rawDir)).toEqual({
      path: join(rawDir, 'ntu-liste', `${page.snapshot.sha256}.txt`),
      contentType: 'text/plain',
    });
  });

  it('fichier absent : échoue en nommant le fichier et en disant de l’enregistrer depuis un navigateur', () => {
    const present = save('liste.html', '<p>x</p>');
    const source = savedSource([present, 'data/saved/ntu/manquant.html']);
    expect(() => takeSavedSnapshots(db, source, rawDir, tmp)).toThrow(/data\/saved\/ntu\/manquant\.html.*navigateur/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toEqual({ n: 0 });
  });

  it('refuse une extension inconnue', () => {
    const doc = save('liste.docx', 'x');
    expect(() => takeSavedSnapshots(db, savedSource([doc]), rawDir, tmp)).toThrow(/liste\.docx/);
  });
});

describe('staleSavedWarning', () => {
  const snap = (fetchedAt: string) => ({ id: 1, sourceId: 's', url: 'u', fetchedAt, sha256: 'a', path: 'p', contentType: 'text/html' });

  it(`signale des pages enregistrées il y a plus de ${SAVED_MAX_AGE_DAYS} jours, avec la plus ancienne date`, () => {
    const warning = staleSavedWarning('kaist-liste', [snap('2025-12-01T10:00:00.000Z'), snap('2025-01-05T23:30:00.000Z')], '2026-11-10T10:00:00.000Z');
    expect(warning).toBe('Pages enregistrées le 2025-01-05 : à réenregistrer depuis un navigateur (source kaist-liste)');
  });

  it('rien pour des pages récentes', () => {
    expect(staleSavedWarning('s', [snap('2026-03-01T10:00:00.000Z')], '2026-11-10T10:00:00.000Z')).toBeNull();
    expect(staleSavedWarning('s', [], '2026-11-10T10:00:00.000Z')).toBeNull();
  });
});

describe('emptySkippedLines : pages absentes et rien en base', () => {
  const polySource: SourceFile = {
    id: 'poly-log', universityId: null, kind: 'saved', urls: ['https://poly.example/programme'],
    files: ['data/manual/poly/programme-LOG.html'], reader: 'poly',
  };

  it('nomme en tête l’université ignorée sans aucun cours et Poly sans aucun cours', () => {
    const lines = emptySkippedLines(db, [savedSource(['data/saved/ntu/absent.html']), polySource], tmp);
    expect(lines).toEqual([
      'Cours de Poly ignorés et absents de la base : l’export sera refusé. Enregistre la page du programme de Poly dans data/manual/poly/programme-LOG.html.',
      'Universités ignorées sans aucun cours en base (le site affichera « catalogue non lu cette année ») : ntu',
    ]);
  });

  it('rien quand l’université ignorée a encore ses cours en base, ou quand ses pages sont là', () => {
    db.prepare(
      "INSERT INTO host_courses (university_id, code, title, description, language, terms_json, level, source_url, collected_at) VALUES ('ntu','C1','T','D','en','[]','undergrad','x','2026-01-01')",
    ).run();
    expect(emptySkippedLines(db, [savedSource(['data/saved/ntu/absent.html'])], tmp)).toEqual([]);
    db.prepare('DELETE FROM host_courses').run();
    expect(emptySkippedLines(db, [savedSource([save('present.html', '<p>x</p>')])], tmp)).toEqual([]);
  });
});

describe('emptySkippedWarning : ligne de tête du rapport d’une collecte ignorée', () => {
  it('université sans cours en base', () => {
    expect(emptySkippedWarning('university', 0)).toBe(
      'Aucun cours de cette université en base : le site affichera « catalogue non lu cette année » au lieu d’une liste de cours.',
    );
  });
  it('Poly sans cours en base', () => {
    expect(emptySkippedWarning('poly', 0)).toBe(
      'Aucun cours de Poly en base : l’export sera refusé tant que la page du programme n’est pas enregistrée.',
    );
  });
  it('rien quand des cours restent en base', () => {
    expect(emptySkippedWarning('university', 3)).toBeNull();
  });
});
