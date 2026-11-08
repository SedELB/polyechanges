import { useMemo, useState } from 'react';
import type { PolyCourse } from '../../../shared/types';
import './CoursePicker.css';

const MIN_FULL_TIME_CREDITS = 12;
const OTHER_SECTION = 'Autres cours';
const NOT_COMPARED_NOTE = "Pas de recherche d'équivalent : à ajouter à la main dans l'ébauche de contrat.";

/** Les orientations numérotées sont repliées, sauf « Technologies de l’information pour ingénieurs ». */
export function isOpenByDefault(section: string): boolean {
  if (!/^\s*\d+\s*\./.test(section)) return true;
  return /technologies de l.information pour ing[ée]nieurs/i.test(section);
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function isActive(course: PolyCourse): boolean {
  return (course as { active?: boolean }).active !== false;
}

interface Section {
  title: string;
  courses: PolyCourse[];
}

function buildSections(courses: PolyCourse[]): Section[] {
  const sections = new Map<string, PolyCourse[]>();
  for (const course of courses) {
    const title = course.groups[0] ?? OTHER_SECTION;
    const list = sections.get(title);
    if (list) list.push(course);
    else sections.set(title, [course]);
  }
  return [...sections].map(([title, list]) => ({ title, courses: list }));
}

function CourseRow({ course, checked, onToggle }: { course: PolyCourse; checked: boolean; onToggle: () => void }) {
  const id = `cours-${course.sigle}`;
  const noteId = `${id}-note`;
  const others = course.groups.slice(1);
  const note = !course.eligible ? course.ineligibleReason : !course.compared ? NOT_COMPARED_NOTE : null;
  return (
    <li className="picker__row" data-checked={checked ? 'true' : undefined} data-disabled={!course.eligible ? 'true' : undefined}>
      <input
        id={id}
        type="checkbox"
        className="picker__box"
        checked={checked}
        disabled={!course.eligible}
        aria-describedby={note ? noteId : undefined}
        onChange={onToggle}
      />
      <label htmlFor={id} className="picker__label">
        <span className="picker__head">
          <strong className="picker__sigle">{course.sigle}</strong>
          <span className="badge">
            {course.credits} {course.credits > 1 ? 'crédits' : 'crédit'}
          </span>
        </span>
        <span className="picker__title">{course.title}</span>
      </label>
      {note && (
        <p id={noteId} className="picker__note small">
          {note}
        </p>
      )}
      {others.length > 0 && <p className="picker__note small">Aussi dans : {others.join(' ; ')}</p>}
    </li>
  );
}

export function CoursePicker({
  courses,
  selected,
  onChange,
  onNext,
}: {
  courses: PolyCourse[];
  selected: string[];
  onChange: (sigles: string[]) => void;
  onNext: () => void;
}) {
  const [query, setQuery] = useState('');

  const sections = useMemo(() => buildSections(courses.filter(isActive)), [courses]);
  const needle = normalize(query.trim());
  const visible = useMemo(
    () =>
      sections
        .map((s) => ({
          ...s,
          courses: needle ? s.courses.filter((c) => normalize(`${c.sigle} ${c.title}`).includes(needle)) : s.courses,
        }))
        .filter((s) => s.courses.length > 0),
    [sections, needle],
  );

  const credits = courses.filter((c) => selected.includes(c.sigle)).reduce((sum, c) => sum + c.credits, 0);

  const toggle = (sigle: string) =>
    onChange(selected.includes(sigle) ? selected.filter((s) => s !== sigle) : [...selected, sigle]);

  return (
    <section className="picker" aria-labelledby="picker-title">
      <h1 id="picker-title" className="question">
        Quels cours veux-tu faire là-bas ?
      </h1>

      <div className="picker__bar card">
        <p className="picker__total" aria-live="polite">
          {credits} crédits Poly
        </p>
        {credits < MIN_FULL_TIME_CREDITS && (
          <p className="small">Il te faut au moins 12 crédits pour être à temps plein.</p>
        )}
        <button type="button" className="btn" disabled={selected.length === 0} onClick={onNext}>
          Voir les universités
        </button>
      </div>

      <input
        type="search"
        className="picker__search"
        aria-label="Chercher un cours"
        placeholder="Sigle ou mot du titre"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {visible.length === 0 && <p className="notice">Aucun cours ne correspond.</p>}

      {visible.map((section) => (
        <details key={section.title} className="picker__section card" open={needle ? true : isOpenByDefault(section.title)}>
          <summary className="picker__summary">
            <span className="picker__section-title">{section.title}</span>
            <span className="badge">{section.courses.length} cours</span>
          </summary>
          <ul className="picker__list">
            {section.courses.map((course) => (
              <CourseRow key={course.sigle} course={course} checked={selected.includes(course.sigle)} onToggle={() => toggle(course.sigle)} />
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
