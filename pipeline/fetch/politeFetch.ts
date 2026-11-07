import robotsModule from 'robots-parser';

export const USER_AGENT = 'polyechanges-collecteur/1.0 (projet etudiant non officiel)';

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt interdit l'accès à ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

export interface FetchResult {
  body: Buffer;
  contentType: string;
  url: string;
}

export interface PoliteFetcher {
  get(url: string): Promise<FetchResult>;
  /** Envoie un formulaire (application/x-www-form-urlencoded) avec les mêmes règles que `get`. */
  post(url: string, form: Record<string, string>): Promise<FetchResult>;
}

export interface PoliteFetcherOptions {
  minDelayMs?: number;
  timeoutMs?: number;
  retries?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
}

// Les types du paquet (CommonJS) ne décrivent pas l'import par défaut sous NodeNext.
const robotsParser = robotsModule as unknown as (url: string, robotsTxt: string) => Robots;

export function createPoliteFetcher(opts: PoliteFetcherOptions = {}): PoliteFetcher {
  const minDelayMs = opts.minDelayMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const retries = opts.retries ?? 2;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const lastRequestAt = new Map<string, number>();
  const robotsByOrigin = new Map<string, Promise<Robots | null>>();

  async function waitTurn(origin: string): Promise<void> {
    // Le créneau est réservé de façon synchrone : deux appels concurrents ne partagent jamais le même.
    const last = lastRequestAt.get(origin);
    const t = now();
    const slot = last === undefined ? t : Math.max(t, last + minDelayMs);
    lastRequestAt.set(origin, slot);
    if (slot > t) await sleep(slot - t);
  }

  interface Fetched {
    status: number;
    ok: boolean;
    contentType: string;
    url: string;
    body: Buffer;
  }

  /** Une requête vers l'hôte, lecture du corps comprise, avec délai et nouvelles tentatives (5xx, erreur réseau, délai dépassé). */
  async function request(url: string, form?: Record<string, string>): Promise<Fetched> {
    const origin = new URL(url).origin;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await waitTurn(origin);
      try {
        const res = await fetch(url, {
          method: form ? 'POST' : 'GET',
          headers: form
            ? { 'user-agent': USER_AGENT, 'content-type': 'application/x-www-form-urlencoded' }
            : { 'user-agent': USER_AGENT },
          body: form ? new URLSearchParams(form).toString() : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = Buffer.from(await res.arrayBuffer());
        if (res.status >= 500) throw new Error(`HTTP ${res.status} pour ${url}`);
        return {
          status: res.status,
          ok: res.ok,
          contentType: res.headers.get('content-type') ?? '',
          url: res.url || url,
          body,
        };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  async function loadRobots(origin: string): Promise<Robots | null> {
    const robotsUrl = `${origin}/robots.txt`;
    const res = await request(robotsUrl);
    if (!res.ok) return null; // pas de robots.txt (404 et autres 4xx) : tout est permis
    return robotsParser(robotsUrl, res.body.toString('utf8'));
  }

  function getRobots(origin: string): Promise<Robots | null> {
    let cached = robotsByOrigin.get(origin);
    if (!cached) {
      cached = loadRobots(origin);
      robotsByOrigin.set(origin, cached);
      cached.catch(() => robotsByOrigin.delete(origin));
    }
    return cached;
  }

  async function polite(url: string, form?: Record<string, string>): Promise<FetchResult> {
    const robots = await getRobots(new URL(url).origin);
    if (robots && robots.isAllowed(url, USER_AGENT) === false) throw new RobotsDisallowedError(url);
    const res = await request(url, form);
    if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
    return { body: res.body, contentType: res.contentType, url: res.url };
  }

  return {
    get: (url) => polite(url),
    post: (url, form) => polite(url, form),
  };
}
