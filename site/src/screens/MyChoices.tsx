import { useMemo, useState } from 'react';
import type { SiteData } from '../../../shared/siteData';
import type { PolyTerm } from '../../../shared/types';
import { ContractDraftView } from '../components/ContractDraft';
import { buildContractDraft, type ManualEntry } from '../logic/contract';
import { rankUniversities, type RankedUniversity } from '../logic/rank';
import './MyChoices.css';

export function MyChoices({
  data,
  ids,
  term,
  selectedSigles,
  onRemove,
  onBack,
}: {
  data: SiteData;
  ids: string[];
  term: PolyTerm;
  selectedSigles: string[];
  onRemove: (id: string) => void;
  onBack: () => void;
}) {
  const [manual, setManual] = useState<Record<string, ManualEntry[]>>({});

  const chosen = useMemo(() => {
    const out: RankedUniversity[] = [];
    for (const id of ids) {
      const university = data.universities.find((u) => u.id === id);
      if (!university) continue;
      const ranked = rankUniversities({ data, countryCode: university.countryCode, term, selectedSigles }).find(
        (r) => r.university.id === id,
      );
      if (ranked) out.push(ranked);
    }
    return out;
  }, [data, ids, term, selectedSigles]);

  if (chosen.length === 0) {
    return (
      <section className="choices stack" aria-labelledby="choices-title">
        <h1 id="choices-title" className="question">
          Mes choix
        </h1>
        <p className="lead">Tu n’as encore gardé aucune université.</p>
        <button type="button" className="btn" onClick={onBack}>
          Voir les résultats
        </button>
      </section>
    );
  }

  return (
    <section className="choices stack" aria-labelledby="choices-title">
      <h1 id="choices-title" className="question">
        Mes choix
      </h1>
      <p className="small">Jusqu’à 3 universités, gardées dans ce navigateur. Les cours sont ceux que tu as sélectionnés, pour le trimestre {term}.</p>
      {chosen.map((r) => {
        const entries = manual[r.university.id] ?? [];
        const draft = buildContractDraft({
          university: r.university,
          pairs: r.pairs,
          polyCourses: data.polyCourses,
          manual: entries,
          meta: data.meta,
        });
        const update = (next: ManualEntry[]) => setManual((prev) => ({ ...prev, [r.university.id]: next }));
        return (
          <article key={r.university.id} className="choices__uni card" aria-label={r.university.name}>
            <header className="choices__head">
              <div>
                <h2 className="choices__name">{r.university.name}</h2>
                <p className="small">{r.university.city}</p>
              </div>
              <button type="button" className="btn btn--ghost" onClick={() => onRemove(r.university.id)}>
                {`Retirer ${r.university.name}`}
              </button>
            </header>
            <ContractDraftView
              university={r.university}
              draft={draft}
              pairs={r.pairs}
              onAddManual={(entry) => update([...entries, entry])}
              onRemoveManual={(index) => update(entries.filter((_, i) => i !== index))}
            />
          </article>
        );
      })}
    </section>
  );
}
