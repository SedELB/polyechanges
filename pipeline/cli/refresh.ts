import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { latestFrozenVersion, refreshVersion } from '../criterion/frozen.js';
import { emptySkippedLines, missingSavedPages, skippedSavedWarning } from '../collect/saved.js';
import { loadSourceFiles } from '../collect/sourceFile.js';
import { openDb } from '../db/open.js';

/**
 * Étapes de collecte, dans l'ordre. La comparaison et l'export suivent, pour une version du critère.
 * `collect -- all` collecte par université, toutes ses sources ensemble ; une source `saved` relit les fichiers
 * enregistrés présents, et le rapport de l'université signale en tête ceux qui ont plus de 300 jours ; un fichier absent fait ignorer l'université.
 */
const COLLECT_STEPS: { label: string; args: string[] }[] = [
  { label: 'partners:check', args: ['run', 'partners:check'] },
  { label: 'collect -- all', args: ['run', 'collect', '--', 'all'] },
  { label: 'refresh-sources', args: ['run', 'refresh-sources'] },
];

/**
 * Avertissement des pages enregistrées absentes (universités ignorées par la collecte), ou nul s'il n'en manque aucune.
 * En tête : Poly et les universités ignorées qui n'ont aucun cours en base (export refusé, « catalogue non lu »).
 */
function missingPagesWarning(): string | null {
  const sources = loadSourceFiles('data/sources');
  const files = sources.flatMap((s) => missingSavedPages(s).map((m) => m.file));
  if (files.length === 0) return null;
  mkdirSync('data', { recursive: true });
  const db = openDb('data/polyechanges.sqlite');
  let empty: string[];
  try {
    empty = emptySkippedLines(db, sources);
  } finally {
    db.close();
  }
  return [...empty, skippedSavedWarning(files), '(les cours déjà en base de ces universités restent tels quels)'].join('\n');
}

function main(): number {
  // La dernière version gelée du dépôt (data/criterion/v<N>/FROZEN.json), même sur une base neuve.
  const chosen = refreshVersion(process.argv[2], latestFrozenVersion());
  if ('error' in chosen) {
    console.error(chosen.error);
    return 1;
  }
  const { version } = chosen;
  const STEPS = [
    ...COLLECT_STEPS,
    { label: `compare -- ${version}`, args: ['run', 'compare', '--', version] },
    { label: `export -- ${version}`, args: ['run', 'export', '--', version] },
  ];
  // Dit d'emblée ce qui sera ignoré, avant les sorties des étapes.
  const before = missingPagesWarning();
  if (before) console.warn(`${before}\n`);
  for (const [i, step] of STEPS.entries()) {
    console.log(`Étape ${i + 1} sur ${STEPS.length} : ${step.label}`);
    const r = spawnSync('npm', step.args, { stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      const missing = missingPagesWarning();
      if (missing) console.warn(`\n${missing}`);
      console.error(`Arrêt : l'étape « ${step.label} » a échoué (code ${r.status ?? 'inconnu'}). Les étapes suivantes n'ont pas été lancées.`);
      return 1;
    }
  }
  const missing = missingPagesWarning();
  if (missing) console.warn(`\n${missing}`);
  console.log('Rafraîchissement terminé.');
  return 0;
}

process.exitCode = main();
