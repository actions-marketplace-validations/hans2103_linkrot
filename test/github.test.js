import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyGithub } from '../src/notify/github.js';
import { renderMarkdown } from '../src/report.js';
import { LinkrotError } from '../src/errors.js';

const finding = (url) => ({ url, code: 404, text: 'Not Found', pages: ['https://example.com/'] });
const summary = (urls, over = {}) => ({
  site: 'https://example.com',
  startedAt: '2026-11-13T08:00:00.000Z',
  durationMs: 1000,
  pageCount: 3,
  linkCount: 9,
  truncated: false,
  broken: urls.map(finding),
  doubt: [],
  ...over,
});
const report = (over = {}) => ({ channel: 'github', repo: 'owner/name', token: 'tok', label: 'linkrot', ...over });
const MARKER = '<!-- linkrot:https://example.com -->';

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** Fake fetch: `routes` maps "METHOD path" to a response, or to an array consumed one per call. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const key = `${method} ${u.pathname}`;
    calls.push({ method, path: u.pathname, query: u.searchParams, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    let r = routes[key];
    if (Array.isArray(r)) r = r.shift();
    if (!r) throw new Error(`unexpected request ${key}`);
    return typeof r === 'function' ? r(init) : r;
  };
  return { fetch, calls };
}

const issue = (over = {}) => ({ number: 7, html_url: 'https://github.com/owner/name/issues/7', body: `${MARKER}\nold`, ...over });

test('broken and no open issue: creates one with title, label and rendered body', async () => {
  const { fetch, calls } = fakeFetch({
    'GET /repos/owner/name/issues': json(200, []),
    'POST /repos/owner/name/issues': json(201, { number: 1, html_url: 'https://github.com/owner/name/issues/1' }),
  });
  const s = summary(['https://x.test/a']);
  const result = await notifyGithub(s, report(), { fetch });
  assert.deepEqual(result, { status: 'created', url: 'https://github.com/owner/name/issues/1' });
  const [list, post] = calls;
  assert.equal(list.query.get('state'), 'open');
  assert.equal(list.query.get('labels'), 'linkrot');
  assert.equal(list.query.get('per_page'), '100');
  assert.equal(list.headers.Authorization, 'Bearer tok');
  assert.equal(list.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.deepEqual(post.body, { title: 'Broken links on https://example.com', body: renderMarkdown(s), labels: ['linkrot'] });
  assert.ok(post.body.body.startsWith(MARKER));
});

test('missing label (422 on create): label is created with color b60205, then the issue is retried', async () => {
  const { fetch, calls } = fakeFetch({
    'GET /repos/owner/name/issues': json(200, []),
    'POST /repos/owner/name/issues': [json(422, { message: 'Validation Failed' }), json(201, { number: 2, html_url: 'https://github.com/owner/name/issues/2' })],
    'POST /repos/owner/name/labels': json(201, {}),
  });
  const result = await notifyGithub(summary(['https://x.test/a']), report({ label: 'dead-links' }), { fetch });
  assert.equal(result.status, 'created');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    'GET /repos/owner/name/issues',
    'POST /repos/owner/name/issues',
    'POST /repos/owner/name/labels',
    'POST /repos/owner/name/issues',
  ]);
  assert.deepEqual(calls[2].body, { name: 'dead-links', color: 'b60205' });
});

