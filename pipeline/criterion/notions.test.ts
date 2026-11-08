import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PolyCourse } from '../../shared/types.js';
import { CRITERION_DIR, loadCriterion } from './loadCriterion.js';

/** Les sous-dossiers de data/criterion/ qui contiennent un criterion.json. */
function criterionVersionsOnDisk(): string[] {
  return readdirSync(CRITERION_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`${CRITERION_DIR}/${d.name}/criterion.json`))
    .map((d) => d.name);
}

describe('grilles de notions', () => {
  // lit les cours exportés (versionnés), pas la base locale : le test doit passer aussi dans GitHub Actions
  it.each(criterionVersionsOnDisk())(
    'critère %s : chaque cours comparé a une grille de 5 à 10 notions bilingues aux id uniques',
    (version) => {
      const { notions } = loadCriterion(version);
      const polyCourses: PolyCourse[] = JSON.parse(readFileSync('site/public/data/poly-courses.json', 'utf8'));
      for (const c of polyCourses.filter((c) => c.compared)) {
        const g = notions[c.sigle];
        expect(g, c.sigle).toBeDefined();
        expect(g.length).toBeGreaterThanOrEqual(5);
        expect(g.length).toBeLessThanOrEqual(10);
        expect(new Set(g.map((n) => n.id)).size).toBe(g.length);
        for (const n of g) {
          expect(n.fr.trim()).not.toBe('');
          expect(n.en.trim()).not.toBe('');
        }
      }
    },
  );
});
