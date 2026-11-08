import type { SiteMeta } from '../../../shared/siteData';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 2026-11-10T18:26:41Z » devient « 10 novembre 2026 ». */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day || month > 12) return iso;
  return `${day === 1 ? '1er' : day} ${MONTHS[month - 1]} ${year}`;
}

export function Banner({ meta }: { meta: SiteMeta | null }) {
  return (
    <header className="banner">
      <span className="banner__tag">
        Projet étudiant non officiel{meta ? ` · critère ${meta.criterionVersion}` : ''}
      </span>
      {meta && <span className="banner__date">Données du {formatDate(meta.generatedAt)}</span>}
    </header>
  );
}
