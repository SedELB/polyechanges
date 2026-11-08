import { useMemo } from 'react';
import type { SiteData } from '../../../shared/siteData';
import type { CountryCode, PolyTerm } from '../../../shared/types';
import { TermToggle } from '../components/TermToggle';
import { UniversityCard } from '../components/UniversityCard';
import { rankUniversities } from '../logic/rank';
import { departureYear as defaultDepartureYear } from '../logic/termDates';
import './Results.css';

export function Results({
  data,
  countryCode,
  term,
  selectedSigles,
  departureYear,
  onTermChange,
  onOtherCountry,
}: {
  data: SiteData;
  countryCode: CountryCode;
  term: PolyTerm;
  selectedSigles: string[];
  departureYear?: number;
  onTermChange: (term: PolyTerm) => void;
  onOtherCountry: () => void;
}) {
  const ranked = useMemo(
    () => rankUniversities({ data, countryCode, term, selectedSigles }),
    [data, countryCode, term, selectedSigles],
  );
  const year = departureYear ?? defaultDepartureYear(term);
  const nothingCovered = ranked.every((r) => r.covered === 0);

  return (
    <section className="results stack" aria-labelledby="results-title">
      <h1 id="results-title" className="question">
        Où ces cours existent-ils ?
      </h1>
      <p className="notice results__note">Niveaux calculés automatiquement, non vérifiés par un humain</p>
      <TermToggle term={term} onChange={onTermChange} universities={ranked.map((r) => r.university)} departureYear={year} />
      {nothingCovered && (
        <div className="notice results__empty">
          <p>Aucun équivalent trouvé dans ce pays pour les cours choisis.</p>
          <button type="button" className="btn" onClick={onOtherCountry}>
            Choisir un autre pays
          </button>
        </div>
      )}
      <div className="results__list">
        {ranked.map((r) => (
          <UniversityCard key={r.university.id} ranked={r} data={data} />
        ))}
      </div>
    </section>
  );
}