test('broken with open issue and changed body: PATCHes the body, never creates', async () => {
  const { fetch, calls } = fakeFetch({
    'GET /repos/owner/name/issues': json(200, [issue()]),
    'PATCH /repos/owner/name/issues/7': json(200, issue()),
  });
  const s = summary(['https://x.test/a']);
  const result = await notifyGithub(s, report(), { fetch });
  assert.deepEqual(result, { status: 'updated', url: 'https://github.com/owner/name/issues/7' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { body: renderMarkdown(s) });
});

test('broken with open issue and identical body: noop, no write', async () => {
  const s = summary(['https://x.test/a']);
  const { fetch, calls } = fakeFetch({
    'GET /repos/owner/name/issues': json(200, [issue({ body: renderMarkdown(s) })]),
  });
  const result = await notifyGithub(s, report(), { fetch });
  assert.deepEqual(result, { status: 'noop', url: 'https://github.com/owner/name/issues/7' });
  assert.equal(calls.length, 1);
});

test('nothing broken with open issue: comments "All links OK again" and closes', async () => {
  const { fetch, calls } = fakeFetch({
    'GET /repos/owner/name/issues': json(200, [issue()]),
    'POST /repos/owner/name/issues/7/comments': json(201, {}),
    'PATCH /repos/owner/name/issues/7': json(200, issue()),
  });
  const result = await notifyGithub(summary([]), report(), { fetch });
  assert.deepEqual(result, { status: 'closed', url: 'https://github.com/owner/name/issues/7' });
  assert.deepEqual(calls[1].body, { body: 'All links OK again (2026-11-13).' });
  assert.deepEqual(calls[2].body, { state: 'closed', state_reason: 'completed' });
});

test('nothing broken and no open issue: noop', async () => {
  const { fetch, calls } = fakeFetch({ 'GET /repos/owner/name/issues': json(200, []) });
  assert.deepEqual(await notifyGithub(summary([]), report(), { fetch }), { status: 'noop', url: undefined });
  assert.equal(calls.length, 1);
});

test('never a second issue: picks own marker, ignores other sites and pull requests', async () => {
  const other = issue({ number: 3, html_url: 'u3', body: '<!-- linkrot:https://other.test -->\nx' });
  const pr = issue({ number: 4, html_url: 'u4', pull_request: {} });
  const mine = issue({ number: 9, html_url: 'u9' });
  const { fetch, calls } = fakeFetch({
    'GET /repos/owner/name/issues': json(200, [other, pr, mine]),
    'PATCH /repos/owner/name/issues/9': json(200, mine),
  });
  const result = await notifyGithub(summary(['https://x.test/a']), report(), { fetch });
  assert.deepEqual(result, { status: 'updated', url: 'u9' });
  assert.ok(!calls.some((c) => c.method === 'POST'));
});

test('a pull request carrying the marker does not count as the issue', async () => {
  const pr = issue({ pull_request: {} });
  const { fetch } = fakeFetch({
    'GET /repos/owner/name/issues': json(200, [pr]),
    'POST /repos/owner/name/issues': json(201, { html_url: 'new' }),
  });
  assert.equal((await notifyGithub(summary(['https://x.test/a']), report(), { fetch })).status, 'created');
});

test('long Markdown is cut at the last complete line below 65000 characters with a note', async () => {
  const urls = Array.from({ length: 4000 }, (_, i) => `https://x.test/broken-link-number-${i}`);
  const s = summary(urls);
  assert.ok(renderMarkdown(s).length > 65536);
  const { fetch, calls } = fakeFetch({
    'GET /repos/owner/name/issues': json(200, []),
    'POST /repos/owner/name/issues': json(201, { html_url: 'new' }),
  });
  await notifyGithub(s, report(), { fetch });
  const text = calls[1].body.body;
  const note = '\n\n… report truncated; run linkrot locally for the full list.';
  assert.ok(text.endsWith(note));
  assert.ok(text.length <= 65536);
  const kept = text.slice(0, -note.length);
  assert.ok(kept.length < 65000);
  assert.ok(text.startsWith(MARKER));
  assert.ok(renderMarkdown(s).startsWith(`${kept}\n`), 'kept part ends on a line boundary');
});

test('custom apiUrl is used', async () => {
  const { fetch, calls } = fakeFetch({ 'GET /api/v3/repos/owner/name/issues': json(200, []) });
  const url = new URL('https://ghe.example.org/api/v3');
  await notifyGithub(summary([]), report(), { fetch, apiUrl: url.href });
  assert.equal(calls[0].path, '/api/v3/repos/owner/name/issues');
});

test('non-2xx response: LinkrotError with status and message', async () => {
  const { fetch } = fakeFetch({ 'GET /repos/owner/name/issues': json(401, { message: 'Bad credentials' }) });
  await assert.rejects(
    notifyGithub(summary([]), report(), { fetch }),
    (err) => err instanceof LinkrotError && /401/.test(err.message) && /Bad credentials/.test(err.message),
  );
});
