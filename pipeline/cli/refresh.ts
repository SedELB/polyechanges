import { spawnSync } from 'node:child_process';
import { openDb } from '../db/open.js';

/**
 * Étapes de collecte, dans l'ordre. La comparaison et l'export suivent, pour une version du critère.
 * `collect -- all` collecte par université, toutes ses sources ensemble ; une source `saved` relit les fichiers
 * enregistrés présents, et le rapport de l'université signale en tête ceux qui ont plus de 300 jours.
 */
const COLLECT_STEPS: { label: string; args: string[] }[] = [
  { label: 'partners:check', args: ['run', 'partners:check'] },
  { label: 'collect -- all', args: ['run', 'collect', '--', 'all'] },
  { label: 'refresh-sources', args: ['run', 'refresh-sources'] },
];

/** Version gelée la plus récente de la base, ou nulle. */
function latestFrozenVersion(): string | null {
  const db = openDb('data/polyechanges.sqlite');
  try {
    const rows = db.prepare('SELECT version FROM criterion_versions WHERE frozen_at IS NOT NULL').all() as { version: string }[];
    const numbers = rows.map((r) => ({ v: r.version, n: Number(r.version.slice(1)) })).sort((a, b) => b.n - a.n);
    return numbers[0]?.v ?? null;
  } finally {
    db.close();
  }
}

function main(): number {
  const version = latestFrozenVersion() ?? process.argv[2];
  if (!version) {
    console.error('Aucune version du critère gelée : indique la version à comparer et exporter (npm run refresh -- v0).');
    return 1;
  }
  const STEPS = [
    ...COLLECT_STEPS,
    { label: `compare -- ${version}`, args: ['run', 'compare', '--', version] },
    { label: `export -- ${version}`, args: ['run', 'export', '--', version] },
  ];
  for (const [i, step] of STEPS.entries()) {
    console.log(`Étape ${i + 1} sur ${STEPS.length} : ${step.label}`);
    const r = spawnSync('npm', step.args, { stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      console.error(`Arrêt : l'étape « ${step.label} » a échoué (code ${r.status ?? 'inconnu'}). Les étapes suivantes n'ont pas été lancées.`);
      return 1;
    }
  }
  console.log('Rafraîchissement terminé.');
  return 0;
}

process.exitCode = main();
