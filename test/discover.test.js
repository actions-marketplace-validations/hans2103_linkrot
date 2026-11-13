import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { discoverSitemapPages, sameSite, rewriteToOrigin } from '../src/discover.js';
import { startServer } from './helpers/server.js';

const userAgent = 'linkrot-test';
const urlset = (...locs) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((l) => `<url><loc>${l}</loc></url>`)
    .join('')}</urlset>`;
const index = (...locs) =>
  `<sitemapindex>${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`;
const xml = (body) => ({ type: 'application/xml', body });

async function withServer(makeRoutes, fn) {
  let server;
  const routes = {};
  server = await startServer(routes);
  Object.assign(routes, makeRoutes(server.url));
  try {
    await fn(server.url);
  } finally {
    await server.close();
  }
}

test('reads Sitemap: lines from robots.txt', async () => {
  await withServer(
    (u) => ({
      '/robots.txt': { type: 'text/plain', body: `User-agent: *\nSitemap: ${u}/map.xml\n` },
      '/map.xml': xml(urlset(`${u}/a`, `${u}/b`, `${u}/a`)),
    }),
    async (u) => {
      assert.deepEqual(await discoverSitemapPages(u, { userAgent }), [`${u}/a`, `${u}/b`]);
    },
  );
});

test('falls back to /sitemap.xml without robots.txt', async () => {
  await withServer(
    (u) => ({ '/sitemap.xml': xml(urlset(`${u}/x`)) }),
    async (u) => {
      assert.deepEqual(await discoverSitemapPages(u, { userAgent }), [`${u}/x`]);
    },
  );
});

test('follows a sitemap index to the union of its children', async () => {
  await withServer(
    (u) => ({
      '/sitemap.xml': xml(index(`${u}/s1.xml`, `${u}/s2.xml`)),
      '/s1.xml': xml(urlset(`${u}/a`, `${u}/b`)),
      '/s2.xml': xml(urlset(`${u}/b`, `${u}/c`)),
    }),
    async (u) => {
      assert.deepEqual(await discoverSitemapPages(u, { userAgent }), [`${u}/a`, `${u}/b`, `${u}/c`]);
    },
  );
});

test('supports gzipped sitemaps', async () => {
  await withServer(
    (u) => ({
      '/sitemap.xml': xml(index(`${u}/s.xml.gz`)),
      '/s.xml.gz': { type: 'application/gzip', body: gzipSync(urlset(`${u}/g`)) },
    }),
    async (u) => {
      assert.deepEqual(await discoverSitemapPages(u, { userAgent }), [`${u}/g`]);
    },
  );
});

test('stops following nested indexes at depth 3', async () => {
  await withServer(
    (u) => ({
      '/sitemap.xml': xml(index(`${u}/l1.xml`)),
      '/l1.xml': xml(index(`${u}/l2.xml`)),
      '/l2.xml': xml(index(`${u}/l3.xml`)),
      '/l3.xml': xml(urlset(`${u}/deep`)),
    }),
    async (u) => {
      assert.deepEqual(await discoverSitemapPages(u, { userAgent }), []);
    },
  );
});

test('returns [] when there is no sitemap at all', async () => {
  await withServer(
    () => ({}),
    async (u) => {
      assert.deepEqual(await discoverSitemapPages(u, { userAgent }), []);
    },
  );
});

test('rewrites www/scheme variants to the origin, drops other hosts', async () => {
  const fetched = [];
  const fakeFetch = async (url) => {
    fetched.push(String(url));
    if (String(url) === 'https://example.org/robots.txt') return new Response('', { status: 404 });
    if (String(url) === 'https://example.org/sitemap.xml') {
      return new Response(
        urlset(
          'http://www.example.org/a',
          'http://example.org/b?x=1',
          'https://example.org/c',
          'https://other.org/d',
        ),
      );
    }
    return new Response('', { status: 404 });
  };
  const pages = await discoverSitemapPages('https://example.org', { fetch: fakeFetch, userAgent });
  assert.deepEqual(pages, [
    'https://example.org/a',
    'https://example.org/b?x=1',
    'https://example.org/c',
  ]);
});

test('sameSite ignores www and scheme but not other hosts or ports', () => {
  assert.equal(sameSite('http://www.example.org/a', 'https://example.org'), true);
  assert.equal(sameSite('https://example.org/a', 'https://www.example.org/'), true);
  assert.equal(sameSite('https://EXAMPLE.org/a', 'https://example.org/'), true);
  assert.equal(sameSite('https://blog.example.org/', 'https://example.org/'), false);
  assert.equal(sameSite('https://example.org:8080/', 'https://example.org/'), false);
  assert.equal(sameSite('not a url', 'https://example.org/'), false);
});

test('rewriteToOrigin swaps scheme and host only', () => {
  assert.equal(
    rewriteToOrigin('http://www.example.org/a/b?q=1#h', 'https://example.org'),
    'https://example.org/a/b?q=1#h',
  );
  assert.equal(rewriteToOrigin('https://other.org/a', 'https://example.org'), null);
});

test('every discovery fetch carries a timeout signal', async () => {
  const signals = [];
  const fakeFetch = async (url, options = {}) => {
    signals.push(options.signal);
    return new Response('', { status: 404 });
  };
  await discoverSitemapPages('https://example.org', { fetch: fakeFetch, userAgent });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((s) => s instanceof AbortSignal), 'missing signal');
});
