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
