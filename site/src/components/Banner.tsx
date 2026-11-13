import type { SiteMeta } from '../../../shared/siteData';
import { formatDay } from '../logic/format';

export function Banner({ meta }: { meta: SiteMeta | null }) {
  return (
    <header className="banner">
      <span className="banner__tag">
        Projet étudiant non officiel{meta ? ` · critère ${meta.criterionVersion}` : ''}
      </span>
      {meta && <span className="banner__date">Données du {formatDay(meta.generatedAt)}</span>}
    </header>
  );
}
