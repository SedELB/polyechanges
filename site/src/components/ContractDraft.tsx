import { useRef, useState, type FormEvent } from 'react';
import type { University, Workload } from '../../../shared/types';
import type { ContractDraft as Draft, ManualEntry } from '../logic/contract';
import { CYCLE_LABEL, formatCredits, formatDay, formatGap, formatHigh, formatLow, formatNumber } from '../logic/format';
import type { PairResult } from '../logic/rank';
import './ContractDraft.css';
import '../print.css';

const WORKLOAD_TEXT: Record<Workload, string> = {
  conforme: 'Charge totale conforme',
  trop_legere: 'Charge totale insuffisante : il faudra peut-être ajouter un cours',
  trop_lourde: 'Charge totale plus lourde que celle de Poly',
  inconnue: 'Charge totale inconnue : crédits ou heures non publiés',
};

export const CONTRACT_REMINDER =
  'Ébauche à recopier dans le formulaire officiel de contrat d’études ; seule la personne coordonnatrice des échanges du département décide.';

/** Mention portée par l’ébauche imprimée ou copiée, qui peut circuler sans le reste du site. */
export const draftNotice = (criterionVersion: string): string =>
  `Projet étudiant non officiel · critère ${criterionVersion} · niveaux non vérifiés par un humain`;

const HEADER = ['Cours d’accueil', 'Titre d’accueil', 'Crédits d’accueil', 'Cycle d’accueil', 'Cours Poly', 'Titre Poly', 'Crédits Poly'];

/** Copie via l’API du presse-papiers, sinon via un champ temporaire. Lève une erreur si les deux échouent. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // on essaie la méthode de secours
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    if (!document.execCommand('copy')) throw new Error('copie refusée');
  } finally {
    document.body.removeChild(area);
  }
}

/** Tableau en texte tabulé, collable dans un tableur, précédé de la mention non officielle. */
export function draftToText(draft: Draft, criterionVersion: string): string {
  const lines = draft.rows.map((r) =>
    [
      r.hostCode,
      r.hostTitle,
      r.hostCredits === null ? '' : formatNumber(r.hostCredits),
      r.hostLevel === null ? '' : CYCLE_LABEL[r.hostLevel],
      r.polyCode,
      r.polyTitle,
      String(r.polyCredits),
    ].join('\t'),
  );
  return [draftNotice(criterionVersion), HEADER.join('\t'), ...lines].join('\n');
}

