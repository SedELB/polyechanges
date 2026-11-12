import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  contestVersion,
  contestVersionsOnDisk,
  directorySize,
  prepareContest,
  readRuns,
  recordRun,
} from '../calibration/contest.js';
import { formatReport, type CandidateLine } from '../calibration/report.js';
import { drawSample, parsePairId, sampleFile, SAMPLE_SIZE, type SampleFile } from '../calibration/sample.js';
import { computedJudgments, gridSearch, JUDGMENTS, pickWinner, type Judgment } from '../calibration/score.js';
import { runCompare } from '../compare/compare.js';
import { createLocalEmbedder, type Embedder } from '../criterion/embedder.js';
import { CRITERION_DIR, loadCriterion } from '../criterion/loadCriterion.js';
import { modelsDir } from '../criterion/modelsDir.js';
import { openDb, type Db } from '../db/open.js';
import { syncUniversities } from '../partners/registry.js';

const CALIBRATION_DIR = 'data/calibration';
const SAMPLE_FILE = join(CALIBRATION_DIR, 'sample.json');
const JUDGMENTS_FILE = join(CALIBRATION_DIR, 'judgments.json');
const RUNS_FILE = join(CALIBRATION_DIR, 'runs.json');
const EXCLUDED_FILE = join(CALIBRATION_DIR, 'excluded.json');
const REPORT_FILE = join(CALIBRATION_DIR, 'report.txt');
const DB_FILE = 'data/polyechanges.sqlite';

const USAGE = [
  'Usage :',
  '  npm run calibrate:prepare -- <slug> [--notions <fichier>]   prépare data/criterion/contest-<slug>/',
  '  npm run calibrate:run -- <slug> [--notions <fichier>]       prépare, compare et mesure le candidat',
  '  npm run calibrate:sample -- --seed <n>                      tire data/calibration/sample.json',
  '  npm run calibrate:score                                     calibre chaque candidat et écrit report.txt',
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

const judgmentSchema = z.enum(JUDGMENTS as [Judgment, ...Judgment[]]);
const judgmentsSchema = z.record(
  z.string(),
  z.union([judgmentSchema, z.object({ judgment: judgmentSchema, reason: z.string().optional() })]),
);

/** Jugements du juge à l'aveugle, une entrée par paire de l'échantillon, ni plus ni moins. */
function readJudgments(sampleIds: string[]): { judgments: Record<string, Judgment>; reasons: Record<string, string> } {
  if (!existsSync(JUDGMENTS_FILE)) throw new Error(`${JUDGMENTS_FILE} est absent : l'échantillon doit d'abord être jugé`);
  const raw = judgmentsSchema.parse(JSON.parse(readFileSync(JUDGMENTS_FILE, 'utf8')));
  const missing = sampleIds.filter((id) => !(id in raw));
  const extra = Object.keys(raw).filter((id) => !sampleIds.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Jugements et échantillon ne correspondent pas (manquants : ${missing.join(', ') || 'aucun'} ; en trop : ${extra.join(', ') || 'aucun'})`);
  }
  const judgments: Record<string, Judgment> = {};
  const reasons: Record<string, string> = {};
  for (const [id, v] of Object.entries(raw)) {
    judgments[id] = typeof v === 'string' ? v : v.judgment;
    if (typeof v !== 'string' && v.reason) reasons[id] = v.reason;
  }
  return { judgments, reasons };
}

function score(): void {
  const sampleData = JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')) as SampleFile;
  if (sampleData.pairs.length !== SAMPLE_SIZE) throw new Error(`L'échantillon compte ${sampleData.pairs.length} paires au lieu de ${SAMPLE_SIZE}`);
  const { judgments, reasons } = readJudgments(sampleData.pairs.map((p) => p.pairId));
  const runs = readRuns(RUNS_FILE);
  const excluded = existsSync(EXCLUDED_FILE)
    ? (JSON.parse(readFileSync(EXCLUDED_FILE, 'utf8')) as { model: string; reason: string }[])
    : [];
  const versions = contestVersionsOnDisk();

  withDb((db) => {
    const candidates: CandidateLine[] = versions.map((version) => {
      const { model } = loadCriterion(version).params;
      return {
        version,
        modelId: model.id,
        revision: model.revision,
        sizeMillions: model.sizeMillions,
        run: runs[model.slug] ?? null,
        result: gridSearch(db, version, judgments),
      };
    });
    const winner = pickWinner(candidates.map((c) => ({ version: c.version, sizeMillions: c.sizeMillions, agreement: c.result.agreement })));
    const best = candidates.find((c) => c.version === winner) as CandidateLine;
    const computed = computedJudgments(db, winner, Object.keys(judgments).sort(), best.result);
    const entries = new Map(sampleData.pairs.map((p) => [p.pairId, p]));
    const disagreements = Object.keys(computed)
      .filter((id) => computed[id] !== judgments[id])
      .map((id) => {
        const p = entries.get(id);
        const { polySigle } = parsePairId(id);
        return {
          pairId: id,
          label: p ? `${polySigle} / ${p.university} ${p.hostCourse.code} ${p.hostCourse.title}` : polySigle,
          computed: computed[id],
          judged: judgments[id],
          reason: reasons[id] ?? null,
        };
      });
    const judged = Object.fromEntries(JUDGMENTS.map((j) => [j, Object.values(judgments).filter((x) => x === j).length])) as Record<
      Judgment,
      number
    >;
    const levels = db
      .prepare("SELECT COALESCE(level, 'aucun') AS level, COUNT(*) AS n FROM matches WHERE criterion_version = 'v0' GROUP BY 1 ORDER BY 1")
      .all() as { level: string; n: number }[];
    const text = formatReport({
      sampleSize: sampleData.pairs.length,
      seed: sampleData.seed,
      judged,
      candidates,
      winner,
      disagreements,
      excluded,
      v0Levels: { total: levels.reduce((a, l) => a + l.n, 0), byLevel: Object.fromEntries(levels.map((l) => [l.level, l.n])) },
    });
    writeFileSync(REPORT_FILE, text, 'utf8');
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
    else if (command === 'score') score();
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
