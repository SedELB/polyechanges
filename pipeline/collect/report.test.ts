import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_END, BLOCK_START, renderReport, writeReport, type ReportInput } from './report.js';

const input: ReportInput = { sourceId: 'x-tw', date: '2026-11-10', status: 'ok', courseCount: 3, diff: null, reason: null };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'polyechanges-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeReport', () => {
  it('un nouveau fichier reçoit le bloc délimité par les deux marques', () => {
    const path = writeReport(dir, input);
    expect(readFileSync(path, 'utf8')).toBe(`${BLOCK_START}\n${renderReport(input)}${BLOCK_END}\n`);
  });
  it('ne remplace que son bloc et garde les notes écrites à la main', () => {
    const path = writeReport(dir, input);
    const notes = '\nVérification de 5 cours\n- A : conforme\n';
    writeFileSync(path, `Avant\n${readFileSync(path, 'utf8')}${notes}`);
    writeReport(dir, { ...input, courseCount: 9 });
    const after = readFileSync(path, 'utf8');
    expect(after).toBe(`Avant\n${BLOCK_START}\n${renderReport({ ...input, courseCount: 9 })}${BLOCK_END}\n${notes}`);
  });
  it('un fichier sans marques garde son contenu sous le nouveau bloc', () => {
    const path = join(dir, '2026-11-10-x-tw.txt');
    writeFileSync(path, 'Notes à la main\n');
    writeReport(dir, input);
    expect(readFileSync(path, 'utf8')).toBe(`${BLOCK_START}\n${renderReport(input)}${BLOCK_END}\n\nNotes à la main\n`);
  });
  it('est idempotent', () => {
    const path = writeReport(dir, input);
    const once = readFileSync(path, 'utf8');
    writeReport(dir, input);
    expect(readFileSync(path, 'utf8')).toBe(once);
  });
});

describe('renderReport, avertissements', () => {
  it('écrit les avertissements en tête du rapport', () => {
    const text = renderReport({ ...input, warnings: ['Pages enregistrées le 2025-01-05 : à réenregistrer depuis un navigateur (source s)'] });
    expect(text.split('\n')[0]).toBe('Pages enregistrées le 2025-01-05 : à réenregistrer depuis un navigateur (source s)');
    expect(text.split('\n')[1]).toBe('Rapport de collecte : x-tw');
  });
  it('sans avertissement, le rapport commence par son titre', () => {
    expect(renderReport(input).split('\n')[0]).toBe('Rapport de collecte : x-tw');
  });
});

describe('writeReport, lignes permanentes', () => {
  const lossLine = '2026-11-10T09:12Z Perte acceptée (--accept-loss) : catalogue réduit';
  it('les écrit après la marque de fin, et une autre écriture du même jour les garde', () => {
    const path = writeReport(dir, { ...input, permanent: [lossLine] });
    expect(readFileSync(path, 'utf8')).toBe(`${BLOCK_START}\n${renderReport(input)}${BLOCK_END}\n${lossLine}\n`);
    writeReport(dir, { ...input, courseCount: 9 });
    expect(readFileSync(path, 'utf8')).toBe(`${BLOCK_START}\n${renderReport({ ...input, courseCount: 9 })}${BLOCK_END}\n${lossLine}\n`);
  });
  it('ajoute les suivantes à la fin, dans l’ordre, après les notes à la main', () => {
    const path = writeReport(dir, { ...input, permanent: [lossLine] });
    writeFileSync(path, `${readFileSync(path, 'utf8')}Note à la main\n`);
    const next = '2026-11-10T15:40Z Perte acceptée (--accept-loss) : deuxième baisse';
    writeReport(dir, { ...input, permanent: [next] });
    expect(readFileSync(path, 'utf8')).toBe(`${BLOCK_START}\n${renderReport(input)}${BLOCK_END}\n${lossLine}\nNote à la main\n${next}\n`);
  });
});
