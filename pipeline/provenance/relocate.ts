import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from '../db/open.js';
import type { Provenance, UniversityFact } from '../../shared/types.js';
import { findCode, lineSupportsCourse, snapshotText } from './snapshotText.js';
import { contextProblem, findRawCopy, rawKind, verifyProvenance, type FactProblem, type MovedFact } from './verify.js';

type RawUniversity = { id: string; provenance?: Partial<Record<UniversityFact, Provenance>> } & Record<string, unknown>;

export interface RelocateResult {
  total: number;
  unchanged: number;
  moved: MovedFact[];
  problems: FactProblem[];
}

/**
 * Hors ligne : relit chaque source de fait contre sa copie brute locale. Un extrait retrouvé ailleurs voit
 * seulement son `locator` mis à jour ; un extrait introuvable ou une copie absente est signalé sans rien changer.
 * Le fichier n'est réécrit (atomiquement) que si une position a bougé.
 */
export async function relocateFactSources(universitiesPath: string, rawDir: string): Promise<RelocateResult> {
  const raw = JSON.parse(readFileSync(universitiesPath, 'utf8')) as RawUniversity[];
  const out: RelocateResult = { total: 0, unchanged: 0, moved: [], problems: [] };
  for (const u of raw) {
    for (const [fact, p] of Object.entries(u.provenance ?? {}) as [UniversityFact, Provenance][]) {
      out.total++;
      if (p.stale) out.problems.push({ universityId: u.id, fact, status: 'stale', provenance: p });
      const copy = findRawCopy(p.sha256, rawDir);
      const kind = copy ? rawKind(copy.contentType) : null;
      const invalid = contextProblem(fact, p, kind);
      if (invalid) out.problems.push({ universityId: u.id, fact, status: 'contexte_invalide', provenance: p, detail: invalid });
      const { status, found, contextFound, contextMisplaced } = await verifyProvenance(p, rawDir);
      if (contextMisplaced) {
        out.problems.push({ universityId: u.id, fact, status: 'contexte_invalide', provenance: p, detail: 'aucune occurrence du contexte à un endroit admis par rapport à l’extrait principal' });
      } else if (status === 'introuvable' || status === 'copie_absente') {
        out.problems.push({ universityId: u.id, fact, status, provenance: p });
      } else if (status === 'déplacé') {
        const same = (x: Provenance['locator'], y: Provenance['locator']): boolean => x.page === y.page && x.line === y.line;
        const next: Provenance = JSON.parse(JSON.stringify(p));
        const moves: MovedFact[] = [];
        if (found && !same(found, p.locator)) {
          moves.push({ universityId: u.id, fact, from: p.locator, to: found });
          next.locator = { page: found.page, line: found.line };
        }
        p.context?.forEach((c, i) => {
          const hit = contextFound?.[i];
          if (hit && next.context && !same(hit, c.locator)) {
            moves.push({ universityId: u.id, fact, from: c.locator, to: hit, context: true });
            next.context[i].locator = { page: hit.page, line: hit.line };
          }
        });
        // L'ordre est revérifié sur les positions recalées : rien n'est écrit si le contexte ne précède plus.
        const after = contextProblem(fact, next, kind);
        if (after) {
          out.problems.push({ universityId: u.id, fact, status: 'contexte_invalide', provenance: p, detail: after });
        } else if (moves.length === 0) {
          out.unchanged++;
        } else {
          out.moved.push(...moves);
          p.locator = next.locator;
          if (next.context) p.context = next.context;
        }
      } else {
        out.unchanged++;
      }
    }
  }
  if (out.moved.length > 0) {
    const tmp = join(dirname(universitiesPath), `.${process.pid}-universities.tmp`);
    writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`);
    renameSync(tmp, universitiesPath);
  }
  return out;
}

export interface RelocateCoursesResult {
  host: { changed: number; total: number };
  poly: { changed: number; total: number };
}

/**
 * Recalcule dans la base locale la position des cours (première position du code en mot entier) depuis les
 * copies brutes : pour un cours d'hôte, sa propre copie (par empreinte) ; si le code n'y est pas, une autre copie
 * de la même source qui porte des cours actifs, et la copie du cours change avec la ligne. Pour un cours de Poly,
 * la copie nommée par son repère. Copie absente : rien ne change.
 */
export async function relocateCourses(db: Db, rawDir: string): Promise<RelocateCoursesResult> {
  const textCache = new Map<string, string[][] | null>();
  const textOf = async (sha256: string): Promise<string[][] | null> => {
    if (!textCache.has(sha256)) {
      const copy = findRawCopy(sha256, rawDir);
      textCache.set(sha256, copy ? await snapshotText(readFileSync(copy.path), copy.contentType) : null);
    }
    return textCache.get(sha256) ?? null;
  };

  const result: RelocateCoursesResult = { host: { changed: 0, total: 0 }, poly: { changed: 0, total: 0 } };

  const hostRows = db
    .prepare(
      `SELECT h.id, h.code, h.description, h.snapshot_id, h.source_page, h.source_line, s.source_id, s.sha256
       FROM host_courses h JOIN snapshots s ON s.id = h.snapshot_id`,
    )
    .all() as {
    id: number;
    code: string;
    description: string;
    snapshot_id: number;
    source_page: number | null;
    source_line: number | null;
    source_id: string;
    sha256: string;
  }[];
  // Les autres copies de la source : celles qui portent des cours actifs, une par empreinte (jamais « une par
  // adresse » : plusieurs fichiers enregistrés peuvent partager une adresse).
  const otherCopies = db.prepare(
    `SELECT MAX(id) AS id, sha256 FROM snapshots
     WHERE source_id = ? AND id IN (SELECT snapshot_id FROM host_courses WHERE active = 1 AND snapshot_id IS NOT NULL)
     GROUP BY sha256 ORDER BY MIN(id)`,
  );
  const setHost = db.prepare('UPDATE host_courses SET snapshot_id = ?, source_page = ?, source_line = ? WHERE id = ?');
  for (const r of hostRows) {
    result.host.total++;
    const own = await textOf(r.sha256);
    // Copie du cours absente du magasin : rien ne change.
    if (!own) continue;
    let snapshotId = r.snapshot_id;
    const inOwn = findCode(own, r.code);
    // La ligne citée qui contient encore le code reste (le lecteur a pu citer une autre section que la première).
    let hit: { page: number; line: number } | null =
      inOwn.find((h) => h.page === r.source_page && h.line === r.source_line) ?? inOwn[0] ?? null;
    // Une ligne qui est un morceau de la description reste aussi (le lecteur a cité la description).
    if (r.source_page !== null && r.source_line !== null && lineSupportsCourse(own, { page: r.source_page, line: r.source_line }, r.code, r.description)) {
      hit = { page: r.source_page, line: r.source_line };
    }
    if (!hit) {
      // Code absent de sa copie : la copie et la ligne changent ensemble, vers une autre copie qui le contient.
      for (const other of otherCopies.all(r.source_id) as { id: number; sha256: string }[]) {
        if (other.sha256 === r.sha256) continue;
        const pages = await textOf(other.sha256);
        const found = pages ? findCode(pages, r.code)[0] : undefined;
        if (found) {
          hit = found;
          snapshotId = other.id;
          break;
        }
      }
    }
    const same = snapshotId === r.snapshot_id && (hit?.page ?? null) === r.source_page && (hit?.line ?? null) === r.source_line;
    if (same) continue;
    setHost.run(snapshotId, hit?.page ?? null, hit?.line ?? null, r.id);
    result.host.changed++;
  }

  const polyRows = db
    .prepare('SELECT sigle, source_locator_json FROM poly_courses WHERE source_locator_json IS NOT NULL')
    .all() as { sigle: string; source_locator_json: string }[];
  const setPoly = db.prepare('UPDATE poly_courses SET source_locator_json = ? WHERE sigle = ?');
  for (const r of polyRows) {
    result.poly.total++;
    const old = JSON.parse(r.source_locator_json) as { sha256: string; page: number; line: number };
    const pages = await textOf(old.sha256);
    if (!pages) continue;
    const hit = findCode(pages, r.sigle)[0];
    if (!hit || (hit.page === old.page && hit.line === old.line)) continue;
    setPoly.run(JSON.stringify({ sha256: old.sha256, page: hit.page, line: hit.line }), r.sigle);
    result.poly.changed++;
  }
  return result;
}
