export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Garde-fous : au moins un cours, perte d'au plus 30 % par rapport à la fois précédente, au plus 30 % de descriptions vides. */
export function checkGuards<T extends { description: string }>(
  found: T[],
  previousActiveCount: number,
  opts: { descriptionsPublished?: boolean } = {},
): GuardResult {
  if (found.length === 0) return { ok: false, reason: 'Aucun cours lu' };
  // Comparaisons en entiers pour éviter les erreurs d'arrondi : found < 70 % de previous.
  if (found.length * 10 < previousActiveCount * 7) {
    return {
      ok: false,
      reason: `${found.length} cours lus contre ${previousActiveCount} à la collecte précédente (perte de plus de 30 %)`,
    };
  }
  // Une source qui ne publie aucune description (déclarée dans sa fiche) échappe à ce seul contrôle.
  if (opts.descriptionsPublished === false) return { ok: true };
  const empty = found.filter((c) => c.description.trim() === '').length;
  if (empty * 10 > found.length * 3) {
    return { ok: false, reason: `${empty} descriptions vides sur ${found.length}` };
  }
  return { ok: true };
}
