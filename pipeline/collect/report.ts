import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectionDiff } from '../db/hostCourses.js';

export interface ReportInput {
  /** Université (un rapport par université, toutes ses sources ensemble) ou source de Poly. */
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
  /** Lignes écrites en tête du rapport (pages enregistrées à réenregistrer). */
  warnings?: string[];
}

const list = (label: string, codes: string[]) =>
  `${label} (${codes.length}) : ${codes.length ? codes.join(', ') : 'aucun'}`;

export function renderReport(r: ReportInput): string {
  const lines = [
    ...(r.warnings ?? []),
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

/** Marques qui délimitent la partie du rapport écrite par la collecte ; le reste du fichier est à la main. */
export const BLOCK_START = '=== collecte automatique ===';
export const BLOCK_END = '=== fin de la collecte automatique ===';

/**
 * Écrit `<dir>/<AAAA-MM-JJ>-<sourceId>.txt` et renvoie son chemin. Seul le bloc entre les deux marques est
 * remplacé ; les notes ajoutées à la main restent. Fichier neuf : le bloc seul. Fichier sans marques : le bloc
 * est placé en tête, le contenu existant suit.
 */
export function writeReport(dir: string, r: ReportInput): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${r.date}-${r.sourceId}.txt`);
  const block = `${BLOCK_START}\n${renderReport(r)}${BLOCK_END}\n`;
  let text = block;
  if (existsSync(path)) {
    const old = readFileSync(path, 'utf8');
    const start = old.indexOf(BLOCK_START);
    const end = old.indexOf(BLOCK_END, start + 1);
    if (start >= 0 && end > start) {
      const tail = old.slice(end + BLOCK_END.length).replace(/^\r?\n/, '');
      text = old.slice(0, start) + block + tail;
    } else if (old !== '') {
      text = `${block}\n${old}`;
    }
  }
  writeFileSync(path, text, 'utf8');
  return path;
}
