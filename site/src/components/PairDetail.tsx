import { hostContactHours } from '../../../shared/workload';
import type { SiteData } from '../../../shared/siteData';
import type { HostTerm, Level, PolyCourse, University, Workload } from '../../../shared/types';
import type { Candidate, PairResult } from '../logic/rank';
import { FactSource } from './FactSource';
import './PairDetail.css';

export const LEVEL_LABEL: Record<Level, string> = { elevee: 'élevée', moyenne: 'moyenne', faible: 'faible' };
const HOST_TERM_LABEL: Record<HostTerm, string> = { fall: 'automne', spring: 'printemps' };

const WORKLOAD_TEXT: Record<Workload, string> = {
  conforme: 'Charge conforme',
  trop_legere: 'Charge insuffisante : il faudra peut-être combiner avec un autre cours',
  trop_lourde: 'Charge plus lourde que celle de Poly',
  inconnue: 'Charge inconnue : crédits ou heures non publiés',
};

function WorkloadBlock({ candidate, poly, university, data }: { candidate: Candidate; poly: PolyCourse; university: University; data: SiteData }) {
  const { course, match } = candidate;
  const tolerance = Math.round(data.meta.workloadTolerance * 100);
  const [lecture, lab] = poly.triplet;
  let host: string;
  let rule: string;
  if (university.creditSystem === 'ECTS') {
    host = course.credits === null ? 'ECTS non publiés' : `${course.credits} ECTS`;
    rule = `Poly : ${poly.credits} crédits, comparés aux ECTS d’accueil`;
  } else {
    const hours = hostContactHours(course, university.contactHoursPerCredit);
    const derived = course.contactHours === null && course.credits !== null && hours !== null;
    host =
      hours === null
        ? 'heures de contact non publiées'
        : derived
          ? `${course.credits} crédits × ${university.contactHoursPerCredit} h = ${hours} h de contact`
          : `${hours} h de contact`;
    rule = `Poly : ${poly.credits} crédits (cours ${lecture} h, labo ${lab} h par semaine, ${data.meta.polyWeeks} semaines)`;
  }
  return (
    <div className="pair__block">
      <p className="pair__workload" data-workload={match.workload}>
        {WORKLOAD_TEXT[match.workload]}
      </p>
      <p className="small">
        Université d’accueil : {host}. {rule}. Tolérance {tolerance} %.
      </p>
      <p className="small">
        Système de crédits : {university.creditSystem}{' '}
        <FactSource label="système de crédits" provenance={university.provenance.creditSystem} />
        {university.creditSystem === 'local' && university.contactHoursPerCredit !== null && (
          <>
            {' '}
            · {university.contactHoursPerCredit} h de contact par crédit{' '}
            <FactSource label="heures par crédit" provenance={university.provenance.contactHoursPerCredit} />
          </>
        )}
      </p>
    </div>
  );
}

function NotionList({ title, ids, label }: { title: string; ids: string[]; label: (id: string) => string }) {
  return (
    <div>
      <strong>{title}</strong>
      {ids.length === 0 ? (
        <p className="small">aucune</p>
      ) : (
        <ul>
          {ids.map((id) => (
            <li key={id}>{label(id)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateDetail({ candidate, poly, university, data, heading }: { candidate: Candidate; poly: PolyCourse; university: University; data: SiteData; heading: string }) {
  const { course, match, termUnknown } = candidate;
  const notions = new Map((data.notions[poly.sigle] ?? []).map((n) => [n.id, n.fr]));
  const label = (id: string) => notions.get(id) ?? id;
  return (
    <section className="pair__candidate" aria-label={`${heading} ${course.code}`}>
      <h4 className="pair__cand-title">
        {heading} : {course.code}, {course.title}
      </h4>
      <p>
        <span className="pair__level" data-level={match.level}>
          Niveau : {LEVEL_LABEL[match.level]}
        </span>{' '}
        <span className="small">contenu couvert à {Math.round(match.contentScore * 100)} %</span>
      </p>
      <p className="pair__desc">{course.description}</p>
      <div className="pair__notions">
        <NotionList title="Notions trouvées" ids={match.notionsFound} label={label} />
        <NotionList title="Notions manquantes" ids={match.notionsMissing} label={label} />
      </div>
      {match.textUsed === 'description+plan' && <p className="small">Texte comparé : description et plan de cours.</p>}
      <WorkloadBlock candidate={candidate} poly={poly} university={university} data={data} />
      <p className="small">
        Langue : {course.language === 'en' ? 'anglais' : 'langue inconnue'}
        {' · '}
        {termUnknown || course.terms.length === 0
          ? 'trimestre non publié'
          : `Trimestre : ${course.terms.map((t) => HOST_TERM_LABEL[t]).join(', ')}`}
      </p>
      <p className="small">
        Source :{' '}
        <a href={course.sourceUrl} target="_blank" rel="noreferrer">
          {course.code}, page du cours
        </a>
        , collecté le {course.collectedAt}
        {course.sourceLine !== null && ` · ligne ${course.sourceLine} de la copie conservée`}
      </p>
    </section>
  );
}

/** Détail d'une paire : cours de Poly, meilleur candidat et au plus deux autres. */
export function PairDetail({ pair, poly, university, data }: { pair: PairResult; poly: PolyCourse; university: University; data: SiteData }) {
  return (
    <div className="pair">
      <div className="pair__block">
        <h4 className="pair__cand-title">
          {poly.sigle}, {poly.title}
        </h4>
        <p className="pair__desc">{poly.description}</p>
      </div>
      {pair.best ? (
        <CandidateDetail candidate={pair.best} poly={poly} university={university} data={data} heading="Meilleur candidat" />
      ) : (
        <p className="notice">Aucun candidat pour ce trimestre.</p>
      )}
      {pair.alternatives.map((c) => (
        <CandidateDetail key={c.course.id} candidate={c} poly={poly} university={university} data={data} heading="Autre candidat" />
      ))}
    </div>
  );
}
