import { test } from 'node:test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { crawl } from '../src/crawl.js';

const base = { follow: true, maxPages: 100, maxDepth: 10, concurrency: 3, userAgent: 'linkrot-test' };
const html = (body) => ({ body: `<html><body>${body}</body></html>` });

test('crawls linked pages and records references', async () => {
  const s = await startServer({
    '/': html('<a href="/b">b</a>'),
    '/b': html('<a href="/c">c</a>'),
    '/c': html('end'),
  });
  try {
    const r = await crawl({ ...base, startUrl: `${s.url}/` });
    assert.equal(r.pages.size, 3);
    assert.deepEqual(r.refs.get(`${s.url}/c`), [{ page: `${s.url}/b`, kind: 'a' }]);
    assert.equal(r.truncated, false);
  } finally {
    await s.close();
  }
});

test('records a missing internal page with its referrer', async () => {
  const s = await startServer({ '/': html('<a href="/gone">x</a>') });
  try {
    const r = await crawl({ ...base, startUrl: `${s.url}/` });
    assert.equal(r.pages.get(`${s.url}/gone`).status, 404);
    assert.deepEqual(r.refs.get(`${s.url}/gone`), [{ page: `${s.url}/`, kind: 'a' }]);
  } finally {
    await s.close();
  }
});

test('a start URL redirecting to another host makes that host the site', async () => {
  const target = await startServer({ '/': html('<a href="/next">n</a>'), '/next': html('hi') });
  const first = await startServer({ '/': { status: 301, headers: { location: `${target.url}/` }, body: '' } });
  try {
    const r = await crawl({ ...base, startUrl: `${first.url}/` });
    assert.equal(r.origin, target.url);
    assert.ok(r.pages.has(`${target.url}/next`));
    assert.equal(r.pages.get(`${target.url}/next`).status, 200);
  } finally {
    await first.close();
    await target.close();
  }
});

test('stops at maxPages on an endless URL space and reports truncation', async () => {
  // startServer matches on path only, so an endless query-string space needs its own server.
  const endless = createServer((req, res) => {
    const n = Number(new URL(req.url, 'http://x').searchParams.get('start') ?? 0);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<a href="/list?start=${n + 1}">next</a>`);
  });
  await new Promise((r) => endless.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${endless.address().port}`;
  try {
    const r = await crawl({ ...base, startUrl: `${url}/list?start=0`, maxPages: 20, maxDepth: 1000 });
    assert.equal(r.pages.size, 20);
    assert.equal(r.truncated, true);
  } finally {
    endless.closeAllConnections();
    await new Promise((r) => endless.close(r));
  }
});

test('follow false fetches only the start URL and the seeds', async () => {
  const s = await startServer({
    '/': html('<a href="/linked">l</a>'),
    '/one': html('1'),
    '/two': html('2'),
    '/linked': html('l'),
  });
  try {
    const r = await crawl({
      ...base,
      follow: false,
      startUrl: `${s.url}/`,
      seeds: [`${s.url}/one`, `${s.url}/two`],
    });
    assert.deepEqual([...r.pages.keys()].sort(), [`${s.url}/`, `${s.url}/one`, `${s.url}/two`]);
    assert.ok(!s.hits.includes('/linked'));
    assert.ok(r.refs.has(`${s.url}/linked`));
  } finally {
    await s.close();
  }
});

test('external links are referenced but never fetched', async () => {
  const ext = await startServer({ '/x': html('external') });
  const s = await startServer({ '/': html(`<a href="${ext.url}/x">x</a><img src="${ext.url}/i.png">`) });
  try {
    const r = await crawl({ ...base, startUrl: `${s.url}/` });
    assert.ok(r.refs.has(`${ext.url}/x`));
    assert.ok(r.refs.has(`${ext.url}/i.png`));
    assert.equal(ext.hits.length, 0);
    assert.equal(r.pages.size, 1);
  } finally {
    await s.close();
    await ext.close();
  }
});

test('a page linking the same URL twice yields one reference', async () => {
  const s = await startServer({ '/': html('<a href="/x">1</a><a href="/x">2</a>'), '/x': html('x') });
  try {
    const r = await crawl({ ...base, startUrl: `${s.url}/` });
    assert.deepEqual(r.refs.get(`${s.url}/x`), [{ page: `${s.url}/`, kind: 'a' }]);
  } finally {
    await s.close();
  }
});
