import { useEffect, useReducer, useState } from 'react';
import type { SiteData } from '../../shared/siteData';
import { Banner } from './components/Banner';
import { loadSiteData } from './data/loadSiteData';
import { addChoice, loadChoices, saveChoices } from './logic/choices';
import { CoursePicker } from './screens/CoursePicker';
import { MyChoices } from './screens/MyChoices';
import { Results } from './screens/Results';
import { WorldMap } from './screens/WorldMap';
import { initialState, reducer } from './state';

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: SiteData };

const defaultLoad = () => loadSiteData(import.meta.env.BASE_URL);

export function App({ load = defaultLoad, today = new Date() }: { load?: () => Promise<SiteData>; today?: Date }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [state, dispatch] = useReducer(reducer, initialState);
  const [storedChoices, setStoredChoices] = useState<string[]>(() => loadChoices());
  const [choiceError, setChoiceError] = useState<string | null>(null);

  // Les identifiants qui n'existent plus dans les données sont ignorés.
  const choices = loaded.status === 'ready' ? storedChoices.filter((id) => loaded.data.universities.some((u) => u.id === id)) : [];

  const updateChoices = (ids: string[]) => {
    setStoredChoices(ids);
    saveChoices(ids);
  };
  const toggleChoice = (id: string) => {
    if (choices.includes(id)) {
      setChoiceError(null);
      return updateChoices(choices.filter((c) => c !== id));
    }
    const result = addChoice(choices, id);
    setChoiceError(result.error === 'max' ? '3 universités au maximum, comme la demande officielle' : null);
    if (result.error === null) updateChoices(result.ids);
  };

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
              today={today}
              onTermChange={(term) => dispatch({ type: 'setTerm', term })}
              onOtherCountry={() => dispatch({ type: 'goto', step: 'pays' })}
              choices={choices}
              choiceError={choiceError}
              onToggleChoice={toggleChoice}
              onOpenChoices={() => dispatch({ type: 'goto', step: 'choix' })}
            />
          </>
        )}
        {loaded.status === 'ready' && state.step === 'choix' && (
          <>
            <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'goto', step: 'resultats' })}>
              Retour
            </button>
            <MyChoices
              data={loaded.data}
              ids={choices}
              term={state.term}
              selectedSigles={state.selectedSigles}
              onRemove={toggleChoice}
              onBack={() => dispatch({ type: 'goto', step: 'resultats' })}
            />
          </>
        )}
      </main>
    </>
  );
}
