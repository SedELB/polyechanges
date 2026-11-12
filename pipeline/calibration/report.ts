import { round3 } from '../../shared/workload.js';
import type { ContestRun } from './contest.js';
import { GRID, JUDGMENTS, TARGET_AGREEMENT, V0_THRESHOLDS, type Judgment, type Thresholds } from './score.js';

export interface CandidateLine {
  version: string;
  modelId: string;
  revision: string;
  sizeMillions: number;
  run: ContestRun | null;
  result: Thresholds & { agreement: number };
}

export interface Disagreement {
  pairId: string;
  /** Cours de Poly et cours d'accueil, lisibles. */
  label: string;
  computed: Judgment;
  judged: Judgment;
  reason: string | null;
}

export interface ReportInput {
  sampleSize: number;
  seed: number;
  judged: Record<Judgment, number>;
  candidates: CandidateLine[];
  winner: string;
  disagreements: Disagreement[];
  excluded: { model: string; reason: string }[];
  v0Levels: { total: number; byLevel: Record<string, number> };
}

const size = (bytes: number | null): string => {
  if (bytes === null) return '?';
  const mo = bytes / 1e6;
  return mo >= 1000 ? `${(mo / 1000).toFixed(2)} Go` : `${mo.toFixed(0)} Mo`;
};
const seconds = (s: number | undefined): string => (s === undefined ? '?' : `${s.toFixed(1)} s`);

function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd());
}

/** Rapport du concours, en texte : relu par les étudiants avant le gel. */
export function formatReport(r: ReportInput): string {
  const winner = r.candidates.find((c) => c.version === r.winner);
  if (!winner) throw new Error(`Le gagnant ${r.winner} n'est pas parmi les candidats`);
  const reached = winner.result.agreement >= TARGET_AGREEMENT;
  const range = (xs: number[]) => `${xs[0].toFixed(2)} à ${xs[xs.length - 1].toFixed(2)}`;
  const lines: string[] = [
    'Concours des modèles et calibration du critère',
    '',
    `Échantillon : ${r.sampleSize} paires décrites (data/calibration/sample.json, graine ${r.seed}), jugées à l'aveugle (data/calibration/judgments.json).`,
    `Jugements : ${JUDGMENTS.map((j) => `${j} ${r.judged[j] ?? 0}`).join(', ')}.`,
    `Référence : un critère qui ne retiendrait aucune paire obtiendrait un accord de ${round3((r.judged.pas_equivalent ?? 0) / r.sampleSize)}.`,
    `Grille : détection ${range(GRID.detectThreshold)}, « très » ${range(GRID.bandHigh)}, « partiel » ${range(GRID.bandLow)}, par pas de 0.05.`,
    `À accord égal : seuils les plus proches de v0 (${V0_THRESHOLDS.detectThreshold} / ${V0_THRESHOLDS.bandHigh} / ${V0_THRESHOLDS.bandLow}) ; entre candidats, le plus petit modèle.`,
    'Durée : calcul de toutes les paires au premier passage du modèle ; textes : textes absents du cache de vecteurs, calculés pendant ce passage ; chargement : téléchargement compris.',
    '',
    'Candidats',
    ...table([
      ['candidat', 'modèle@révision', 'taille', 'disque', 'chargement', 'durée', 'textes', 'accord', 'détection', 'très', 'partiel'],
      ...r.candidates.map((c) => [
        c.version,
        `${c.modelId}@${c.revision.slice(0, 7)}`,
        `${c.sizeMillions} M`,
        size(c.run?.diskBytes ?? null),
        seconds(c.run?.loadSeconds),
        seconds(c.run?.compareSeconds),
        c.run ? String(c.run.embeddedTexts) : '?',
        c.result.agreement.toFixed(3),
        c.result.detectThreshold.toFixed(2),
        c.result.bandHigh.toFixed(2),
        c.result.bandLow.toFixed(2),
      ]),
    ]).map((l) => `  ${l}`),
    '',
    `Gagnant : ${r.winner} (accord ${winner.result.agreement} ; accord visé ${TARGET_AGREEMENT} : ${reached ? 'atteint' : 'non atteint'})`,
    '',
    `Paires en désaccord pour le gagnant (${r.disagreements.length})`,
    ...r.disagreements.map(
      (d) => `  ${d.pairId}  ${d.label} : calculé ${d.computed}, jugé ${d.judged}.${d.reason ? ` Juge : « ${d.reason} »` : ''}`,
    ),
    '',
    'Candidats écartés',
    ...(r.excluded.length === 0 ? ['  aucun'] : r.excluded.map((e) => `  ${e.model} : ${e.reason}`)),
    '',
    `Niveaux v0 sur la base actuelle (${r.v0Levels.total} paires) : ${Object.entries(r.v0Levels.byLevel)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')}.`,
  ];
  return `${lines.join('\n')}\n`;
}
