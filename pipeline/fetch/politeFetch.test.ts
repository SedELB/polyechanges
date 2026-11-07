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
    const r = await fetcher.get(`${server.base}/panne`);
    expect(r.body.toString()).toBe('revenu');
  });

  it('ne réessaie pas sur 404 et échoue', async () => {
    const fetcher = createPoliteFetcher({ minDelayMs: 0, retries: 2 });
    server.hits.length = 0;
    await expect(fetcher.get(`${server.base}/introuvable`)).rejects.toThrow(/404/);
    expect(server.hits.filter((h) => h === '/introuvable')).toHaveLength(1);
  });
});
