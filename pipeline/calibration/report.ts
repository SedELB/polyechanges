import { round3 } from '../../shared/workload.js';
import type { ContestRun } from './contest.js';
import { GRID, JUDGMENTS, MIN_MARGIN, TARGET_AGREEMENT, V0_THRESHOLDS, meetsTarget, type Judgment, type Thresholds } from './score.js';

export interface SampleSummary {
  label: string;
  file: string;
  judgmentsFile: string;
  seed: number;
  /** Comment les paires ont été tirées, en quelques mots. */
  draw: string;
  size: number;
  judged: Record<Judgment, number>;
  /** Accord du critère trivial (tout « pas_equivalent ») sur cet échantillon. */
  trivial: number;
}

export interface CandidateLine {
  version: string;
  modelId: string;
  revision: string;
  sizeMillions: number;
  run: ContestRun | null;
  /** Seuils calibrés et accord sur toutes les paires jugées. */
  result: Thresholds & { agreement: number };
  /** Accord avec ces seuils sur chaque échantillon, dans l'ordre de `samples`. */
  bySample: number[];
  /** Kappa de Cohen sur toutes les paires, pour information. */
  kappa: number;
}

export interface Disagreement {
  pairId: string;
  sample: string;
  /** Cours de Poly et cours d'accueil, lisibles. */
  label: string;
  computed: Judgment;
  judged: Judgment;
  reason: string | null;
}

export interface ReportInput {
  samples: SampleSummary[];
  /** Accord du critère trivial sur toutes les paires jugées. */
  trivial: number;
  /** Grilles de notions utilisées par les candidats, en une phrase. */
  grids: string;
  candidates: CandidateLine[];
  winner: string;
  /** Matrice de confusion du gagnant : `confusion[jugé][calculé]`. */
  confusion: Record<Judgment, Record<Judgment, number>>;
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
  const total = r.samples.reduce((n, s) => n + s.size, 0);
  const target = Math.max(TARGET_AGREEMENT, round3(r.trivial + MIN_MARGIN));
  const reached = meetsTarget(winner.result.agreement, r.trivial);
  const range = (xs: number[]) => `${xs[0].toFixed(2)} à ${xs[xs.length - 1].toFixed(2)}`;
  const counts = (judged: Record<Judgment, number>) => JUDGMENTS.map((j) => `${j} ${judged[j] ?? 0}`).join(', ');
  const lines: string[] = [
    'Concours des modèles et calibration du critère',
    '',
    'Échantillons, chacun jugé à l’aveugle par un juge distinct (sans code, score ni modèle) :',
    ...r.samples.map(
      (s) =>
        `  ${s.label} : ${s.size} paires décrites (${s.file}, graine ${s.seed}, ${s.draw}), jugements ${s.judgmentsFile} : ${counts(s.judged)} ; critère trivial ${s.trivial.toFixed(3)}.`,
    ),
    `Ensemble : ${total} paires ; critère trivial (tout « pas_equivalent ») ${r.trivial.toFixed(3)}.`,
    r.grids,
    `Cible du gel : accord d'au moins ${TARGET_AGREEMENT} sur les ${total} paires et d'au moins ${MIN_MARGIN} de plus que le critère trivial, soit ${target}.`,
    `Grille : détection ${range(GRID.detectThreshold)}, « très » ${range(GRID.bandHigh)}, « partiel » ${range(GRID.bandLow)}, par pas de 0.05, calibrée sur les ${total} paires.`,
    `À accord égal : seuils les plus proches de v0 (${V0_THRESHOLDS.detectThreshold} / ${V0_THRESHOLDS.bandHigh} / ${V0_THRESHOLDS.bandLow}) ; entre candidats, le plus petit modèle. Kappa de Cohen (4 classes, non pondéré) : pour information.`,
    'Durée : calcul de toutes les paires au premier passage du modèle ; textes : textes absents du cache de vecteurs, calculés pendant ce passage ; chargement : téléchargement compris.',
    '',
    'Candidats',
    ...table([
      [
        'candidat', 'modèle@révision', 'taille', 'disque', 'chargement', 'durée', 'textes',
        'accord', ...r.samples.map((s) => s.label.replace('échantillon ', 'éch. ')), 'kappa', 'détection', 'très', 'partiel',
      ],
      ...r.candidates.map((c) => [
        c.version,
        `${c.modelId}@${c.revision.slice(0, 7)}`,
        `${c.sizeMillions} M`,
        size(c.run?.diskBytes ?? null),
        seconds(c.run?.loadSeconds),
        seconds(c.run?.compareSeconds),
        c.run ? String(c.run.embeddedTexts) : '?',
        c.result.agreement.toFixed(3),
        ...c.bySample.map((a) => a.toFixed(3)),
        c.kappa.toFixed(3),
        c.result.detectThreshold.toFixed(2),
        c.result.bandHigh.toFixed(2),
        c.result.bandLow.toFixed(2),
      ]),
    ]).map((l) => `  ${l}`),
    '',
    `Gagnant : ${r.winner} (accord ${winner.result.agreement} sur ${total} paires ; cible ${target} : ${reached ? 'atteinte' : 'non atteinte'})`,
    '',
    'Matrice de confusion du gagnant (lignes : jugement ; colonnes : niveau calculé)',
    ...table([
      ['jugé \\ calculé', ...JUDGMENTS],
      ...JUDGMENTS.map((j) => [j, ...JUDGMENTS.map((c) => String(r.confusion[j][c]))]),
    ]).map((l) => `  ${l}`),
    '',
    `Paires en désaccord pour le gagnant (${r.disagreements.length})`,
    ...r.disagreements.map(
      (d) =>
        `  ${d.pairId}  [${d.sample}] ${d.label} : calculé ${d.computed}, jugé ${d.judged}.${d.reason ? ` Juge : « ${d.reason} »` : ''}`,
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
