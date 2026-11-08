import type { CountryCode, PolyTerm } from '../../shared/types';

export type Step = 'pays' | 'cours' | 'resultats' | 'choix';

export interface AppState {
  step: Step;
  countryCode: CountryCode | null;
  selectedSigles: string[];
  term: PolyTerm;
}

export type Action =
  | { type: 'goto'; step: Step }
  | { type: 'chooseCountry'; countryCode: CountryCode }
  | { type: 'toggleCourse'; sigle: string }
  | { type: 'setTerm'; term: PolyTerm };

export const initialState: AppState = { step: 'pays', countryCode: null, selectedSigles: [], term: 'automne' };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'goto':
      return { ...state, step: action.step };
    case 'chooseCountry':
      return { ...state, countryCode: action.countryCode, step: 'cours' };
    case 'toggleCourse':
      return {
        ...state,
        selectedSigles: state.selectedSigles.includes(action.sigle)
          ? state.selectedSigles.filter((s) => s !== action.sigle)
          : [...state.selectedSigles, action.sigle],
      };
    case 'setTerm':
      return { ...state, term: action.term };
  }
}
