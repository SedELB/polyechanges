import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServer {
  base: string;
  userAgents: string[];
  hits: string[];
  close(): Promise<void>;
}

/** Petit serveur local pour les tests : robots.txt, /catalogue, /prive/x, /pdf, /panne et des routes de panne. */
export async function startTestServer(): Promise<TestServer> {
  const userAgents: string[] = [];
  const hits: string[] = [];
  const appels = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/';
    hits.push(path);
    const n = (appels.get(path) ?? 0) + 1;
    appels.set(path, n);
    const route = path.split('?')[0];
    userAgents.push(String(req.headers['user-agent'] ?? ''));
    if (path === '/robots.txt') {
      res.setHeader('content-type', 'text/plain');
      res.end('User-agent: *\nDisallow: /prive\n');
    } else if (route === '/catalogue') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<html><body>catalogue</body></html>');
    } else if (path === '/prive/x') {
      res.setHeader('content-type', 'text/html');
      res.end('secret');
    } else if (path === '/pdf') {
      res.setHeader('content-type', 'application/pdf');
      res.end('%PDF-1.4 test');
    } else if (route === '/panne') {
      // 503 aux deux premiers appels de cette URL exacte, puis succès
      if (n <= 2) {
        res.statusCode = 503;
        res.end('indisponible');
      } else {
        res.setHeader('content-type', 'text/html');
        res.end('revenu');
      }
    } else if (route === '/toujours503') {
      res.statusCode = 503;
      res.end('indisponible');
    } else if (route === '/reseau') {
      // coupe la connexion au premier appel de cette URL exacte, puis succès
      if (n === 1) {
        req.socket.destroy();
      } else {
        res.setHeader('content-type', 'text/html');
        res.end('rétabli');
      }
    } else if (route === '/suspendu') {
      // ne répond jamais
    } else if (route === '/corps-suspendu') {
      // envoie les en-têtes puis laisse le corps en suspens
      res.setHeader('content-type', 'text/html');
      res.setHeader('content-length', '100');
      res.write('debut');
    } else {
      res.statusCode = 404;
      res.end('absent');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    userAgents,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
