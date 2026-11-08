import { spawnSync } from 'node:child_process';

/** Étapes du rafraîchissement, dans l'ordre. La comparaison et l'export s'y ajouteront. */
const STEPS: { label: string; args: string[] }[] = [
  { label: 'partners:check', args: ['run', 'partners:check'] },
  { label: 'collect -- all', args: ['run', 'collect', '--', 'all'] },
  { label: 'refresh-sources', args: ['run', 'refresh-sources'] },
];

function main(): number {
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
