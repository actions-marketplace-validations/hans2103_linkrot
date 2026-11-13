import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTerminal, renderMarkdown, renderJson } from '../src/report.js';

const pages5 = [1, 2, 3, 4, 5].map((n) => `https://example.com/p${n}?x=1`);

function summary(over = {}) {
  return {
    site: 'example.com',
    startedAt: '2026-11-13T08:00:00.000Z',
    durationMs: 12340,
    pageCount: 42,
    linkCount: 310,
    truncated: false,
    broken: [{ url: 'https://gone.test/a', code: 404, text: 'Not Found', pages: pages5 }],
    doubt: [{ url: 'https://www.linkedin.com/in/x', code: 403, text: 'Forbidden', pages: [pages5[0]] }],
    ...over,
  };
}

test('terminal: broken link shows 3 pages and "and 2 more"', () => {
  const out = renderTerminal(summary(), { color: false });
  assert.equal(
    out,
    [
      '✖ 404  https://gone.test/a',
      '    on /p1?x=1',
      '    on /p2?x=1',
      '    on /p3?x=1',
      '    … and 2 more pages',
      '',
      'Doubt',
      '? 403  https://www.linkedin.com/in/x',
      '    on /p1?x=1',
      '',
      '42 pages · 310 links · 1 broken · 1 doubtful · 12.3s',
    ].join('\n'),
  );
});

test('terminal: no ANSI codes without color, ANSI codes with color', () => {
  assert.doesNotMatch(renderTerminal(summary(), { color: false }), /\u001b\[/);
  assert.match(renderTerminal(summary(), { color: true }), /\u001b\[/);
});

test('terminal: no findings says "No broken links"', () => {
  const out = renderTerminal(summary({ broken: [], doubt: [] }), { color: false });
  assert.equal(out, 'No broken links\n\n42 pages · 310 links · 0 broken · 0 doubtful · 12.3s');
});

test('terminal: no broken but doubt still shows both', () => {
  const out = renderTerminal(summary({ broken: [] }), { color: false });
  assert.match(out, /^No broken links\n/);
  assert.match(out, /Doubt\n\? 403/);
});

test('terminal: truncated suffix', () => {
  const out = renderTerminal(summary({ truncated: true }), { color: false });
  assert.ok(out.endsWith('· 12.3s · stopped at max pages'));
});

test('terminal: null code, external page, empty pages', () => {
  const out = renderTerminal(
    summary({
      broken: [
        { url: 'https://dead.test/', code: null, text: 'ECONNREFUSED', pages: ['https://other.org/z'] },
        { url: 'https://example.com/orphan', code: 410, text: 'Gone', pages: [] },
      ],
      doubt: [{ url: 'https://slow.test/', code: null, text: 'timeout', pages: [] }],
    }),
    { color: false },
  );
  assert.match(out, /✖ ERR {2}https:\/\/dead\.test\/ ECONNREFUSED\n {4}on https:\/\/other\.org\/z/);
  assert.match(out, /✖ 410 {2}https:\/\/example\.com\/orphan\n {4}on \(no page links here; listed in sitemap or start page\)/);
  assert.match(out, /\? timeout {2}https:\/\/slow\.test\/ timeout\n/);
});

test('markdown: marker, heading, all 5 pages, summary', () => {
  const md = renderMarkdown(summary());
  const lines = md.split('\n');
  assert.equal(lines[0], '<!-- linkrot:example.com -->');
  assert.match(md, /^# linkrot: example\.com$/m);
  assert.match(md, /2026-11-13/);
  assert.match(md, /- ✖ 404 https:\/\/gone\.test\/a/);
  for (let n = 1; n <= 5; n++) assert.ok(md.includes(`  - on /p${n}?x=1`), `p${n}`);
  assert.doesNotMatch(md, /and \d+ more/);
  assert.match(md, /## Doubt/);
  assert.match(md, /42 pages · 310 links · 1 broken · 1 doubtful · 12\.3s/);
  assert.doesNotMatch(md, /\|---/);
});

test('markdown: no findings and truncated', () => {
  const md = renderMarkdown(summary({ broken: [], doubt: [], truncated: true }));
  assert.match(md, /No broken links/);
  assert.doesNotMatch(md, /## Doubt/);
  assert.match(md, /stopped at max pages/);
});

test('json round-trips', () => {
  const s = summary();
  assert.deepEqual(JSON.parse(renderJson(s)), s);
});

test('terminal: one hidden page says "and 1 more page"', () => {
  const out = renderTerminal(summary({ broken: [{ ...summary().broken[0], pages: pages5.slice(0, 4) }] }), { color: false });
  assert.match(out, /    … and 1 more page\n/);
  assert.doesNotMatch(out, /1 more pages/);
});
