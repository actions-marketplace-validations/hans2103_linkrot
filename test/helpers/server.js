import { createServer } from 'node:http';

// routes: { '/path': { status?, type?, body, headers? } }; unknown paths give 404.
export async function startServer(routes) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    const path = req.url.split('?')[0];
    const route = routes[path] ?? routes[req.url];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(route.status ?? 200, {
      'content-type': route.type ?? 'text/html',
      ...route.headers,
    });
    res.end(route.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
