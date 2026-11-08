import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PoliteFetcher } from '../fetch/politeFetch.js';
import type { University } from '../../shared/types.js';
import {
  MOVEON_COUNTRY_IDS,
  diffPartners,
  fetchMoveOnPartners,
  parseMoveOnReport,
  type MoveOnPartner,
} from './moveOn.js';

const fixture = new URL('./fixtures/report-JP.html', import.meta.url);

function uni(moveOnName: string): University {
  return {
    id: moveOnName,
    name: moveOnName,
    moveOnName,
    countryCode: 'JP',
    city: '',
    lat: 0,
    lng: 0,
    website: '',
    catalogUrl: null,
    creditSystem: 'local',
    contactHoursPerCredit: null,
    terms: { fall: null, spring: null },
    restrictions: null,
    exchangeContact: null,
    catalogPublic: true,
    provenance: {},
  };
}

const livePartners: MoveOnPartner[] = parseMoveOnReport(readFileSync(fixture, 'utf8'), 'JP');

describe('parseMoveOnReport', () => {
  it('lit les 4 partenaires japonais avec leurs coordonnées', () => {
    const p = parseMoveOnReport(readFileSync(fixture, 'utf8'), 'JP');
    expect(p.map((x) => x.moveOnName)).toEqual([
      'Doshisha University',
      'Institute of Science Tokyo',
      'Nagoya University',
      'Tohoku University',
    ]);
    expect(p[2]).toMatchObject({ countryCode: 'JP', lat: 35.155904, lng: 136.915863 });
  });

  it('normalise les espaces insécables et retire le préfixe du pays', () => {
    const html = `<script>var jsonData = {"labelvalue":[{"latitude":"1.5","longitude":"2.5","flagname":"Cor\u00e9e - Korea\u00a0University-\u00a0 College  of Engineering"}]};</script>`;
    expect(parseMoveOnReport(html, 'KR')).toEqual([
      { countryCode: 'KR', moveOnName: 'Korea University- College of Engineering', lat: 1.5, lng: 2.5 },
    ]);
  });

  it('prend la première occurrence de jsonData et gère les accolades dans les chaînes', () => {
    const html = `<script>var jsonData = {"labelvalue":[{"latitude":"1","longitude":"2","flagname":"X - A } B"}]};</script><script>var jsonData = {"labelvalue":[]};</script>`;
    expect(parseMoveOnReport(html, 'TW').map((p) => p.moveOnName)).toEqual(['A } B']);
  });

  it('échoue clairement quand la page ne contient pas jsonData', () => {
    expect(() => parseMoveOnReport('<html></html>', 'JP')).toThrow(/jsonData/);
  });
});

describe('diffPartners', () => {
  it('signale un partenaire manquant et un inconnu', () => {
    const registrySansNagoya = livePartners.filter((p) => p.moveOnName !== 'Nagoya University').map((p) => uni(p.moveOnName));
    expect(diffPartners(registrySansNagoya, livePartners)).toEqual({ missing: [], unknown: ['Nagoya University'] });
    const registryEnPlus = [...livePartners.map((p) => uni(p.moveOnName)), uni('Kyoto University')];
    expect(diffPartners(registryEnPlus, livePartners)).toEqual({ missing: ['Kyoto University'], unknown: [] });
  });

  it('compare des noms normalisés', () => {
    const registry = [uni('Doshisha\u00a0 University')];
    const live: MoveOnPartner[] = [{ countryCode: 'JP', moveOnName: ' Doshisha University', lat: 0, lng: 0 }];
    expect(diffPartners(registry, live)).toEqual({ missing: [], unknown: [] });
  });
});

describe('fetchMoveOnPartners', () => {
  it('interroge chaque pays avec le bon identifiant', async () => {
    const calls: { url: string; form: Record<string, string> }[] = [];
    const html = readFileSync(fixture);
    const fetcher: PoliteFetcher = {
      get: async () => {
        throw new Error('inattendu');
      },
      post: async (url, form) => {
        calls.push({ url, form });
        return { body: html, contentType: 'text/html', url };
      },
    };
    const partners = await fetchMoveOnPartners(fetcher);
    expect(calls.map((c) => c.form.country_id)).toEqual(
      Object.values(MOVEON_COUNTRY_IDS).map(String),
    );
    expect(calls[0]).toEqual({
      url: 'https://polymtl.adv-pub.moveonca.com/report-page-3030/',
      form: { publisher_id: '10', country_id: '44', keyword: '' },
    });
    expect(partners).toHaveLength(16);
    expect(partners[0]?.countryCode).toBe('CN');
  });
});
