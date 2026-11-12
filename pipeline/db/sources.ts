import type { Db } from './open.js';

/** Enregistre ou met à jour la ligne `sources` d'une fiche de source (université nulle pour Poly). */
export function upsertSource(
  db: Db,
  s: { id: string; universityId: string | null; kind: string; url: string; reader: string },
): void {
  db.prepare(
    `INSERT INTO sources (id, university_id, kind, url, reader) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET university_id = excluded.university_id, kind = excluded.kind,
       url = excluded.url, reader = excluded.reader`,
  ).run(s.id, s.universityId, s.kind, s.url, s.reader);
}
