import { afterEach, describe, expect, it, vi } from 'vitest';
import { SITE_DATA_FILES } from '../../../shared/siteData';
import { fixtureData } from '../test/fixtures';
import { expectNoForbiddenWords } from '../test/forbiddenWords';
import { loadSiteData } from './loadSiteData';

afterEach(() => vi.unstubAllGlobals());

describe('loadSiteData', () => {
  it('lit chaque fichier sous <base>data/ et assemble SiteData', async () => {
    const urls: string[] = [];
    const bodies: Record<string, unknown> = {
      meta: fixtureData.meta,
      universities: fixtureData.universities,
      'poly-courses': fixtureData.polyCourses,
      'host-courses': fixtureData.hostCourses,
      matches: fixtureData.matches,
      notions: fixtureData.notions,
    };
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const name = url.replace('/base/data/', '').replace('.json', '');
      return { ok: true, status: 200, json: async () => bodies[name] };
    });
    const data = await loadSiteData('/base/');
    expect(urls.sort()).toEqual(SITE_DATA_FILES.map((f) => `/base/data/${f}.json`).sort());
    expect(data).toEqual(fixtureData);
  });

  it('échoue si un fichier est introuvable', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await expect(loadSiteData('/')).rejects.toThrow(/404/);
  });
});

describe('expectNoForbiddenWords', () => {
  it('refuse les mots interdits', () => {
    const el = document.createElement('div');
    el.textContent = 'Cours Approuvé';
    expect(() => expectNoForbiddenWords(el)).toThrow();
    el.textContent = 'Niveau élevé';
    expect(() => expectNoForbiddenWords(el)).not.toThrow();
  });
});
