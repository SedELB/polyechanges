import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestServer {
  base: string;
  userAgents: string[];
  hits: string[];
  close(): Promise<void>;
}

/** Petit serveur local pour les tests : robots.txt, /catalogue, /prive/x, /pdf, /panne. */
export async function startTestServer(): Promise<TestServer> {
  const userAgents: string[] = [];
  const hits: string[] = [];
  let pannes = 0;
  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/';
    hits.push(path);
    userAgents.push(String(req.headers['user-agent'] ?? ''));
    if (path === '/robots.txt') {
      res.setHeader('content-type', 'text/plain');
      res.end('User-agent: *\nDisallow: /prive\n');
    } else if (path === '/catalogue') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<html><body>catalogue</body></html>');
    } else if (path === '/prive/x') {
      res.setHeader('content-type', 'text/html');
      res.end('secret');
    } else if (path === '/pdf') {
      res.setHeader('content-type', 'application/pdf');
      res.end('%PDF-1.4 test');
    } else if (path === '/panne') {
      pannes += 1;
      if (pannes <= 2) {
        res.statusCode = 503;
        res.end('indisponible');
      } else {
        res.setHeader('content-type', 'text/html');
        res.end('revenu');
      }
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
