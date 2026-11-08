import { useEffect, useReducer, useState } from 'react';
import type { SiteData } from '../../shared/siteData';
import { Banner } from './components/Banner';
import { loadSiteData } from './data/loadSiteData';
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
      </main>
    </>
  );
}
