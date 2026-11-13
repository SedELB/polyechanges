import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HostCourseOut, MatchOut, SiteMeta } from '../../shared/siteData.js';
import type { PolyCourse, University } from '../../shared/types.js';
import { loadCriterion } from '../criterion/loadCriterion.js';

// Lit l'export versionné (site/public/data), pas la base : le test passe aussi dans GitHub Actions.
const read = <T>(name: string): T => JSON.parse(readFileSync(`site/public/data/${name}.json`, 'utf8')) as T;

describe('données publiées', () => {
  const meta = read<SiteMeta>('meta');
  const poly = read<PolyCourse[]>('poly-courses');
  const hosts = read<HostCourseOut[]>('host-courses');
  const matches = read<MatchOut[]>('matches');
  const universities = read<University[]>('universities');

  it('au moins un cours de Poly comparé, doté d’une grille du critère publié, et au moins une paire', () => {
    const { notions } = loadCriterion(meta.criterionVersion);
    expect(poly.filter((c) => c.compared && (notions[c.sigle]?.length ?? 0) > 0).length).toBeGreaterThan(0);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('chaque catalogue public a des cours, sauf ceux annoncés « non lus cette année »', () => {
    const withCourses = new Set(hosts.map((h) => h.universityId));
    for (const u of universities.filter((x) => x.catalogPublic)) {
      expect(withCourses.has(u.id), u.id).toBe(!meta.unreadCatalogs.includes(u.id));
    }
  });
});
