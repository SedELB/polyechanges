import { useEffect, useReducer, useState } from 'react';
import type { SiteData } from '../../shared/siteData';
import { Banner } from './components/Banner';
import { loadSiteData } from './data/loadSiteData';
import { CoursePicker } from './screens/CoursePicker';
import { Results } from './screens/Results';
import { WorldMap } from './screens/WorldMap';
import { initialState, reducer } from './state';

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: SiteData };

const defaultLoad = () => loadSiteData(import.meta.env.BASE_URL);

export function App({ load = defaultLoad }: { load?: () => Promise<SiteData> }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => !cancelled && setLoaded({ status: 'ready', data }),
      () => !cancelled && setLoaded({ status: 'error' }),
    );
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <>
      <Banner meta={loaded.status === 'ready' ? loaded.data.meta : null} />
      <main className="page stack">
        {loaded.status === 'loading' && (
          <p role="status" className="lead">
            Chargement…
          </p>
        )}
        {loaded.status === 'error' && (
          <p role="alert" className="notice">
            Impossible de charger les données. Recharge la page.
          </p>
        )}
        {loaded.status === 'ready' && state.step === 'pays' && (
          <>
            <h1 className="question">Où voulez-vous aller ?</h1>
            <WorldMap
              universities={loaded.data.universities}
              onSelect={(countryCode) => dispatch({ type: 'chooseCountry', countryCode })}
            />
          </>
        )}
        {loaded.status === 'ready' && state.step === 'cours' && (
          <>
            <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'goto', step: 'pays' })}>
              Retour
            </button>
            <CoursePicker
              courses={loaded.data.polyCourses}
              selected={state.selectedSigles}
              onChange={(sigles) => dispatch({ type: 'setCourses', sigles })}
              onNext={() => dispatch({ type: 'goto', step: 'resultats' })}
            />
          </>
        )}
        {loaded.status === 'ready' && state.step === 'resultats' && state.countryCode && (
          <>
            <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'goto', step: 'cours' })}>
              Retour
            </button>
            <Results
              data={loaded.data}
              countryCode={state.countryCode}
              term={state.term}
              selectedSigles={state.selectedSigles}
              onTermChange={(term) => dispatch({ type: 'setTerm', term })}
              onOtherCountry={() => dispatch({ type: 'goto', step: 'pays' })}
            />
          </>
        )}
      </main>
    </>
  );
}
