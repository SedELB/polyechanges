import { useState } from 'react';
import type { SiteData } from '../../../shared/siteData';
import type { PolyCourse } from '../../../shared/types';
import type { RankedUniversity } from '../logic/rank';
import { FactSource } from './FactSource';
import { LEVEL_LABEL, PairDetail } from './PairDetail';
import './UniversityCard.css';

export function UniversityCard({ ranked, data }: { ranked: RankedUniversity; data: SiteData }) {
  const { university, covered, total, pairs, status } = ranked;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const titleId = `uni-${university.id}`;
  const polyBySigle = new Map<string, PolyCourse>(data.polyCourses.map((c) => [c.sigle, c]));

  const toggle = (sigle: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(sigle)) next.add(sigle);
      return next;
    });

  return (
    <article className="ucard card" aria-labelledby={titleId}>
      <header className="ucard__head">
        <h2 id={titleId} className="ucard__name">
          {university.name}
        </h2>
        <p className="small">{university.city}</p>
        {status === 'ok' ? (
          <p className="badge">{`${covered} cours sur ${total} ${covered > 1 ? 'couverts' : 'couvert'}`}</p>
        ) : (
          <p className="badge">Catalogue non public</p>
        )}
      </header>

      {status === 'catalogue_non_public' ? (
        <div className="ucard__body">
          <p className="small">
            Le catalogue des cours n’est pas public{' '}
            <FactSource label="catalogue public" provenance={university.provenance.catalogPublic} />
          </p>
          <p>
            {university.exchangeContact ? `Contact des échanges : ${university.exchangeContact}` : 'Contact des échanges non publié'}{' '}
            <FactSource label="contact des échanges" provenance={university.provenance.exchangeContact} />
          </p>
        </div>
      ) : (
        <ul className="ucard__pairs">
          {pairs.map((pair) => {
            const poly = polyBySigle.get(pair.polySigle)!;
            const isOpen = open.has(pair.polySigle);
            const panelId = `${titleId}-${pair.polySigle}`;
            return (
              <li key={pair.polySigle} className="ucard__pair" data-covered={pair.best ? 'true' : 'false'}>
                <button type="button" className="ucard__toggle" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(pair.polySigle)}>
                  <span>
                    <strong>{poly.sigle}</strong> {poly.title}
                  </span>
                  <span className="ucard__summary small">
                    {pair.best
                      ? `${pair.best.course.code} · niveau ${LEVEL_LABEL[pair.best.match.level]}${pair.best.termUnknown ? ' · trimestre non publié' : ''}`
                      : 'Aucun équivalent trouvé'}
                  </span>
                </button>
                <div id={panelId} hidden={!isOpen}>
                  {isOpen && <PairDetail pair={pair} poly={poly} university={university} data={data} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
