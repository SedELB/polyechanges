import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  contestVersion,
  contestVersionsOnDisk,
  directorySize,
  gridsDescription,
  prepareContest,
  readRuns,
  recordRun,
} from '../calibration/contest.js';
import { formatReport, type CandidateLine } from '../calibration/report.js';
import { drawConsensusSample, drawSample, parsePairId, sampleFile, SAMPLE_SIZE, type SampleFile } from '../calibration/sample.js';
import {
  agreement,
  cohenKappa,
  computedJudgments,
  confusionMatrix,
  gridSearch,
  JUDGMENTS,
  pickWinner,
  trivialAgreement,
  type Judgment,
} from '../calibration/score.js';
import { runCompare } from '../compare/compare.js';
import { createLocalEmbedder, type Embedder } from '../criterion/embedder.js';
import { CRITERION_DIR, loadCriterion } from '../criterion/loadCriterion.js';
import { modelsDir } from '../criterion/modelsDir.js';
import { openDb, type Db } from '../db/open.js';
import { syncUniversities } from '../partners/registry.js';

const CALIBRATION_DIR = 'data/calibration';
const SAMPLE_FILE = join(CALIBRATION_DIR, 'sample.json');
const JUDGMENTS_FILE = join(CALIBRATION_DIR, 'judgments.json');
const SAMPLE_2_FILE = join(CALIBRATION_DIR, 'sample-2.json');
const JUDGMENTS_2_FILE = 'data/calibration/judgments-2.json';
const RUNS_FILE = join(CALIBRATION_DIR, 'runs.json');
const EXCLUDED_FILE = join(CALIBRATION_DIR, 'excluded.json');
const REPORT_FILE = join(CALIBRATION_DIR, 'report.txt');
const DB_FILE = 'data/polyechanges.sqlite';

const USAGE = [
  'Usage :',
  '  npm run calibrate:prepare -- <slug> [--notions <fichier>]   prépare data/criterion/contest-<slug>/',
  '  npm run calibrate:run -- <slug> [--notions <fichier>]       prépare, compare et mesure le candidat',
  '  npm run calibrate:sample -- --seed <n>                      tire data/calibration/sample.json',
  '  npm run calibrate:sample-2 -- --seed <n>                    tire data/calibration/sample-2.json (consensus des candidats)',
  '  npm run calibrate:score [-- --out <fichier>]               calibre chaque candidat et écrit report.txt',
].join('\n');

/** Version exacte de transformers.js épinglée dans package.json. */
function library(): string {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
  const version = pkg.dependencies['@huggingface/transformers'];
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`@huggingface/transformers doit être épinglé à une version exacte (${version})`);
  return `@huggingface/transformers@${version}`;
}

const option = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function withDb<T>(f: (db: Db) => T): T {
  const db = openDb(DB_FILE);
  try {
    return f(db);
  } finally {
    db.close();
  }
}

function prepare(slug: string, args: string[]): void {
  const out = prepareContest(slug, CRITERION_DIR, library(), option(args, '--notions'));
  console.log(`Candidat ${slug} préparé dans ${out}.`);
}

async function run(slug: string, args: string[]): Promise<void> {
  prepare(slug, args);
  const version = contestVersion(slug);
  const criterion = loadCriterion(version);
  const model = criterion.params.model;
  const cacheDir = modelsDir();
  const db = openDb(DB_FILE);
  try {
    syncUniversities(db);
    const loadStart = Date.now();
    const embedder = await createLocalEmbedder(model, cacheDir);
    const loadSeconds = (Date.now() - loadStart) / 1000;
    // runCompare enveloppe l'embedder dans le cache : seuls les textes absents du cache passent ici.
    let embeddedTexts = 0;
    const counting: Embedder = {
      key: embedder.key,
      embed(texts, kind) {
        embeddedTexts += texts.length;
        return embedder.embed(texts, kind);
      },
    };
    const compareStart = Date.now();
    const { pairs } = await runCompare(db, criterion, counting);
    const compareSeconds = (Date.now() - compareStart) / 1000;
    const diskBytes = directorySize(join(cacheDir, model.id, model.revision));
    mkdirSync(CALIBRATION_DIR, { recursive: true });
    recordRun(RUNS_FILE, slug, {
      modelKey: embedder.key,
      pairs,
      loadSeconds: Math.round(loadSeconds * 10) / 10,
      compareSeconds: Math.round(compareSeconds * 10) / 10,
      embeddedTexts,
      diskBytes,
    });
    console.log(
      `${version} : ${pairs} paires en ${compareSeconds.toFixed(1)} s, ${embeddedTexts} textes calculés (chargement ${loadSeconds.toFixed(1)} s, modèle ${((diskBytes ?? 0) / 1e6).toFixed(0)} Mo).`,
    );
  } finally {
    db.close();
  }
}

