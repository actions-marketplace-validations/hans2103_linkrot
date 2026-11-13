import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify.js';
import { BUILTIN_EXCLUDES, DOUBT_HOSTS, NEVER_REPORT_KINDS } from '../src/defaults.js';

const O = 'https://site.test';

function crawlOf({ pages = {}, refs = {} } = {}) {
  return {
    origin: O,
    pages: new Map(Object.entries(pages).map(([u, status]) => [u, { status }])),
    refs: new Map(Object.entries(refs)),
    truncated: false,
  };
}
const res = (code, extra = {}) => ({ ok: false, code, text: `HTTP ${code}`, timeout: false, ...extra });
const ref = (page, kind = 'a') => ({ page, kind });

test('defaults expose the global constants', () => {
  assert.deepEqual(NEVER_REPORT_KINDS, ['canonical', 'alternate', 'og']);
  assert.ok(DOUBT_HOSTS.includes('linkedin.com'));
  assert.equal(DOUBT_HOSTS.length, 5);
  assert.equal(BUILTIN_EXCLUDES.length, 1);
  assert.ok(new RegExp(BUILTIN_EXCLUDES[0]).test('https://outlook.live.com/calendar/x'));
});

test('404 is broken', () => {
  const u = 'https://other.test/x';
  const r = classify(crawlOf({ refs: { [u]: [ref(`${O}/a`)] } }), new Map([[u, res(404)]]));
  assert.deepEqual(r.broken, [{ url: u, code: 404, text: 'HTTP 404', pages: [`${O}/a`] }]);
  assert.deepEqual(r.doubt, []);
  assert.equal(r.linkCount, 1);
});

test('429 from any host is doubt', () => {
  const u = 'https://other.test/x';
  const r = classify(crawlOf({ refs: { [u]: [ref(`${O}/a`)] } }), new Map([[u, res(429)]]));
  assert.equal(r.broken.length, 0);
  assert.equal(r.doubt.length, 1);
});

test('403 from linkedin (and subdomains) is doubt, from example.com broken', () => {
  const a = 'https://www.linkedin.com/in/x';
  const b = 'https://example.com/x';
  const c = 'https://notlinkedin.com/x';
  const r = classify(
    crawlOf({ refs: { [a]: [ref(`${O}/a`)], [b]: [ref(`${O}/a`)], [c]: [ref(`${O}/a`)] } }),
    new Map([[a, res(403)], [b, res(403)], [c, res(999)]]),
  );
  assert.deepEqual(r.doubt.map((f) => f.url), [a]);
  assert.deepEqual(r.broken.map((f) => f.url).sort(), [b, c].sort());
});

test('timeout is doubt', () => {
  const u = 'https://slow.test/';
  const r = classify(
    crawlOf({ refs: { [u]: [ref(`${O}/a`)] } }),
    new Map([[u, { ok: false, code: null, text: 'Timeout', timeout: true }]]),
  );
  assert.equal(r.doubt.length, 1);
  assert.equal(r.broken.length, 0);
});

test('ok results are not findings', () => {
  const u = 'https://fine.test/';
  const r = classify(crawlOf({ refs: { [u]: [ref(`${O}/a`)] } }), new Map([[u, { ok: true, code: 200, text: 'OK', timeout: false }]]));
  assert.deepEqual(r.broken, []);
  assert.equal(r.linkCount, 1);
});

test('only canonical refs: not reported and not counted', () => {
  const u = 'https://other.test/c';
  const r = classify(crawlOf({ refs: { [u]: [ref(`${O}/a`, 'canonical')] } }), new Map([[u, res(404)]]));
  assert.deepEqual(r.broken, []);
  assert.equal(r.linkCount, 0);
});

test('a on 3 pages plus canonical on 1: broken with 3 pages, sorted', () => {
  const u = 'https://other.test/c';
  const refs = [ref(`${O}/c`), ref(`${O}/a`), ref(`${O}/b`), ref(`${O}/d`, 'canonical'), ref(`${O}/a`, 'img')];
  const r = classify(crawlOf({ refs: { [u]: refs } }), new Map([[u, res(404)]]));
  assert.deepEqual(r.broken[0].pages, [`${O}/a`, `${O}/b`, `${O}/c`]);
});

test('internal 404 page from crawl is broken; crawl wins over checks', () => {
  const u = `${O}/gone`;
  const r = classify(
    crawlOf({ pages: { [u]: 404 }, refs: { [u]: [ref(`${O}/a`)] } }),
    new Map([[u, { ok: true, code: 200, text: 'OK', timeout: false }]]),
  );
  assert.deepEqual(r.broken, [{ url: u, code: 404, text: 'HTTP 404', pages: [`${O}/a`] }]);
});

test('failed start page without referrers is a finding with empty pages; string statuses', () => {
  const r = classify(
    crawlOf({ pages: { [`${O}/`]: 'ECONNREFUSED', [`${O}/slow`]: 'timeout', [`${O}/ok`]: 200 } }),
    new Map(),
  );
  assert.deepEqual(r.broken, [{ url: `${O}/`, code: null, text: 'ECONNREFUSED', pages: [] }]);
  assert.equal(r.doubt.length, 1);
  assert.equal(r.doubt[0].url, `${O}/slow`);
});

test('unchecked refs are not findings; sorted by page count desc then url', () => {
  const x = 'https://x.test/', y = 'https://y.test/', z = 'https://z.test/', n = 'https://none.test/';
  const r = classify(
    crawlOf({ refs: { [x]: [ref(`${O}/1`)], [y]: [ref(`${O}/1`), ref(`${O}/2`)], [z]: [ref(`${O}/1`)], [n]: [ref(`${O}/1`)] } }),
    new Map([[x, res(404)], [y, res(404)], [z, res(404)]]),
  );
  assert.deepEqual(r.broken.map((f) => f.url), [y, x, z]);
  assert.equal(r.linkCount, 4);
});

test('exclude drops matching findings from pages and checks, and from the link count', () => {
  const page404 = `${O}/gone`;
  const ext = 'https://other.test/gone/x';
  const kept = 'https://other.test/kept';
  const crawl = crawlOf({
    pages: { [page404]: 404 },
    refs: { [page404]: [ref(`${O}/a`)], [ext]: [ref(`${O}/a`)], [kept]: [ref(`${O}/a`)] },
  });
  const checks = new Map([[ext, res(404)], [kept, res(404)]]);
  const r = classify(crawl, checks, { exclude: [/\/gone/] });
  assert.deepEqual(r.broken.map((f) => f.url), [kept]);
  assert.equal(r.linkCount, 1);
});
