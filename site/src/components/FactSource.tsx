import type { Provenance } from '../../../shared/types';
import { formatDay } from '../logic/format';
import './FactSource.css';

/** Source d'un fait : lien, date de consultation et extrait exact, dans un panneau natif accessible au clavier. */
export function FactSource({ label, provenance }: { label: string; provenance: Provenance | undefined }) {
  if (!provenance) {
    return (
      <span className="fact-source fact-source--missing" role="group" aria-label={`Source : ${label}`}>
        source non disponible
      </span>
    );
  }
  return (
    <span className="fact-source" role="group" aria-label={`Source : ${label}`}>
      <details>
        <summary>source</summary>
        <span className="fact-source__panel">
          <a href={provenance.url} target="_blank" rel="noreferrer">
            {provenance.url}
          </a>
          <span>consulté le {formatDay(provenance.retrievedAt)}</span>
          <span className="fact-source__quote">{`« ${provenance.quote} »`}</span>
          {provenance.context?.map((c, i) => (
            <span key={i} className="fact-source__quote">{`Contexte : « ${c.quote} » (ligne ${c.locator.line})`}</span>
          ))}
          {provenance.stale && <span>extrait introuvable lors du dernier rafraîchissement</span>}
        </span>
      </details>
    </span>
  );
}
