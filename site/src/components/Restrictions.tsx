import type { University } from '../../../shared/types';
import { FactSource } from './FactSource';

/** Restrictions publiées pour les étudiants d’échange, avec leur source ; rien quand le fait est vide. */
export function Restrictions({ university }: { university: University }) {
  const text = university.restrictions?.trim();
  if (!text) return null;
  return (
    <p className="restrictions small">
      <strong>Restrictions pour les étudiants d’échange</strong>
      {` : ${text} `}
      <FactSource label="restrictions" provenance={university.provenance.restrictions} />
    </p>
  );
}
