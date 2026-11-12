export type GuardResult = { ok: true; lossAccepted?: true } | { ok: false; reason: string };

/**
 * Garde-fous : au moins un cours, perte d'au plus 30 % par rapport à la fois précédente, au plus 30 % de descriptions
 * vides. `acceptLoss` (baisse voulue, `--accept-loss`) laisse passer la perte, et seulement elle : le résultat le dit.
 * `target` : l'id à nommer dans la commande proposée quand la perte bloque.
 */
export function checkGuards<T extends { description: string }>(
  found: T[],
  previousActiveCount: number,
  opts: { descriptionsPublished?: boolean; acceptLoss?: boolean; target?: string } = {},
): GuardResult {
  if (found.length === 0) return { ok: false, reason: 'Aucun cours lu' };
  // Comparaisons en entiers pour éviter les erreurs d'arrondi : found < 70 % de previous.
  const loss = found.length * 10 < previousActiveCount * 7;
  if (loss && !opts.acceptLoss) {
    return {
      ok: false,
      reason:
        `${found.length} cours lus contre ${previousActiveCount} à la collecte précédente (perte de plus de 30 %)` +
        ` ; si la baisse est voulue : npm run collect -- ${opts.target ?? '<id>'} --accept-loss "<raison>"`,
    };
  }
  const ok: GuardResult = loss ? { ok: true, lossAccepted: true } : { ok: true };
  // Une source qui ne publie aucune description (déclarée dans sa fiche) échappe à ce seul contrôle.
  if (opts.descriptionsPublished === false) return ok;
  const empty = found.filter((c) => c.description.trim() === '').length;
  if (empty * 10 > found.length * 3) {
    return { ok: false, reason: `${empty} descriptions vides sur ${found.length}` };
  }
  return ok;
}