function sample(args: string[]): void {
  const seed = Number(option(args, '--seed'));
  if (!Number.isInteger(seed)) throw new Error('Indique une graine entière : npm run calibrate:sample -- --seed 42');
  const versions = contestVersionsOnDisk();
  const polyWeeks = loadCriterion('v0').params.polyWeeks;
  const file = withDb((db) => sampleFile(db, drawSample(db, versions, seed), seed, polyWeeks));
  mkdirSync(CALIBRATION_DIR, { recursive: true });
  writeFileSync(SAMPLE_FILE, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  const byUniversity = new Map<string, number>();
  for (const p of file.pairs) byUniversity.set(p.university, (byUniversity.get(p.university) ?? 0) + 1);
  console.log(`${file.pairs.length} paires tirées parmi ${versions.length} candidats (graine ${seed}) dans ${SAMPLE_FILE} :`);
  for (const [u, n] of [...byUniversity].sort()) console.log(`  ${u} : ${n}`);
}

/** Deuxième échantillon : paires du consensus des candidats, hors paires du premier échantillon. */
function sample2(args: string[]): void {
  const seed = Number(option(args, '--seed'));
  if (!Number.isInteger(seed)) throw new Error('Indique une graine entière : npm run calibrate:sample-2 -- --seed 43');
  const versions = contestVersionsOnDisk();
  const first = JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')) as SampleFile;
  const polyWeeks = loadCriterion('v0').params.polyWeeks;
  const file = withDb((db) =>
    sampleFile(db, drawConsensusSample(db, versions, seed, SAMPLE_SIZE, first.pairs.map((p) => p.pairId)), seed, polyWeeks, JUDGMENTS_2_FILE),
  );
  writeFileSync(SAMPLE_2_FILE, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  const n = file.pairs.length;
  console.log(`${n} paires du consensus (graine ${seed}) dans ${SAMPLE_2_FILE}.`);
  if (n < SAMPLE_SIZE) console.log(`Seulement ${n} candidats hors des paires déjà jugées : tous sont pris.`);
}

const judgmentSchema = z.enum(JUDGMENTS as [Judgment, ...Judgment[]]);
const judgmentsSchema = z.record(
  z.string(),
  z.union([judgmentSchema, z.object({ judgment: judgmentSchema, reason: z.string().optional() })]),
);

/** Jugements d'un juge à l'aveugle : une entrée par paire de son échantillon, ni plus ni moins. */
function readJudgments(file: string, sampleIds: string[]): { judgments: Record<string, Judgment>; reasons: Record<string, string> } {
  if (!existsSync(file)) throw new Error(`${file} est absent : l'échantillon doit d'abord être jugé`);
  const raw = judgmentsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const missing = sampleIds.filter((id) => !(id in raw));
  const extra = Object.keys(raw).filter((id) => !sampleIds.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${file} et son échantillon ne correspondent pas (manquants : ${missing.join(', ') || 'aucun'} ; en trop : ${extra.join(', ') || 'aucun'})`,
    );
  }
  const judgments: Record<string, Judgment> = {};
  const reasons: Record<string, string> = {};
  for (const [id, v] of Object.entries(raw)) {
    judgments[id] = typeof v === 'string' ? v : v.judgment;
    if (typeof v !== 'string' && v.reason) reasons[id] = v.reason;
  }
  return { judgments, reasons };
}

/** Les deux échantillons jugés : le premier (meilleurs candidats et hasard), le second (consensus des candidats). */
const SAMPLES = [
  { label: 'échantillon 1', file: SAMPLE_FILE, judgmentsFile: JUDGMENTS_FILE, draw: '3 meilleurs de chaque candidat, 1 sur 5 au hasard' },
  { label: 'échantillon 2', file: SAMPLE_2_FILE, judgmentsFile: JUDGMENTS_2_FILE, draw: 'premiers d’au moins 2 candidats, hors échantillon 1' },
];

function score(args: string[]): void {
  const out = option(args, '--out') ?? REPORT_FILE;
  const samples = SAMPLES.map((s) => {
    const data = JSON.parse(readFileSync(s.file, 'utf8')) as SampleFile;
    if (data.pairs.length !== SAMPLE_SIZE) throw new Error(`${s.file} compte ${data.pairs.length} paires au lieu de ${SAMPLE_SIZE}`);
    return { ...s, data, ...readJudgments(s.judgmentsFile, data.pairs.map((p) => p.pairId)) };
  });
  const judgments: Record<string, Judgment> = Object.assign({}, ...samples.map((s) => s.judgments));
  const reasons: Record<string, string> = Object.assign({}, ...samples.map((s) => s.reasons));
  const ids = Object.keys(judgments).sort();
  if (ids.length !== samples.reduce((n, s) => n + s.data.pairs.length, 0)) throw new Error('Une paire figure dans les deux échantillons');
  const sampleOf = new Map(samples.flatMap((s) => s.data.pairs.map((p) => [p.pairId, { label: s.label, entry: p }] as const)));
  const runs = readRuns(RUNS_FILE);
  const excluded = existsSync(EXCLUDED_FILE)
    ? (JSON.parse(readFileSync(EXCLUDED_FILE, 'utf8')) as { model: string; reason: string }[])
    : [];
  const versions = contestVersionsOnDisk();
  const pairsOf = (computed: Record<string, Judgment>, subset: string[]) => subset.map((id) => ({ computed: computed[id], judged: judgments[id] }));

  withDb((db) => {
    const computedBy = new Map<string, Record<string, Judgment>>();
    const candidates: CandidateLine[] = versions.map((version) => {
      const { model } = loadCriterion(version).params;
      const result = gridSearch(db, version, judgments);
      const computed = computedJudgments(db, version, ids, result);
      computedBy.set(version, computed);
      return {
        version,
        modelId: model.id,
        revision: model.revision,
        sizeMillions: model.sizeMillions,
        run: runs[model.slug] ?? null,
        result,
        bySample: samples.map((s) => agreement(pairsOf(computed, Object.keys(s.judgments)))),
        kappa: cohenKappa(pairsOf(computed, ids)),
      };
    });
    const winner = pickWinner(candidates.map((c) => ({ version: c.version, sizeMillions: c.sizeMillions, agreement: c.result.agreement })));
    const computed = computedBy.get(winner) as Record<string, Judgment>;
    const disagreements = ids
      .filter((id) => computed[id] !== judgments[id])
      .map((id) => {
        const { label, entry } = sampleOf.get(id) as { label: string; entry: SampleFile['pairs'][number] };
        const { polySigle } = parsePairId(id);
        return {
          pairId: id,
          sample: label,
          label: `${polySigle} / ${entry.university} ${entry.hostCourse.code} ${entry.hostCourse.title}`,
          computed: computed[id],
          judged: judgments[id],
          reason: reasons[id] ?? null,
        };
      });
    const counts = (values: Judgment[]) =>
      Object.fromEntries(JUDGMENTS.map((j) => [j, values.filter((x) => x === j).length])) as Record<Judgment, number>;
    const levels = db
      .prepare("SELECT COALESCE(level, 'aucun') AS level, COUNT(*) AS n FROM matches WHERE criterion_version = 'v0' GROUP BY 1 ORDER BY 1")
      .all() as { level: string; n: number }[];
    const text = formatReport({
      samples: samples.map((s) => ({
        label: s.label,
        file: s.file.replaceAll('\\', '/'),
        judgmentsFile: s.judgmentsFile.replaceAll('\\', '/'),
        seed: s.data.seed,
        draw: s.draw,
        size: s.data.pairs.length,
        judged: counts(Object.values(s.judgments)),
        trivial: trivialAgreement(Object.values(s.judgments)),
      })),
      trivial: trivialAgreement(Object.values(judgments)),
      grids: gridsDescription(loadCriterion(winner).notions, loadCriterion('v0').notions),
      candidates,
      winner,
      confusion: confusionMatrix(pairsOf(computed, ids)),
      disagreements,
      excluded,
      v0Levels: { total: levels.reduce((a, l) => a + l.n, 0), byLevel: Object.fromEntries(levels.map((l) => [l.level, l.n])) },
    });
    writeFileSync(out, text, 'utf8');
    console.log(text);
  });
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  const slug = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  try {
    if (command === 'prepare' && slug) prepare(slug, args);
    else if (command === 'run' && slug) await run(slug, args);
    else if (command === 'sample') sample(args);
    else if (command === 'sample-2') sample2(args);
    else if (command === 'score') score(args);
    else {
      console.error(USAGE);
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}

process.exitCode = await main();
