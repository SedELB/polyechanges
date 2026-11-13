import type { PolyTerm, TermDates, University, UniversityFact } from '../../../shared/types';
import { TERM_MAP } from '../logic/rank';
import { outdatedYears } from '../logic/termDates';
import { formatDay } from '../logic/format';
import { FactSource } from './FactSource';
import './TermToggle.css';

const TERMS: PolyTerm[] = ['automne', 'hiver'];

function UniversityDates({ university, term, year }: { university: University; term: PolyTerm; year: number }) {
  const host = TERM_MAP[term];
  const dates: TermDates | null = university.terms[host];
  const rows: { key: 'start' | 'end' | 'examsEnd'; label: string; source: string }[] = [
    { key: 'start', label: 'début', source: 'début du trimestre' },
    { key: 'end', label: 'fin', source: 'fin du trimestre' },
    { key: 'examsEnd', label: 'fin des examens', source: 'fin des examens' },
  ];
  const outdated = dates ? outdatedYears(dates, term, year) : null;
  return (
    <li>
      <div role="group" aria-label={`Dates de ${university.name}`} className="termdates__uni">
        <strong>{university.name}</strong>
        {!dates && <span className="small">dates non publiées</span>}
        {dates &&
          rows.map((row) => (
            <span key={row.key} className="termdates__row">
              {row.label} : {dates[row.key] === null ? 'non publiée' : formatDay(dates[row.key] as string)}{' '}
              <FactSource
                label={row.source}
                provenance={dates[row.key] === null ? undefined : university.provenance[`terms.${host}.${row.key}` as UniversityFact]}
              />
            </span>
          ))}
        {outdated && <span className="small termdates__warn">{`dates de l’année ${outdated}, à confirmer`}</span>}
      </div>
    </li>
  );
}

/** Choix du trimestre de départ, avec les dates du trimestre d'accueil de chaque université. */
export function TermToggle({
  term,
  onChange,
  universities,
  departureYear,
}: {
  term: PolyTerm;
  onChange: (term: PolyTerm) => void;
  universities: University[];
  departureYear: number;
}) {
  return (
    <section className="termtoggle card" aria-label="Trimestre de départ">
      <div role="group" aria-label="Départ" className="cluster">
        <span className="termtoggle__label">Départ :</span>
        {TERMS.map((t) => (
          <button key={t} type="button" className="choice termtoggle__btn" aria-pressed={term === t} onClick={() => onChange(t)}>
            {t}
          </button>
        ))}
      </div>
      <p className="small">Dates du trimestre d’accueil</p>
      <ul className="termdates__list">
          {universities.map((u) => (
            <UniversityDates key={u.id} university={u} term={term} year={departureYear} />
          ))}
      </ul>
    </section>
  );
}
