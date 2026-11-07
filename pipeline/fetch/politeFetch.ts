import robotsModule from 'robots-parser';

export const USER_AGENT = 'polyechanges-collecteur/1.0 (projet etudiant non officiel)';

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt interdit l'accès à ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

export interface PoliteFetcher {
  get(url: string): Promise<{ body: Buffer; contentType: string; url: string }>;
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

class RetryableError extends Error {}

export function createPoliteFetcher(opts: PoliteFetcherOptions = {}): PoliteFetcher {
  const minDelayMs = opts.minDelayMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const retries = opts.retries ?? 2;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const lastRequestAt = new Map<string, number>();
  const robotsByOrigin = new Map<string, Promise<Robots | null>>();

  async function waitTurn(origin: string): Promise<void> {
    const last = lastRequestAt.get(origin);
    if (last !== undefined) {
      const wait = last + minDelayMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt.set(origin, now());
  }

  /** Une requête vers l'hôte, avec délai et nouvelles tentatives (5xx et erreur réseau seulement). */
  async function request(url: string): Promise<Response> {
    const origin = new URL(url).origin;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await waitTurn(origin);
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status >= 500) {
          await res.arrayBuffer();
          throw new RetryableError(`HTTP ${res.status} pour ${url}`);
        }
        return res;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  async function loadRobots(origin: string): Promise<Robots | null> {
    const robotsUrl = `${origin}/robots.txt`;
    const res = await request(robotsUrl);
    if (!res.ok) {
      await res.arrayBuffer();
      return null; // pas de robots.txt (404 et autres 4xx) : tout est permis
    }
    return robotsParser(robotsUrl, await res.text());
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

  return {
    async get(url) {
      const robots = await getRobots(new URL(url).origin);
      if (robots && robots.isAllowed(url, USER_AGENT) === false) throw new RobotsDisallowedError(url);
      const res = await request(url);
      if (!res.ok) {
        await res.arrayBuffer();
        throw new Error(`HTTP ${res.status} pour ${url}`);
      }
      return {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? '',
        url: res.url || url,
      };
    },
  };
}
