import { SITE_DATA_FILES, type SiteData } from '../../../shared/siteData';

const KEY_OF_FILE: Record<(typeof SITE_DATA_FILES)[number], keyof SiteData> = {
  meta: 'meta',
  universities: 'universities',
  'poly-courses': 'polyCourses',
  'host-courses': 'hostCourses',
  matches: 'matches',
  notions: 'notions',
};

/** Lit les fichiers JSON exportés sous `<baseUrl>data/`. */
export async function loadSiteData(baseUrl: string): Promise<SiteData> {
  const entries = await Promise.all(
    SITE_DATA_FILES.map(async (file) => {
      const url = `${baseUrl}data/${file}.json`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
      return [KEY_OF_FILE[file], await response.json()] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as SiteData;
}