function ManualForm({ onAdd }: { onAdd: (entry: ManualEntry) => void }) {
  const [kind, setKind] = useState<ManualEntry['kind']>('orientation');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [hostCredits, setHostCredits] = useState('');
  const [polyCredits, setPolyCredits] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const poly = Number(polyCredits);
    const host = hostCredits.trim() === '' ? null : Number(hostCredits.replace(',', '.'));
    if (code.trim() === '' || title.trim() === '') return setError('Indique le code et le titre du cours d’accueil.');
    if (!Number.isInteger(poly) || poly < 1 || poly > 9) return setError('Les crédits Poly doivent être un nombre entier de 1 à 9.');
    if (host !== null && !Number.isFinite(host)) return setError('Les crédits d’accueil doivent être un nombre.');
    onAdd({ kind, hostCode: code.trim(), hostTitle: title.trim(), hostCredits: host, polyCredits: poly });
    setCode('');
    setTitle('');
    setHostCredits('');
    setPolyCredits('');
    setError(null);
  };

  return (
    <details className="contract__manual">
      <summary>Ajouter un cours à la main</summary>
      <form className="contract__form" onSubmit={submit}>
        <label>
          Type de cours
          <select value={kind} onChange={(e) => setKind(e.target.value as ManualEntry['kind'])}>
            <option value="orientation">Cours d’orientation personnalisée (ING500x)</option>
            <option value="hors_genie">Cours hors génie (SSH500x)</option>
          </select>
        </label>
        <label>
          Code du cours d’accueil
          <input value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label>
          Titre du cours d’accueil
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Crédits d’accueil (facultatif)
          <input inputMode="decimal" value={hostCredits} onChange={(e) => setHostCredits(e.target.value)} />
        </label>
        <label>
          Crédits Poly
          <input inputMode="numeric" value={polyCredits} onChange={(e) => setPolyCredits(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        <button type="submit" className="btn">
          Ajouter ce cours
        </button>
      </form>
    </details>
  );
}

/** Ébauche de contrat d’une université : tableau, vérification de charge du total, avertissements, copie et impression. */
export function ContractDraftView({
  university,
  criterionVersion,
  draft,
  pairs,
  onAddManual,
  onRemoveManual,
}: {
  university: University;
  criterionVersion: string;
  draft: Draft;
  pairs: PairResult[];
  onAddManual: (entry: ManualEntry) => void;
  onRemoveManual: (index: number) => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const bySigle = new Map(pairs.map((p) => [p.polySigle, p.best?.course]));
  const e = draft.explanation;
  const unit = e.kind === 'ECTS' ? 'ECTS' : 'h';
  const tableName = `Ébauche de contrat, ${university.name}`;

  const copy = async () => {
    try {
      await copyText(draftToText(draft, criterionVersion));
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };

  const print = () => {
    const el = printRef.current;
    el?.classList.add('is-printing');
    try {
      window.print();
    } finally {
      el?.classList.remove('is-printing');
    }
  };

  return (
    <div className="contract stack">
      <div ref={printRef} className="contract-print stack">
        <p className="small contract__notice">{draftNotice(criterionVersion)}</p>
        <h3 className="contract__title">{university.name}</h3>
        <div className="contract__scroll">
          <table className="contract__table" aria-label={tableName}>
            <thead>
              <tr>
                <th scope="col">Cours d’accueil</th>
                <th scope="col">Crédits d’accueil</th>
                <th scope="col">Cours Poly</th>
                <th scope="col">Crédits Poly</th>
                <th scope="col" className="contract__noprint">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((r, i) => {
                const manualIndex = r.manual ? draft.rows.slice(0, i).filter((x) => x.manual).length : -1;
                const course = r.manual ? undefined : bySigle.get(r.polyCode);
                return (
                  <tr key={r.manual ? `manuel-${manualIndex}-${r.hostCode}` : `${r.polyCode}-${r.hostCode}`}>
                    <td>
                      {course ? (
                        <a href={course.sourceUrl} target="_blank" rel="noreferrer">
                          {r.hostCode}
                        </a>
                      ) : (
                        <span>{r.hostCode}</span>
                      )}{' '}
                      {r.hostTitle}
                      {r.hostLevel !== null && (
                        <>
                          {' · '}
                          <span className="cycle" data-cycle={r.hostLevel}>
                            {CYCLE_LABEL[r.hostLevel]}
                          </span>
                        </>
                      )}
                      {course && <span className="small contract__source"> collecté le {formatDay(course.collectedAt)}</span>}
                      {r.manual && <span className="small contract__source"> ajouté à la main</span>}
                    </td>
                    <td>{r.hostCredits === null ? 'non publié' : formatNumber(r.hostCredits)}</td>
                    <td>
                      <span>{r.polyCode}</span> {r.polyTitle}
                    </td>
                    <td>{r.polyCredits}</td>
                    <td className="contract__noprint">
                      {r.manual && (
                        <button type="button" className="btn btn--ghost contract__remove" onClick={() => onRemoveManual(manualIndex)}>
                          <span aria-hidden="true">×</span>
                          <span className="visually-hidden">Retirer {r.hostCode}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {draft.rows.length === 0 && (
                <tr>
                  <td colSpan={5}>Aucun cours apparié pour cette université.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Total
                </th>
                <td>{formatCredits(draft.totalPolyCredits, ' Poly')}</td>
                <td className="contract__noprint" />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="small">{CONTRACT_REMINDER}</p>
      </div>

      <div className="contract__check">
        <p className="contract__workload" data-workload={draft.workloadTotal}>
          {WORKLOAD_TEXT[draft.workloadTotal]}
        </p>
        <ul className="small contract__calc">
          <li>
            Attendu : {formatNumber(e.expected)} {unit}
            {e.kind === 'heures' ? ' de contact' : ''} pour les cours appariés
          </li>
          <li>{e.actual === null ? 'Ici : non publié' : `Ici : ${formatNumber(e.actual)} ${unit}`}</li>
          <li>
            Accepté : entre {formatLow(e.low)} {unit} et {formatHigh(e.high)} {unit}
          </li>
          {e.gap !== null && <li>Écart : {formatGap(e.gap)}</li>}
        </ul>
      </div>

      {draft.warnings.length > 0 && (
        <ul className="contract__warnings">
          {draft.warnings.map((w) => (
            <li key={w} className="notice">
              {w}
            </li>
          ))}
        </ul>
      )}

      <div className="cluster">
        <button type="button" className="btn" onClick={copy}>
          Copier le tableau
        </button>
        <button type="button" className="btn btn--ghost" onClick={print}>
          Imprimer
        </button>
      </div>
      {copied && (
        <p role="status" className="small">
          {copied === 'ok' ? 'Tableau copié.' : 'Copie impossible : sélectionne le tableau à la main.'}
        </p>
      )}

      <ManualForm onAdd={onAddManual} />
    </div>
  );
}
