import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NO_EXCEL_HELP = [
  'Sans Excel (ou hors Windows) : ouvre le .xls dans LibreOffice Calc, puis « Fichier > Enregistrer sous… »,',
  'type « Texte Unicode (*.txt) » (UTF-16), même nom, extension .txt, séparateur tabulation, une rangée par ligne.',
].join('\n');

/** Convertit un `.xls` en `<même nom>.txt` (texte Unicode tabulé) avec Excel, sous Windows. Renvoie un code de sortie. */
export function main(args: string[]): number {
  const file = args[0];
  if (!file || args.length !== 1 || !/\.xls$/i.test(file)) {
    console.error('Usage : npm run saved:xls-to-txt -- <fichier.xls>\n' + NO_EXCEL_HELP);
    return 1;
  }
  if (!existsSync(file)) {
    console.error(`Fichier introuvable : ${file}`);
    return 1;
  }
  if (process.platform !== 'win32') {
    console.error('La conversion automatique demande Windows et Excel.\n' + NO_EXCEL_HELP);
    return 1;
  }
  const script = fileURLToPath(new URL('../../scripts/xls-to-txt.ps1', import.meta.url));
  const run = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', file], {
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    console.error(`Conversion impossible avec Excel : ${(run.stderr || run.error?.message || '').trim()}\n${NO_EXCEL_HELP}`);
    return 1;
  }
  console.log(run.stdout.trim());
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
