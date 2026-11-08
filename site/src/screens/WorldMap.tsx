import { useMemo, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import worldTopology from 'world-atlas/countries-110m.json';
import type { CountryCode, University } from '../../../shared/types';
import './WorldMap.css';

export const COUNTRY_ISO_NUMERIC: Record<CountryCode, string> = { CN: '156', JP: '392', KR: '410', TW: '158' };
export const COUNTRY_NAMES_FR: Record<CountryCode, string> = { CN: 'Chine', JP: 'Japon', KR: 'Corée', TW: 'Taïwan' };

const COUNTRY_CODES = Object.keys(COUNTRY_ISO_NUMERIC) as CountryCode[];
const CODE_BY_ISO = new Map(COUNTRY_CODES.map((code) => [COUNTRY_ISO_NUMERIC[code], code]));

const WIDTH = 960;
const HEIGHT = 500;

/** Projection du monde entier ; la vue est recadrée sur l'Asie de l'Est, où se trouvent les pays couverts. */
const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], { type: 'Sphere' });
const toPath = geoPath(projection);

const VIEW_BOX = (() => {
  const corners = [
    [62, 58], [175, 58], [62, -12], [175, -12], [118, 58], [118, -12], [62, 23], [175, 23],
  ].map(([lng, lat]) => projection([lng!, lat!])!);
  const xs = corners.map((c) => c[0]!);
  const ys = corners.map((c) => c[1]!);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
})();

interface Shape {
  key: string;
  name: string;
  code: CountryCode | null;
  d: string;
}

const SHAPES: Shape[] = (() => {
  const topology = worldTopology as unknown as Topology;
  const countries = feature(topology, topology.objects.countries as GeometryCollection<{ name: string }>);
  const shapes: Shape[] = [];
  for (const country of countries.features) {
    const d = toPath(country);
    if (!d) continue;
    const iso = String(country.id ?? '');
    shapes.push({
      key: iso || country.properties.name,
      name: country.properties.name,
      code: CODE_BY_ISO.get(iso) ?? null,
      d,
    });
  }
  return shapes;
})();

function hasPlausibleCoordinates(u: University): boolean {
  return (
    Number.isFinite(u.lat) &&
    Number.isFinite(u.lng) &&
    Math.abs(u.lat) <= 90 &&
    Math.abs(u.lng) <= 180 &&
    !(u.lat === 0 && u.lng === 0)
  );
}

function countLabel(count: number): string {
  return `${count} ${count > 1 ? 'universités' : 'université'}`;
}

export function WorldMap({ universities, onSelect }: { universities: University[]; onSelect: (c: CountryCode) => void }) {
  const [active, setActive] = useState<CountryCode | null>(null);

  const counts = useMemo(() => {
    const result: Record<CountryCode, number> = { CN: 0, JP: 0, KR: 0, TW: 0 };
    for (const u of universities) if (u.countryCode in result) result[u.countryCode] += 1;
    return result;
  }, [universities]);

  const dots = useMemo(
    () =>
      universities.flatMap((u) => {
        if (!hasPlausibleCoordinates(u) || !(u.countryCode in COUNTRY_ISO_NUMERIC)) return [];
        const point = projection([u.lng, u.lat]);
        return point ? [{ id: u.id, name: u.name, country: u.countryCode, x: point[0], y: point[1] }] : [];
      }),
    [universities],
  );

  const caption = active ? `${COUNTRY_NAMES_FR[active]} · ${countLabel(counts[active])}` : 'Touche un pays coloré pour commencer';

  return (
    <section className="worldmap" aria-label="Carte du monde">
      <svg
        className="worldmap__svg"
        viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.w} ${VIEW_BOX.h}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <g aria-hidden="true">
          {SHAPES.filter((s) => !s.code).map((s) => (
            <path key={s.key} className="worldmap__land worldmap__land--soon" d={s.d} data-soon="">
              <title>{`${s.name} : bientôt`}</title>
            </path>
          ))}
          {SHAPES.filter((s) => s.code).map((s) => (
            <path
              key={s.key}
              className="worldmap__land worldmap__land--covered"
              d={s.d}
              data-country={s.code!}
              data-active={active === s.code ? 'true' : undefined}
              onClick={() => onSelect(s.code!)}
              onMouseEnter={() => setActive(s.code)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
          {dots.map((dot) => (
            <circle
              key={dot.id}
              className="worldmap__dot"
              cx={dot.x}
              cy={dot.y}
              r={3.2}
              data-university={dot.id}
              data-active={active === dot.country ? 'true' : undefined}
            >
              <title>{dot.name}</title>
            </circle>
          ))}
        </g>
      </svg>

      <p className="worldmap__caption" aria-live="polite">
        {caption}
      </p>

      <ul className="worldmap__buttons">
        {COUNTRY_CODES.map((code) => (
          <li key={code}>
            <button
              type="button"
              className="worldmap__button"
              aria-label={`${COUNTRY_NAMES_FR[code]}, ${countLabel(counts[code])}`}
              data-active={active === code ? 'true' : undefined}
              onClick={() => onSelect(code)}
              onFocus={() => setActive(code)}
              onBlur={() => setActive(null)}
              onMouseEnter={() => setActive(code)}
              onMouseLeave={() => setActive(null)}
            >
              <span className="worldmap__button-name">{COUNTRY_NAMES_FR[code]}</span>
              <span className="worldmap__button-count">{countLabel(counts[code])}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="small">Les autres pays arrivent bientôt.</p>
    </section>
  );
}
