import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectionDiff } from '../db/hostCourses.js';

export interface ReportInput {
  sourceId: string;
  /** AAAA-MM-JJ */
  date: string;
  status: 'ok' | 'failed';
  courseCount: number;
  diff: CollectionDiff | null;
  reason: string | null;
  /** Lignes de détail ajoutées à la fin du rapport. */
  notes?: string[];
  /** Note de la fiche d'une source qui ne publie pas de descriptions. */
  descriptionsNote?: string;
}

const list = (label: string, codes: string[]) =>
  `${label} (${codes.length}) : ${codes.length ? codes.join(', ') : 'aucun'}`;

export function renderReport(r: ReportInput): string {
  const lines = [
    `Rapport de collecte : ${r.sourceId}`,
    `Date : ${r.date}`,
    `Statut : ${r.status}`,
    `Cours actifs : ${r.courseCount}`,
  ];
  if (r.diff) {
    lines.push(list('Ajoutés', r.diff.added), list('Retirés', r.diff.removed), list('Modifiés', r.diff.modified));
  }
  if (r.descriptionsNote) lines.push(`Descriptions non publiées : ${r.descriptionsNote}`);
  if (r.notes) lines.push(...r.notes);
  if (r.reason) lines.push(`Raison de l’échec : ${r.reason}`);
  return lines.join('\n') + '\n';
}

/** Écrit `<dir>/<AAAA-MM-JJ>-<sourceId>.txt` et renvoie son chemin. */
export function writeReport(dir: string, r: ReportInput): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${r.date}-${r.sourceId}.txt`);
  writeFileSync(path, renderReport(r), 'utf8');
  return path;
}
