import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPoliteFetcher, RobotsDisallowedError } from './politeFetch.js';
import { startTestServer, type TestServer } from './testServer.js';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});

describe('createPoliteFetcher', () => {
  it('refuse une page interdite par robots.txt', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0 });
    await expect(fetcher.get(`${server.base}/prive/x`)).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(server.hits).not.toContain('/prive/x');
  });

  it("retourne le corps, le type de contenu et l'URL", async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0 });
    const r = await fetcher.get(`${server.base}/catalogue`);
    expect(r.body.toString()).toContain('catalogue');
    expect(r.contentType).toContain('text/html');
    expect(r.url).toBe(`${server.base}/catalogue`);
  });

  it('attend 3000 ms entre deux requêtes vers le même hôte', async () => {
    let t = 1_000_000;
    const sleeps: number[] = [];
    const fetcher = createPoliteFetcher({
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await fetcher.get(`${server.base}/catalogue`);
    await fetcher.get(`${server.base}/catalogue`);
    // robots.txt, page, page : 3 requêtes, donc 2 attentes
    expect(sleeps).toEqual([3000, 3000]);
  });

  it('envoie le User-Agent du projet', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0 });
    server.userAgents.length = 0;
    await fetcher.get(`${server.base}/catalogue`);
    expect(server.userAgents.length).toBeGreaterThan(0);
    for (const ua of server.userAgents) {
      expect(ua).toBe('polyechanges-collecteur/1.0 (projet etudiant non officiel)');
    }
  });

  it('réessaie sur 5xx puis réussit', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, retries: 2 });
    const r = await fetcher.get(`${server.base}/panne?k=a`);
    expect(r.body.toString()).toBe('revenu');
  });

  it('ne réessaie pas sur 404 et échoue', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, retries: 2 });
    server.hits.length = 0;
    await expect(fetcher.get(`${server.base}/introuvable`)).rejects.toThrow(/404/);
    expect(server.hits.filter((h) => h === '/introuvable')).toHaveLength(1);
  });
});

describe('createPoliteFetcher : concurrence, délai dépassé et nouvelles tentatives', () => {
  it('espace de 3000 ms au moins des appels concurrents vers le même hôte', async () => {
    const t = 1_000_000;
    const sleeps: number[] = [];
    const fetcher = createPoliteFetcher({
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await Promise.all([
      fetcher.get(`${server.base}/catalogue?c=1`),
      fetcher.get(`${server.base}/catalogue?c=2`),
      fetcher.get(`${server.base}/catalogue?c=3`),
    ]);
    // robots.txt à t, puis les trois pages aux créneaux t+3000, t+6000, t+9000
    expect([...sleeps].sort((a, b) => a - b)).toEqual([3000, 6000, 9000]);
  });

  it("échoue quand l'hôte ne répond pas avant le délai", async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, timeoutMs: 50, retries: 0 });
    await expect(fetcher.get(`${server.base}/suspendu`)).rejects.toThrow();
  });

  it('échoue aussi quand le corps reste en suspens, et réessaie', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, timeoutMs: 50, retries: 1 });
    server.hits.length = 0;
    await expect(fetcher.get(`${server.base}/corps-suspendu`)).rejects.toThrow();
    expect(server.hits.filter((h) => h === '/corps-suspendu')).toHaveLength(2);
  });

  it('réessaie après une erreur réseau puis réussit', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, retries: 2 });
    server.hits.length = 0;
    const r = await fetcher.get(`${server.base}/reseau?k=a`);
    expect(r.body.toString()).toBe('rétabli');
    expect(server.hits.filter((h) => h === '/reseau?k=a')).toHaveLength(2);
  });

  it('abandonne après 3 essais quand chaque réponse est un 5xx', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, retries: 2 });
    server.hits.length = 0;
    await expect(fetcher.get(`${server.base}/toujours503?k=a`)).rejects.toThrow(/503/);
    expect(server.hits.filter((h) => h === '/toujours503?k=a')).toHaveLength(3);
  });
});

describe('createPoliteFetcher : post', () => {
  it('envoie le formulaire encodé et retourne la réponse', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0 });
    const r = await fetcher.post(`${server.base}/echo`, { publisher_id: '10', keyword: 'a b&c' });
    expect(r.body.toString()).toBe('POST application/x-www-form-urlencoded publisher_id=10&keyword=a+b%26c');
    expect(r.contentType).toContain('text/plain');
    expect(r.url).toBe(`${server.base}/echo`);
  });

  it('refuse une adresse interdite par robots.txt sans envoyer la requête', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0 });
    server.hits.length = 0;
    await expect(fetcher.post(`${server.base}/prive/x`, { a: '1' })).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(server.hits).not.toContain('/prive/x');
  });

  it('envoie le User-Agent du projet et respecte le délai par hôte', async () => {
    let t = 1_000_000;
    const sleeps: number[] = [];
    const fetcher = createPoliteFetcher({
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    server.userAgents.length = 0;
    await fetcher.post(`${server.base}/echo`, { a: '1' });
    await fetcher.post(`${server.base}/echo`, { a: '2' });
    // robots.txt, post, post : 3 requêtes, donc 2 attentes
    expect(sleeps).toEqual([3000, 3000]);
    for (const ua of server.userAgents) {
      expect(ua).toBe('polyechanges-collecteur/1.0 (projet etudiant non officiel)');
    }
  });

  it('réessaie sur 5xx puis réussit, en renvoyant le même corps', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, retries: 2 });
    const r = await fetcher.post(`${server.base}/panne?k=post`, { a: '1' });
    expect(r.body.toString()).toBe('revenu');
  });

  it('ne réessaie pas sur 404 et échoue', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, retries: 2 });
    server.hits.length = 0;
    await expect(fetcher.post(`${server.base}/introuvable-post`, { a: '1' })).rejects.toThrow(/404/);
    expect(server.hits.filter((h) => h === '/introuvable-post')).toHaveLength(1);
  });

  it("échoue quand l'hôte ne répond pas avant le délai", async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, timeoutMs: 50, retries: 0 });
    await expect(fetcher.post(`${server.base}/suspendu`, { a: '1' })).rejects.toThrow();
  });
});
